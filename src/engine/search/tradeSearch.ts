import { assessMarketFairness } from "../intelligence/marketFairness";
import {
  buildLeagueIntelligence,
  rosteredPlayerIds,
} from "../intelligence/playerModel";
import type { LeagueIntelligence } from "../intelligence/types";
import { isFallingTrend, isRisingTrend } from "../intelligence/roleModel";
import { validateLeagueSnapshot } from "../league/validateLeagueSnapshot";
import { getEngineProfile } from "../performance/profile";
import { derivePositionalNeeds } from "../roster/positionalNeeds";
import { evaluateTrade } from "../transactions/evaluateTransactions";
import type { ExplanationFactor, LeagueSnapshot } from "../types";
import {
  acquisitionValue,
  characterizeRosterAssets,
  createSearchCache,
  exactAcquisitionValue,
} from "./characterizeAssets";
import { calculateOpponentFit, fitBandRank } from "./opponentFit";
import { quickEvaluateTrade } from "./quickEvaluateTrade";
import { evaluateDealPlausibility } from "../plausibility/managerModel";
import type { PlausibilityContext } from "../plausibility/types";
import type {
  AssetCharacterization,
  OpponentFitBand,
  SearchInstrumentation,
  SearchCache,
  TargetOffer,
  TargetPlayerSearchResult,
  TradePackage,
  TradeSearchConfig,
  TradeSearchResponse,
  TradeSearchResult,
  TradeShape,
  TradeTag,
} from "./types";

export const DEFAULT_TRADE_SEARCH_CONFIG: TradeSearchConfig = {
  allowedShapes: ["1-for-1", "2-for-1", "1-for-2", "2-for-2", "3-for-1"],
  myOutgoingPoolSize: 10,
  opponentTargetPoolSize: 8,
  explorationFraction: 0.2,
  maxQuickCandidatesPerOpponent: 60,
  maxCandidatesPerOpponent: 8,
  maxFinalResults: 12,
  minimumMyUtilityGain: 0.25,
  minimumOpponentFit: "low",
  includeExplorationCandidates: true,
};
const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, v));
function choose<T>(
  v: T[],
  n: number,
  start = 0,
  p: T[] = [],
  out: T[][] = [],
): T[][] {
  if (p.length === n) {
    out.push([...p]);
    return out;
  }
  for (let i = start; i <= v.length - (n - p.length); i++)
    choose(v, n, i + 1, [...p, v[i]], out);
  return out;
}
function counts(shape: TradeShape): [number, number] {
  const [a, b] = shape.split("-for-").map(Number);
  return [a, b];
}
function key(p: TradePackage) {
  return `${p.teamBId}|${[...p.teamAGives].sort()}|${[...p.teamBGives].sort()}`;
}
function explore<T>(v: T[], n: number) {
  return Array.from(
    { length: Math.min(n, v.length) },
    (_, i) => v[Math.floor((i * v.length) / n)],
  );
}
function pool(
  items: AssetCharacterization[],
  size: number,
  score: (a: AssetCharacterization) => number,
  fraction: number,
  enabled: boolean,
) {
  const sorted = [...items].sort(
    (a, b) => score(b) - score(a) || a.playerId.localeCompare(b.playerId),
  );
  if (!enabled) return sorted.slice(0, size);
  const n = Math.max(1, Math.floor(size * fraction)),
    priority = sorted.slice(0, Math.max(1, size - n));
  return [...priority, ...explore(sorted.slice(priority.length), n)].slice(
    0,
    size,
  );
}
function onlyQb(
  snapshot: LeagueSnapshot,
  teamId: string,
  give: string[],
  receive: string[],
) {
  const team = snapshot.teams.find((t) => t.id === teamId)!;
  return (
    !team.roster.some(
      (r) =>
        !give.includes(r.playerId) &&
        snapshot.players[r.playerId]?.eligiblePositions.includes("QB"),
    ) &&
    !receive.some((id) =>
      snapshot.players[id]?.eligiblePositions.includes("QB"),
    )
  );
}
function naive(a: number, b: number, shapes: TradeShape[]) {
  const c = (n: number, k: number) =>
    k > n
      ? 0
      : k === 1
        ? n
        : k === 2
          ? (n * (n - 1)) / 2
          : (n * (n - 1) * (n - 2)) / 6;
  return shapes.reduce((s, shape) => {
    const [x, y] = counts(shape);
    return s + c(a, x) * c(b, y);
  }, 0);
}
function empty(): SearchInstrumentation {
  return {
    playersProcessed: 0,
    opponentsSearched: 0,
    naiveCandidateCount: 0,
    rawCandidatesGenerated: 0,
    structuralCandidates: 0,
    quickEvaluationsRun: 0,
    quickCandidatesRetained: 0,
    candidatesPruned: 0,
    fullEvaluationsRun: 0,
    paretoResults: 0,
    totalSearchTimeMs: 0,
  };
}
function intelGap(intel: LeagueIntelligence, id: string) {
  return intel.players[id]?.mispricingZ ?? 0;
}
function incomingIntelligence(intel: LeagueIntelligence, id: string) {
  const player = intel.players[id];
  if (!player) return 0;
  return (
    2 * (player.mispricingZ ?? 0) +
    (isRisingTrend(player.role.trend) ? 1.5 : 0) +
    Math.max(0, 4 - player.fundamentalTier) * 0.35
  );
}
function outgoingLeverage(intel: LeagueIntelligence, id: string) {
  const player = intel.players[id];
  if (!player) return 0;
  return (
    -0.8 * (player.mispricingZ ?? 0) +
    player.market.liquidity / 100 +
    (isFallingTrend(player.role.trend) ? 0.75 : 0)
  );
}

interface Candidate {
  trade: TradePackage;
  cheapScore: number;
  outgoingCost: number;
  incomingValue: number;
}
function generate(
  snapshot: LeagueSnapshot,
  primary: string,
  opponent: string,
  config: TradeSearchConfig,
  cache: ReturnType<typeof createSearchCache>,
  intel: LeagueIntelligence,
  target?: string,
) {
  const mine = characterizeRosterAssets(snapshot, primary, opponent, cache),
    theirs = characterizeRosterAssets(snapshot, opponent, primary, cache);
  const myPool = pool(
    mine,
    config.myOutgoingPoolSize,
    (a) =>
      a.acquisitionValue / Math.max(0.5, a.marginalValue) +
      (a.assetClass === "TRADE_CHIP" || a.assetClass === "REDUNDANT_VALUE"
        ? 2
        : 0) -
      0.8 * intelGap(intel, a.playerId) +
      outgoingLeverage(intel, a.playerId),
    config.explorationFraction,
    config.includeExplorationCandidates,
  );
  let targetPool = pool(
    theirs,
    config.opponentTargetPoolSize,
    (a) =>
      a.acquisitionValue -
      0.2 * a.marginalValue +
      incomingIntelligence(intel, a.playerId),
    config.explorationFraction,
    config.includeExplorationCandidates,
  );
  if (target) targetPool = theirs.filter((a) => a.playerId === target);
  const packages: TradePackage[] = [];
  for (const shape of config.allowedShapes) {
    const [mc, tc] = counts(shape),
      outs =
        shape === "3-for-1"
          ? choose(myPool.filter((a) => a.assetClass !== "CORE").slice(0, 6), 3)
          : choose(myPool, mc),
      ins =
        shape === "3-for-1"
          ? choose(targetPool.slice(0, 3), 1)
          : choose(targetPool, tc);
    for (const o of outs)
      for (const i of ins)
        packages.push({
          teamAId: primary,
          teamBId: opponent,
          teamAGives: o.map((a) => a.playerId),
          teamBGives: i.map((a) => a.playerId),
          shape,
        });
  }
  const unique = [...new Map(packages.map((p) => [key(p), p])).values()];
  const candidates: Candidate[] = [];
  for (const trade of unique) {
    if (
      onlyQb(snapshot, primary, trade.teamAGives, trade.teamBGives) ||
      onlyQb(snapshot, opponent, trade.teamBGives, trade.teamAGives)
    )
      continue;
    const outgoing = trade.teamAGives.reduce(
        (s, id) => s + (cache.removalMarginal.get(`${primary}:${id}`) ?? 0),
        0,
      ),
      incoming = trade.teamBGives.reduce(
        (s, id) => s + acquisitionValue(snapshot, primary, id, cache),
        0,
      ),
      oppOut = trade.teamBGives.reduce(
        (s, id) => s + (cache.removalMarginal.get(`${opponent}:${id}`) ?? 0),
        0,
      ),
      oppIn = trade.teamAGives.reduce(
        (s, id) => s + acquisitionValue(snapshot, opponent, id, cache),
        0,
      );
    if (
      incoming <= 0 ||
      oppIn <= 0 ||
      incoming < outgoing * 0.2 ||
      oppIn < oppOut * 0.2
    )
      continue;
    const market =
      trade.teamBGives.reduce((s, id) => s + intelGap(intel, id), 0) -
      trade.teamAGives.reduce((s, id) => s + intelGap(intel, id), 0);
    candidates.push({
      trade,
      cheapScore: incoming - outgoing + (oppIn - oppOut) + market,
      outgoingCost: outgoing,
      incomingValue: incoming,
    });
  }
  candidates.sort(
    (a, b) =>
      b.cheapScore - a.cheapScore || key(a.trade).localeCompare(key(b.trade)),
  );
  return {
    raw: unique.length,
    candidates: candidates.slice(0, config.maxQuickCandidatesPerOpponent),
  };
}

function downside(r: TradeSearchResult) {
  return (
    Math.max(0, -r.evaluation.primaryTeam.depthDelta) +
    Math.max(
      0,
      r.evaluation.primaryTeam.after.vulnerabilityPenalty -
        r.evaluation.primaryTeam.before.vulnerabilityPenalty,
    )
  );
}
function dominates(a: TradeSearchResult, b: TradeSearchResult) {
  const au = a.evaluation.primaryTeam.netUtilityDelta,
    bu = b.evaluation.primaryTeam.netUtilityDelta;
  return (
    au >= bu &&
    a.opponentFit.score >= b.opponentFit.score &&
    a.downsideRisk <= b.downsideRisk &&
    (au > bu ||
      a.opponentFit.score > b.opponentFit.score ||
      a.downsideRisk < b.downsideRisk)
  );
}
export function paretoFilter(results: TradeSearchResult[]) {
  return results.filter(
    (r, i) => !results.some((o, j) => i !== j && dominates(o, r)),
  );
}
function norm(values: number[], v: number, invert = false) {
  const min = Math.min(...values),
    max = Math.max(...values),
    n = max === min ? 0.65 : (v - min) / (max - min);
  return invert ? 1 - n : n;
}
function tags(
  r: TradeSearchResult,
  assets: Map<string, AssetCharacterization>,
): TradeTag[] {
  const set = new Set<TradeTag>();
  for (const c of r.evaluation.primaryTeam.positionalChanges)
    if (
      c.starterPointsDelta > 0.5 &&
      ["QB", "RB", "WR", "TE"].includes(c.position)
    )
      set.add(`UPGRADE_${c.position}` as TradeTag);
  if (r.trade.teamAGives.length > r.trade.teamBGives.length)
    set.add("CONSOLIDATION");
  if (
    r.trade.teamAGives.some((id) =>
      ["TRADE_CHIP", "REDUNDANT_VALUE"].includes(
        assets.get(id)?.assetClass ?? "",
      ),
    )
  )
    set.add("SELL_REDUNDANCY");
  if ((r.evaluation.primaryTeam.playoffPointsDelta ?? 0) > 1)
    set.add("PLAYOFF_UPGRADE");
  if (r.downsideRisk > 1) set.add("DEPTH_RISK");
  if (r.opponentFit.score >= 70) set.add("STRONG_MUTUAL_FIT");
  if (r.opponentFit.score < 40) set.add("LOW_OPPONENT_FIT");
  if (
    set.has("CONSOLIDATION") &&
    r.evaluation.primaryTeam.remainingStarterPointsDelta > 0
  )
    set.add("DEPTH_FOR_STAR");
  return [...set];
}
function rank(
  results: TradeSearchResult[],
  assets: Map<string, AssetCharacterization>,
  plausibilityContext?: PlausibilityContext,
) {
  if (!results.length) return results;
  const utility = results.map((r) => r.evaluation.primaryTeam.netUtilityDelta),
    starter = results.map(
      (r) => r.evaluation.primaryTeam.remainingStarterPointsDelta,
    ),
    playoff = results.map(
      (r) => r.evaluation.primaryTeam.playoffPointsDelta ?? 0,
    ),
    risk = results.map((r) => r.downsideRisk);
  for (const r of results) {
    if (plausibilityContext)
      r.dealPlausibility = evaluateDealPlausibility(r, plausibilityContext);
    const quality =
      0.45 * norm(utility, r.evaluation.primaryTeam.netUtilityDelta) +
      0.2 *
        norm(starter, r.evaluation.primaryTeam.remainingStarterPointsDelta) +
      0.15 * norm(playoff, r.evaluation.primaryTeam.playoffPointsDelta ?? 0) +
      (0.15 * r.opponentFit.score) / 100 +
      0.05 * norm(risk, r.downsideRisk, true);
    r.teamFitScore = Math.round(35 + 65 * quality);
    const fairness =
      r.marketFairness.band === "unavailable"
        ? 50
        : 100 - Math.abs(60 - r.marketFairness.score);
    // Plausibility ranks viable choices; it cannot rescue a weak V1 result.
    r.pursuitScore = Math.round(
      0.48 * r.teamFitScore +
        0.17 * r.opponentFit.score +
        0.12 * r.marketOpportunityScore +
        0.08 * fairness +
        0.15 * (r.dealPlausibility?.score ?? 50),
    );
    r.tags = tags(r, assets);
    r.opportunityCategory =
      r.teamFitScore >= 80 && (r.dealPlausibility?.score ?? 50) < 45
        ? "HIGH_UPSIDE"
        : (r.dealPlausibility?.score ?? 50) >= 70 && r.teamFitScore >= 55
          ? "MOST_REALISTIC"
          : r.tags.includes("CONSOLIDATION")
            ? "CONSOLIDATION"
            : "BEST_OVERALL";
  }
  results.sort(
    (a, b) =>
      b.pursuitScore - a.pursuitScore ||
      b.teamFitScore - a.teamFitScore ||
      key(a.trade).localeCompare(key(b.trade)),
  );
  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}

function internal(
  primary: string,
  snapshot: LeagueSnapshot,
  config: TradeSearchConfig,
  target?: string,
  preserve = false,
  intelligence?: LeagueIntelligence,
  searchCache?: SearchCache,
  plausibilityContext?: PlausibilityContext,
): TradeSearchResponse {
  const started = performance.now(),
    instrumentation = empty(),
    validation = validateLeagueSnapshot(snapshot);
  if (validation.status !== "READY")
    return {
      status: "ENGINE_NOT_READY",
      results: [],
      instrumentation,
      missingRequirements: validation.missingRequirements,
    };
  const intel =
      intelligence ??
      buildLeagueIntelligence(snapshot, {
        playerIds: rosteredPlayerIds(snapshot),
      }),
    cache = searchCache ?? createSearchCache(snapshot, [primary]),
    all = [...cache.baseline.values()],
    assets = characterizeRosterAssets(snapshot, primary, primary, cache),
    assetMap = new Map(assets.map((a) => [a.playerId, a])),
    results: TradeSearchResult[] = [];
  instrumentation.playersProcessed = Object.keys(intel.players).length;
  const opponents = snapshot.teams.filter(
    (t) =>
      t.id !== primary &&
      (!target || t.roster.some((r) => r.playerId === target)),
  );
  instrumentation.opponentsSearched = opponents.length;
  for (const opponent of opponents) {
    instrumentation.naiveCandidateCount += naive(
      snapshot.teams.find((t) => t.id === primary)!.roster.length,
      opponent.roster.length,
      config.allowedShapes,
    );
    const generated = generate(
      snapshot,
      primary,
      opponent.id,
      config,
      cache,
      intel,
      target,
    );
    instrumentation.rawCandidatesGenerated += generated.raw;
    instrumentation.structuralCandidates += generated.candidates.length;
    const quick = generated.candidates.map((candidate) => ({
      candidate,
      evaluation: quickEvaluateTrade(
        snapshot,
        candidate.trade,
        cache.baseline,
        intel,
      ),
    }));
    instrumentation.quickEvaluationsRun += quick.length;
    const quickRank = (a: (typeof quick)[number], b: (typeof quick)[number]) =>
      b.evaluation.score - a.evaluation.score ||
      b.candidate.cheapScore - a.candidate.cheapScore;
    // Preserve most of the exact budget for plausible quick fits, while
    // reserving an exploration quota for false negatives caused by the cheap
    // depth proxy. The full V1 pass remains the final authority.
    const priorityBudget = Math.max(
      1,
      Math.ceil(config.maxCandidatesPerOpponent * 0.8),
    );
    const priority = quick
      .filter(
        (q) => q.evaluation.legal && q.evaluation.opponent.utilityDelta > -8,
      )
      .sort(quickRank);
    const exploration = quick
      .filter(
        (q) =>
          q.evaluation.legal &&
          q.evaluation.opponent.utilityDelta <= -8 &&
          q.evaluation.opponent.utilityDelta > -20,
      )
      .sort(quickRank);
    const retained = [
      ...priority.slice(0, priorityBudget),
      ...exploration.slice(
        0,
        Math.max(0, config.maxCandidatesPerOpponent - priorityBudget),
      ),
    ].slice(0, config.maxCandidatesPerOpponent);
    instrumentation.quickCandidatesRetained += retained.length;
    const needs = derivePositionalNeeds(snapshot, opponent.id, all);
    for (const q of retained) {
      instrumentation.fullEvaluationsRun++;
      const evaluation = evaluateTrade(snapshot, q.candidate.trade, {
        baselineEvaluations: cache.baseline,
        includeMarginals: false,
      });
      if (
        !evaluation.legal ||
        evaluation.primaryTeam.netUtilityDelta < config.minimumMyUtilityGain ||
        !evaluation.opponentTeam
      )
        continue;
      if (
        evaluation.primaryTeam.requiredDrops.some((d) =>
          q.candidate.trade.teamBGives.includes(d.playerId),
        ) ||
        evaluation.opponentTeam.requiredDrops.some((d) =>
          q.candidate.trade.teamAGives.includes(d.playerId),
        )
      )
        continue;
      const opponentFit = calculateOpponentFit(
        evaluation,
        needs,
        q.candidate.trade.teamAGives.length,
        q.candidate.trade.teamBGives.length,
      );
      if (
        fitBandRank(opponentFit.band) <
          fitBandRank(config.minimumOpponentFit) ||
        opponentFit.losesCriticalStarter
      )
        continue;
      const marketFairness = assessMarketFairness(
        q.candidate.trade.teamAGives,
        q.candidate.trade.teamBGives,
        intel,
      );
      const incomingGap = q.candidate.trade.teamBGives.reduce(
          (s, id) => s + Math.max(0, intelGap(intel, id)),
          0,
        ),
        outgoingGap = q.candidate.trade.teamAGives.reduce(
          (s, id) => s + Math.max(0, intelGap(intel, id)),
          0,
        ),
        marketOpportunityScore = Math.round(
          clamp(50 + 15 * (incomingGap - outgoingGap)),
        );
      const marketReasons: ExplanationFactor[] = [
        {
          code: "MARKET_FAIRNESS",
          direction:
            marketFairness.band === "advantage_opponent"
              ? "positive"
              : marketFairness.band === "advantage_you"
                ? "negative"
                : "neutral",
          metric: "marketFairness",
          before: marketFairness.youSend,
          after: marketFairness.youReceive,
          delta: marketFairness.youReceive - marketFairness.youSend,
          message: marketFairness.explanation,
        },
      ];
      const result: TradeSearchResult = {
        trade: q.candidate.trade,
        evaluation,
        opponentTeamId: opponent.id,
        opponentFit,
        marketFairness,
        teamFitScore: 0,
        marketOpportunityScore,
        pursuitScore: 0,
        rank: 0,
        tags: [],
        reasons: [...evaluation.primaryTeam.explanations, ...marketReasons],
        warnings: evaluation.warnings,
        downsideRisk: 0,
        outgoingMarginalCost: q.candidate.outgoingCost,
        incomingAcquisitionValue: q.candidate.incomingValue,
      };
      result.downsideRisk = round(downside(result));
      results.push(result);
    }
  }
  const frontier = paretoFilter(results);
  instrumentation.paretoResults = frontier.length;
  instrumentation.candidatesPruned =
    instrumentation.rawCandidatesGenerated - instrumentation.fullEvaluationsRun;
  const plausibilityStarted = performance.now();
  const ranked = rank(preserve ? results : frontier, assetMap, plausibilityContext).slice(
    0,
    config.maxFinalResults,
  );
  instrumentation.plausibilityTimeMs = round(performance.now() - plausibilityStarted);
  instrumentation.totalSearchTimeMs = round(performance.now() - started);
  instrumentation.profile = getEngineProfile();
  return {
    status: "READY",
    results: ranked,
    instrumentation,
    missingRequirements: [],
  };
}
export function searchTrades(
  primary: string,
  snapshot: LeagueSnapshot,
  config: Partial<TradeSearchConfig> = {},
  intelligence?: LeagueIntelligence,
  searchCache?: SearchCache,
  plausibilityContext?: PlausibilityContext,
) {
  return internal(
    primary,
    snapshot,
    { ...DEFAULT_TRADE_SEARCH_CONFIG, ...config },
    undefined,
    false,
    intelligence,
    searchCache,
    plausibilityContext,
  );
}
export function findOffersForTarget(
  primary: string,
  targetId: string,
  snapshot: LeagueSnapshot,
  config: Partial<TradeSearchConfig> = {},
  intelligence?: LeagueIntelligence,
  searchCache?: SearchCache,
  plausibilityContext?: PlausibilityContext,
): TargetPlayerSearchResult {
  const target = snapshot.players[targetId],
    owner = target?.rosteredTeamId,
    merged = {
      ...DEFAULT_TRADE_SEARCH_CONFIG,
      ...config,
      allowedShapes: ["1-for-1", "2-for-1", "3-for-1"] as TradeShape[],
      maxFinalResults: 30,
      minimumMyUtilityGain: -0.25,
      minimumOpponentFit: "low" as OpponentFitBand,
    };
  if (!target || !owner || owner === primary)
    return {
      status: "ENGINE_NOT_READY",
      targetPlayerId: targetId,
      targetMarginalGain: 0,
      recommendation: "NO_PLAUSIBLE_OFFER",
      offers: [],
      missingRequirements: ["target must be rostered by an opponent"],
      instrumentation: empty(),
    };
  const cache = searchCache ?? createSearchCache(snapshot, [primary]),
    gain = exactAcquisitionValue(snapshot, primary, targetId, cache),
    response = internal(
      primary,
      snapshot,
      merged,
      targetId,
      true,
      intelligence,
      cache,
      plausibilityContext,
    ),
    plausible = response.results.filter(
      (r) =>
        fitBandRank(r.opponentFit.band) >=
        fitBandRank(merged.minimumOpponentFit),
    ),
    offers: TargetOffer[] = [];
  const add = (style: TargetOffer["style"], result?: TradeSearchResult) => {
    if (
      result &&
      !offers.some((o) => key(o.result.trade) === key(result.trade))
    )
      offers.push({ style, result });
  };
  add(
    "CHEAPEST_WINNING_FIT",
    [...plausible].sort(
      (a, b) => a.outgoingMarginalCost - b.outgoingMarginalCost,
    )[0],
  );
  add(
    "BEST_MUTUAL_FIT",
    [...plausible].sort((a, b) => b.pursuitScore - a.pursuitScore)[0],
  );
  add(
    "CONSOLIDATION_OFFER",
    [...plausible]
      .filter((r) => r.trade.teamAGives.length > 1)
      .sort(
        (a, b) =>
          b.evaluation.primaryTeam.netUtilityDelta -
          a.evaluation.primaryTeam.netUtilityDelta,
      )[0],
  );
  add(
    "AGGRESSIVE_OFFER",
    [...plausible].sort((a, b) => b.opponentFit.score - a.opponentFit.score)[0],
  );
  const weeks = Math.max(
    1,
    cache.baseline.get(primary)?.weeklyLineups.length ?? 1,
  );
  const ladderCandidates = [...plausible].filter(
    (result) => result.evaluation.primaryTeam.netUtilityDelta >= -0.25,
  );
  const distinct = (candidates: TradeSearchResult[]) => {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const candidateKey = key(candidate.trade);
      if (seen.has(candidateKey)) return false;
      seen.add(candidateKey);
      return true;
    });
  };
  const ladder = distinct(ladderCandidates);
  return {
    status: response.status,
    targetPlayerId: targetId,
    targetMarginalGain: gain,
    recommendation:
      gain / weeks < 0.75
        ? "DO_NOT_OVERPAY"
        : offers.length
          ? "PURSUE"
          : "NO_PLAUSIBLE_OFFER",
    offers,
    missingRequirements: response.missingRequirements,
    instrumentation: response.instrumentation,
    ladder: {
      opening: [...ladder].sort((a, b) =>
        b.evaluation.primaryTeam.netUtilityDelta - a.evaluation.primaryTeam.netUtilityDelta,
      )[0],
      balanced: [...ladder].sort((a, b) => b.pursuitScore - a.pursuitScore)[0],
      strong: [...ladder].sort((a, b) =>
        (b.dealPlausibility?.score ?? 50) - (a.dealPlausibility?.score ?? 50),
      )[0],
      maximum: [...ladder].sort((a, b) =>
        (b.dealPlausibility?.score ?? 50) - (a.dealPlausibility?.score ?? 50) ||
        b.evaluation.primaryTeam.netUtilityDelta - a.evaluation.primaryTeam.netUtilityDelta,
      )[0],
    },
  };
}
