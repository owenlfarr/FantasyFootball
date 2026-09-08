import {
  applyFundamentalForecasts,
  buildLeagueIntelligence,
  confidenceBand,
} from "../intelligence/playerModel";
import { isRisingTrend } from "../intelligence/roleModel";
import type { LeagueIntelligence } from "../intelligence/types";
import { validateLeagueSnapshot } from "../league/validateLeagueSnapshot";
import { derivePositionalNeeds } from "../roster/positionalNeeds";
import { findBestDropForAdd } from "../transactions/evaluateTransactions";
import type {
  CanonicalPosition,
  ExplanationFactor,
  LeagueSnapshot,
} from "../types";
import { createSearchCache } from "./characterizeAssets";
import type {
  SearchCache,
  WaiverActionability,
  WaiverCategory,
  WaiverRecommendation,
  WaiverSearchConfig,
  WaiverSearchResponse,
} from "./types";

export const DEFAULT_WAIVER_SEARCH_CONFIG: WaiverSearchConfig = {
  maxPreFilteredCandidates: 100,
  maxPriorityCandidates: 40,
  explorationFraction: 0.2,
  maxFinalResults: 12,
  minimumUtilityGain: 0.25,
  supportedPositions: ["QB", "RB", "WR", "TE", "K", "D/ST", "HC"],
};
const round = (v: number) => Math.round(v * 1000) / 1000;
const averageForecast = (snapshot: LeagueSnapshot, id: string) => {
  const values =
    snapshot.players[id]?.forecasts.filter(
      (f) => f.week >= snapshot.currentWeek,
    ) ?? [];
  return values.length
    ? values.reduce((sum, f) => sum + f.mean * f.availabilityProbability, 0) /
        values.length
    : 0;
};
function normalize(values: number[], value: number) {
  const min = Math.min(...values),
    max = Math.max(...values);
  return max === min ? 0.5 : (value - min) / (max - min);
}
function classify(
  position: CanonicalPosition,
  starterPpg: number,
  depth: number,
  bye: boolean,
  intelligence: LeagueIntelligence,
  id: string,
): WaiverCategory {
  const intel = intelligence.players[id];
  if (starterPpg >= 1.5) return "IMMEDIATE_STARTER";
  if (isRisingTrend(intel?.role.trend ?? "unknown") && intel.optionValue >= 2)
    return "ROLE_GROWTH_STASH";
  if (intel?.optionValue >= 3) return "HIGH_UPSIDE_STASH";
  if (bye) return "BYE_COVERAGE";
  if (["K", "D/ST", "HC"].includes(position)) return "STREAMER";
  if (depth > 1) return "DEPTH_UPGRADE";
  return "PURE_DEPTH";
}
function actionability(
  adjusted: number,
  starterPpg: number,
  confidence: number,
): WaiverActionability {
  if (starterPpg >= 3 && adjusted >= 6 && confidence >= 0.45) return "URGENT";
  if (starterPpg >= 1.5 && adjusted >= 3) return "STRONG_MOVE";
  if (adjusted >= 2 || starterPpg >= 0.5) return "WORTH_CONSIDERING";
  if (adjusted >= 0.5) return "MARGINAL";
  return "IGNORE";
}
function marketDropCost(intelligence: LeagueIntelligence, id?: string) {
  if (!id) return 0;
  const market = intelligence.players[id]?.market;
  return market?.sufficientForMispricing
    ? market.value * market.confidence * 0.06
    : 0;
}

function cheapPositionNeeds(snapshot: LeagueSnapshot, teamId: string) {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  const positions: CanonicalPosition[] = [
    "QB",
    "RB",
    "WR",
    "TE",
    "K",
    "D/ST",
    "HC",
  ];
  return new Map(
    positions.map((position) => {
      const demand = snapshot.settings.lineupSlots
        .filter(
          (slot) =>
            slot.kind === "active" && slot.eligiblePositions.includes(position),
        )
        .reduce(
          (sum, slot) =>
            sum + slot.count / Math.max(1, slot.eligiblePositions.length),
          0,
        );
      const roster = (team?.roster ?? []).filter((entry) =>
        snapshot.players[entry.playerId]?.eligiblePositions.includes(position),
      );
      const best = Math.max(
        0,
        ...roster.map((entry) => averageForecast(snapshot, entry.playerId)),
      );
      return [
        position,
        Math.max(0, (demand + 0.75 - roster.length) * 35) +
          Math.max(0, 14 - best) * 2,
      ];
    }),
  );
}

export function preRankWaiverCandidates(
  primaryTeamId: string,
  snapshot: LeagueSnapshot,
  maximum = 100,
  explorationFraction = 0.2,
  supportedPositions: CanonicalPosition[] = DEFAULT_WAIVER_SEARCH_CONFIG.supportedPositions,
): string[] {
  const needs = cheapPositionNeeds(snapshot, primaryTeamId);
  const superflex = snapshot.settings.lineupSlots.some(
    (slot) =>
      slot.kind === "active" &&
      slot.eligiblePositions.includes("QB") &&
      slot.eligiblePositions.length > 1,
  );
  const available = [
    ...new Set([...snapshot.freeAgentIds, ...snapshot.waiverPlayerIds]),
  ].filter((id) => {
    const player = snapshot.players[id];
    return (
      player &&
      !player.rosteredTeamId &&
      supportedPositions.includes(player.primaryPosition) &&
      !["OUT", "INJURY_RESERVE"].includes(player.injuryStatus ?? "") &&
      player.forecasts.some(
        (forecast) =>
          forecast.week >= snapshot.currentWeek && forecast.mean > 0,
      )
    );
  });
  const ranked = available
    .map((id) => {
      const player = snapshot.players[id];
      const market = player.market;
      const upsidePosition = ["RB", "WR", "TE"].includes(
        player.primaryPosition,
      );
      const quarterbackRelevant = player.primaryPosition === "QB" && superflex;
      return {
        id,
        position: player.primaryPosition,
        score:
          averageForecast(snapshot, id) +
          (needs.get(player.primaryPosition) ?? 0) / 20 +
          (market?.percentOwned ?? 0) * 0.02 +
          (market?.percentStarted ?? 0) * 0.015 +
          (upsidePosition ? 1.25 : quarterbackRelevant ? 0.75 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const cap = Math.min(100, Math.max(1, maximum));
  const exploreCount = Math.min(Math.floor(cap * explorationFraction), 20);
  const priorityCount = cap - exploreCount;
  const priority: typeof ranked = [];
  let specialtyCount = 0;
  for (const candidate of ranked) {
    const specialty = ["K", "D/ST", "HC"].includes(candidate.position);
    if (specialty && specialtyCount >= 12) continue;
    priority.push(candidate);
    if (specialty) specialtyCount++;
    if (priority.length >= priorityCount) break;
  }
  const chosen = new Set(priority.map((candidate) => candidate.id));
  const exploration = ranked.filter(
    (candidate) =>
      !chosen.has(candidate.id) &&
      (["RB", "WR", "TE"].includes(candidate.position) ||
        (candidate.position === "QB" && superflex)),
  );
  for (let index = 0; index < exploreCount && exploration.length; index++) {
    const candidate =
      exploration[Math.floor((index * exploration.length) / exploreCount)];
    chosen.add(candidate.id);
  }
  if (chosen.size < Math.min(cap, ranked.length)) {
    for (const candidate of ranked) {
      chosen.add(candidate.id);
      if (chosen.size >= Math.min(cap, ranked.length)) break;
    }
  }
  return [...chosen];
}

export function rankWaivers(
  primaryTeamId: string,
  snapshot: LeagueSnapshot,
  config: Partial<WaiverSearchConfig> = {},
  intelligence?: LeagueIntelligence,
  searchCache?: SearchCache,
): WaiverSearchResponse {
  const started = performance.now(),
    options = { ...DEFAULT_WAIVER_SEARCH_CONFIG, ...config },
    validation = validateLeagueSnapshot(snapshot);
  const instrumentation = {
    availablePlayers:
      snapshot.freeAgentIds.length + snapshot.waiverPlayerIds.length,
    preFilteredCandidates: 0,
    intelligencePlayersProcessed: 0,
    candidatesGenerated: 0,
    fullEvaluationsRun: 0,
    retainedResults: 0,
    totalSearchTimeMs: 0,
  };
  if (validation.status !== "READY")
    return {
      status: "ENGINE_NOT_READY",
      results: [],
      instrumentation,
      missingRequirements: validation.missingRequirements,
    };
  const preFilteredIds = preRankWaiverCandidates(
    primaryTeamId,
    snapshot,
    options.maxPreFilteredCandidates,
    options.explorationFraction,
    options.supportedPositions,
  );
  instrumentation.preFilteredCandidates = preFilteredIds.length;
  const primaryRosterIds =
    snapshot.teams
      .find((team) => team.id === primaryTeamId)
      ?.roster.map((entry) => entry.playerId) ?? [];
  const waiverIntelligence = buildLeagueIntelligence(snapshot, {
    playerIds: [...primaryRosterIds, ...preFilteredIds],
    usage: intelligence?.usage,
    marketSources: intelligence?.marketSources,
    providerDiagnostics: intelligence?.providerDiagnostics,
  });
  const historicalPrimaryPlayers = intelligence
    ? Object.fromEntries(
        primaryRosterIds
          .filter((id) => intelligence.players[id])
          .map((id) => [id, intelligence.players[id]]),
      )
    : {};
  const intel: LeagueIntelligence = intelligence
    ? {
        ...waiverIntelligence,
        players: {
          ...waiverIntelligence.players,
          ...historicalPrimaryPlayers,
        },
        dataWarnings: [
          ...new Set([
            ...waiverIntelligence.dataWarnings,
            ...intelligence.dataWarnings,
          ]),
        ],
      }
    : waiverIntelligence;
  instrumentation.intelligencePlayersProcessed = Object.keys(
    intel.players,
  ).length;
  const evaluationSnapshot = applyFundamentalForecasts(snapshot, intel),
    cache =
      searchCache ?? createSearchCache(evaluationSnapshot, [primaryTeamId]),
    baseline = cache.baseline.get(primaryTeamId);
  if (!baseline)
    return {
      status: "ENGINE_NOT_READY",
      results: [],
      instrumentation,
      missingRequirements: ["primary team unavailable"],
    };
  const needs = derivePositionalNeeds(evaluationSnapshot, primaryTeamId, [
      ...cache.baseline.values(),
    ]),
    needMap = new Map(needs.map((need) => [need.position, need.needScore]));
  const sorted = preFilteredIds
    .map((id) => ({
      id,
      priority:
        averageForecast(evaluationSnapshot, id) +
        (needMap.get(evaluationSnapshot.players[id].primaryPosition) ?? 0) /
          20 +
        intel.players[id].optionValue * 0.6 +
        (isRisingTrend(intel.players[id].role.trend) ? 1.5 : 0),
    }))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const exploration = Math.max(
      1,
      Math.floor(options.maxPriorityCandidates * options.explorationFraction),
    ),
    priority = Math.max(1, options.maxPriorityCandidates - exploration),
    candidates = sorted.slice(0, priority),
    tail = sorted.slice(priority);
  for (let i = 0; i < exploration && i < tail.length; i++)
    candidates.push(tail[Math.floor((i * tail.length) / exploration)]);
  instrumentation.candidatesGenerated = candidates.length;
  const results: WaiverRecommendation[] = [];
  for (const candidate of candidates) {
    instrumentation.fullEvaluationsRun++;
    const evaluation = findBestDropForAdd(
        evaluationSnapshot,
        primaryTeamId,
        candidate.id,
        { baselineEvaluations: cache.baseline, includeMarginals: false },
      ),
      impact = evaluation.primaryTeam;
    if (
      !evaluation.legal ||
      impact.netUtilityDelta < options.minimumUtilityGain
    )
      continue;
    const player = evaluationSnapshot.players[candidate.id],
      drop = impact.requiredDrops[0]?.playerId,
      dropMarginal = drop
        ? baseline.playerMarginalValues.find((value) => value.playerId === drop)
        : undefined;
    const bye =
        impact.after.byeWeekVulnerabilities.length <
        baseline.byeWeekVulnerabilities.length,
      needSolved =
        (needMap.get(player.primaryPosition) ?? 0) >= 50
          ? player.primaryPosition
          : undefined;
    const dropCost = marketDropCost(intel, drop),
      optionDelta =
        intel.players[candidate.id].optionValue -
        (drop ? (intel.players[drop]?.optionValue ?? 0) : 0);
    const marketPenalty =
      drop && intel.players[drop]?.market.sufficientForMispricing
        ? Math.min(
            0,
            intel.players[candidate.id].market.value -
              intel.players[drop].market.value,
          ) * 0.02
        : 0;
    const adjusted =
        impact.netUtilityDelta + optionDelta - dropCost + marketPenalty,
      weeks = Math.max(1, impact.after.weeklyLineups.length),
      starterPpg = impact.remainingStarterPointsDelta / weeks;
    const confidence = Math.min(
        intel.players[candidate.id].fundamental.confidence,
        drop ? (intel.players[drop]?.fundamental.confidence ?? 1) : 1,
      ),
      action = actionability(adjusted, starterPpg, confidence);
    if (action === "IGNORE") continue;
    const explanations: ExplanationFactor[] = [...impact.explanations];
    if (drop)
      explanations.push({
        code: "OPTIMAL_DROP",
        direction: "neutral",
        metric: "dropMarginalValue",
        before: dropMarginal?.removalUtility ?? 0,
        after: 0,
        delta: -(dropMarginal?.removalUtility ?? 0),
        playerIds: [drop],
        message: `The optimal legal drop starts in ${dropMarginal?.weeksStarted.length ?? 0} evaluated lineups; V4 also charges ${dropCost.toFixed(1)} market-liquidity and option cost.`,
      });
    explanations.push({
      code: "WAIVER_OPTION_VALUE",
      direction:
        optionDelta > 0 ? "positive" : optionDelta < 0 ? "negative" : "neutral",
      metric: "optionValue",
      before: drop ? (intel.players[drop]?.optionValue ?? 0) : 0,
      after: intel.players[candidate.id].optionValue,
      delta: optionDelta,
      playerIds: [candidate.id, ...(drop ? [drop] : [])],
      message: `The move changes conservative bench option value by ${optionDelta >= 0 ? "+" : ""}${optionDelta.toFixed(1)}.`,
    });
    results.push({
      addPlayerId: candidate.id,
      dropPlayerId: drop,
      utilityDelta: impact.netUtilityDelta,
      adjustedUtilityDelta: round(adjusted),
      starterDelta: impact.remainingStarterPointsDelta,
      playoffDelta: impact.playoffPointsDelta,
      depthDelta: impact.depthDelta,
      optionValueDelta: round(optionDelta),
      dropOpportunityCost: round(dropCost),
      weeksEvaluated: weeks,
      needSolved,
      category: classify(
        player.primaryPosition,
        starterPpg,
        impact.depthDelta,
        bye,
        intel,
        candidate.id,
      ),
      actionability: action,
      confidence: confidenceBand(confidence),
      score: 0,
      explanations,
      warnings: impact.warnings,
    });
  }
  if (results.length) {
    const adjusted = results.map((result) => result.adjustedUtilityDelta),
      starters = results.map((result) => result.starterDelta),
      optionsValues = results.map((result) => result.optionValueDelta);
    for (const result of results) {
      const need =
        needMap.get(snapshot.players[result.addPlayerId].primaryPosition) ?? 0;
      result.score = Math.round(
        35 +
          65 *
            (0.5 * normalize(adjusted, result.adjustedUtilityDelta) +
              0.25 * normalize(starters, result.starterDelta) +
              0.15 * normalize(optionsValues, result.optionValueDelta) +
              (0.1 * need) / 100),
      );
    }
    results.sort(
      (a, b) =>
        b.score - a.score ||
        b.adjustedUtilityDelta - a.adjustedUtilityDelta ||
        a.addPlayerId.localeCompare(b.addPlayerId),
    );
  }
  instrumentation.retainedResults = results.length;
  instrumentation.totalSearchTimeMs = round(performance.now() - started);
  return {
    status: "READY",
    results: results.slice(0, options.maxFinalResults),
    instrumentation,
    missingRequirements: [],
  };
}
