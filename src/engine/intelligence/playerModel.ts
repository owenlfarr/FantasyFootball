import type { DataProvenance, LeaguePlayer, LeagueSnapshot } from "../types";
import { estimateRole } from "./roleModel";
import { isFallingTrend, isRisingTrend } from "./roleModel";
import { estimateExpectedProduction } from "./expectedProduction";
import type {
  ConfidenceBand,
  FundamentalPlayerEstimate,
  IntelligenceBuildOptions,
  LeagueIntelligence,
  MarketValueEstimate,
  PlayerIntelligence,
  TrendDirection,
} from "./types";

export const FUNDAMENTAL_MODEL_VERSION = "fundamental-v4.0";
export const MARKET_MODEL_VERSION = "market-v4.0";
export const INTELLIGENCE_MODEL_VERSION = "intelligence-v4.0";
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const round = (v: number) => Math.round(v * 1000) / 1000;
const ordinal = (value: number) => {
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : rounded % 10 === 1
        ? "st"
        : rounded % 10 === 2
          ? "nd"
          : rounded % 10 === 3
            ? "rd"
            : "th";
  return `${rounded}${suffix}`;
};
const mean = (v: number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
function percentile(values: number[], value: number) {
  if (values.length < 2) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  return (100 * sorted.filter((v) => v < value).length) / (sorted.length - 1);
}
function band(value: number): ConfidenceBand {
  return value >= 0.72 ? "high" : value >= 0.45 ? "medium" : "low";
}
function provenance(
  source: string,
  asOf: string,
  version: string,
): DataProvenance {
  return { source, asOf, retrievedAt: asOf, version };
}
export function rosteredPlayerIds(snapshot: LeagueSnapshot): string[] {
  return [
    ...new Set(
      snapshot.teams.flatMap((team) =>
        team.roster.map((entry) => entry.playerId),
      ),
    ),
  ].filter((id) => Boolean(snapshot.players[id]));
}
export function adpDecay(week: number): number {
  return clamp(1 - (Math.max(1, week) - 1) / 13, 0.08, 1);
}
function projected(player: LeaguePlayer, week: number) {
  return player.forecasts.filter(
    (f) => f.week >= week && f.availabilityProbability > 0,
  );
}
function recentActual(player: LeaguePlayer, week: number) {
  return (player.actuals ?? [])
    .filter((a) => a.week < week)
    .sort((a, b) => b.week - a.week)
    .slice(0, 3);
}

export function estimateFundamental(
  player: LeaguePlayer,
  snapshot: LeagueSnapshot,
  options: IntelligenceBuildOptions = {},
): FundamentalPlayerEstimate {
  const forecasts = projected(player, snapshot.currentWeek);
  const base = mean(forecasts.map((f) => f.mean * f.availabilityProbability));
  const role = estimateRole(player.primaryPosition, options.usage?.[player.id]);
  const expectedProduction = estimateExpectedProduction(
    player.primaryPosition,
    options.usage?.[player.id],
  );
  const actual = recentActual(player, snapshot.currentWeek);
  const recent = mean(actual.map((a) => a.points));
  const expectedGap =
    actual.length >= 2 && base > 0
      ? clamp((base - recent) / Math.max(5, base), -0.2, 0.2)
      : 0;
  const roleAdjustment =
    role.opportunityScore === undefined
      ? 0
      : clamp((role.opportunityScore - 50) / 125, -0.08, 0.08);
  const trendAdjustment =
    role.confidence >= 0.45
      ? isRisingTrend(role.trend)
        ? role.trend === "strongly_rising" ? 0.04 : 0.025
        : isFallingTrend(role.trend)
          ? role.trend === "strongly_falling" ? -0.04 : -0.025
          : 0
      : 0;
  const usageRegression =
    expectedProduction.expectedFantasyPoints !== undefined && base > 0
      ? clamp(
          ((expectedProduction.expectedFantasyPoints - base) / base) *
            0.25 *
            expectedProduction.confidence,
          -0.06,
          0.06,
        )
      : undefined;
  const regressionAdjustment =
    usageRegression ?? (actual.length >= 2 ? expectedGap * 0.15 : 0);
  const adjustment = clamp(
    roleAdjustment + trendAdjustment + regressionAdjustment,
    -0.12,
    0.12,
  );
  const expected = base * (1 + adjustment);
  const baselineUncertainty = forecasts.length
    ? mean(forecasts.map((f) => (f.upper - f.lower) / 2.564))
    : 7;
  const injuryPenalty =
    player.injuryStatus && !["ACTIVE", "NORMAL"].includes(player.injuryStatus)
      ? 0.2
      : 0;
  const samplePenalty = role.confidence ? 0.12 * (1 - role.confidence) : 0.15;
  const uncertainty =
    baselineUncertainty *
    (1 +
      injuryPenalty +
      samplePenalty +
      (role.trend !== "stable" && role.trend !== "unknown" ? 0.08 : 0));
  const freshnessHours = Math.max(
    0,
    (Date.now() - Date.parse(player.provenance.asOf)) / 36e5,
  );
  const freshness = clamp(1 - freshnessHours / (24 * 7));
  const confidence = clamp(
    0.35 +
      0.25 * Math.min(1, forecasts.length / 4) +
      0.25 * role.confidence +
      0.15 * freshness -
      injuryPenalty,
  );
  const sources = [
    player.provenance,
    ...(role.opportunityScore === undefined
      ? []
      : [
          provenance(
            "Usage adapter",
            snapshot.provenance.asOf,
            FUNDAMENTAL_MODEL_VERSION,
          ),
        ]),
  ];
  return {
    playerId: player.id,
    week: snapshot.currentWeek,
    expectedPoints: round(expected),
    median: round(expected),
    floor: round(Math.max(0, expected - 1.282 * uncertainty)),
    ceiling: round(expected + 1.282 * uncertainty),
    uncertainty: round(uncertainty),
    opportunityScore: role.opportunityScore,
    roleSecurity: role.roleSecurity,
    trend: role.trend,
    baselinePoints: round(base),
    roleAdjustment: round(roleAdjustment + trendAdjustment),
    regressionAdjustment: round(regressionAdjustment),
    expectedProduction: {
      ...expectedProduction,
      expectedFantasyPoints:
        expectedProduction.expectedFantasyPoints === undefined
          ? undefined
          : round(expectedProduction.expectedFantasyPoints),
      actualFantasyPoints:
        expectedProduction.actualFantasyPoints === undefined
          ? undefined
          : round(expectedProduction.actualFantasyPoints),
      fantasyPointsOverExpected:
        expectedProduction.fantasyPointsOverExpected === undefined
          ? undefined
          : round(expectedProduction.fantasyPointsOverExpected),
    },
    confidence: round(confidence),
    sources,
    modelVersion: FUNDAMENTAL_MODEL_VERSION,
  };
}

function robustWeightedMean(inputs: Array<[number, number, string]>) {
  if (!inputs.length) return 0;
  const sorted = [...inputs].sort((a, b) => a[0] - b[0]);
  const totalWeight = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  let cumulative = 0;
  const median =
    sorted.find(([, weight]) => (cumulative += weight) >= totalWeight / 2)?.[0] ??
    sorted[0][0];
  return (
    inputs.reduce(
      (sum, [value, weight]) =>
        sum + (median + clamp(value - median, -25, 25)) * weight,
      0,
    ) / totalWeight
  );
}

function marketTrend(
  playerId: string,
  current: number,
  history: IntelligenceBuildOptions["history"],
): TrendDirection {
  const prior = (history ?? [])
    .filter((h) => h.playerId === playerId && h.market.sufficientForMispricing)
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
    .slice(-3);
  if (prior.length < 2) return "unknown";
  const delta = current - mean(prior.map((h) => h.market.value));
  return Math.abs(delta) < 5 ? "stable" : delta > 0 ? "rising" : "falling";
}
export function estimateMarkets(
  snapshot: LeagueSnapshot,
  fundamentals: Record<string, FundamentalPlayerEstimate>,
  options: IntelligenceBuildOptions = {},
): Record<string, MarketValueEstimate> {
  const players = Object.keys(fundamentals)
    .map((id) => snapshot.players[id])
    .filter((player): player is LeaguePlayer => Boolean(player));
  const projections = players.map((p) => fundamentals[p.id].expectedPoints);
  const actualMeans = players.map((p) =>
    mean(recentActual(p, snapshot.currentWeek).map((a) => a.points)),
  );
  const adps = players
    .map((p) => p.market?.averageDraftPosition)
    .filter((v): v is number => v !== undefined);
  return Object.fromEntries(
    players.map((player) => {
      const inputs: Array<[number, number, string]> = [
        [
          percentile(projections, fundamentals[player.id].expectedPoints),
          0.35,
          "ESPN projection market anchor",
        ],
      ];
      const m = player.market;
      if (m?.percentOwned !== undefined)
        inputs.push([m.percentOwned, 0.35, "ESPN roster percentage"]);
      if (m?.percentStarted !== undefined)
        inputs.push([m.percentStarted, 0.15, "ESPN start percentage"]);
      const recent = recentActual(player, snapshot.currentWeek);
      if (recent.length)
        inputs.push([
          percentile(actualMeans, mean(recent.map((a) => a.points))),
          0.1,
          "Recent ESPN scoring",
        ]);
      if (m?.averageDraftPosition !== undefined && adps.length > 1)
        inputs.push([
          100 - percentile(adps, m.averageDraftPosition),
          0.05 * adpDecay(snapshot.currentWeek),
          "Draft-market anchor",
        ]);
      const external = options.marketSources?.[player.id] ?? [];
      for (const observation of external) {
        const ageHours = Math.max(
          0,
          (Date.now() - Date.parse(observation.asOf)) / 36e5,
        );
        const freshnessWeight = clamp(1 - ageHours / (24 * 14), 0, 1);
        if (freshnessWeight > 0)
          inputs.push([
            observation.value,
            0.4 * observation.reliability * freshnessWeight,
            observation.source,
          ]);
      }
      const value = robustWeightedMean(inputs);
      const independent = external.filter((item) => item.independent).length;
      const freshnessHours = Math.max(
        0,
        (Date.now() - Date.parse(player.provenance.asOf)) / 36e5,
      );
      const freshness = clamp(1 - freshnessHours / (24 * 7));
      const disagreement = Math.sqrt(
        mean(inputs.map(([input]) => (input - value) ** 2)),
      );
      const confidence = clamp(
        0.2 + 0.22 * Math.min(2, independent) + 0.2 * freshness -
          Math.min(0.2, disagreement / 100),
      );
      const spread = 8 + 16 * (1 - confidence);
      const sufficient = independent >= 1 && confidence >= 0.35;
      return [
        player.id,
        {
          playerId: player.id,
          value: round(value),
          low: round(Math.max(0, value - spread)),
          high: round(Math.min(100, value + spread)),
          tier: Math.max(1, Math.ceil((100 - value) / 10)),
          liquidity: round(
            clamp(
              ((m?.percentOwned ?? 40) / 100) * 0.45 +
                ((m?.percentStarted ?? 20) / 100) * 0.25 +
                (value / 100) * 0.3,
            ) * 100,
          ),
          trend: marketTrend(player.id, value, options.history),
          confidence: round(confidence),
          sources: [
            ...inputs
              .filter(([, , source]) => !external.some((item) => item.source === source))
              .map(([, , source]) => provenance(source, snapshot.provenance.asOf, MARKET_MODEL_VERSION)),
            ...external.map((item) => ({
              source: item.source,
              asOf: item.asOf,
              retrievedAt: item.retrievedAt,
              version: MARKET_MODEL_VERSION,
            })),
          ],
          sufficientForMispricing: sufficient,
          modelVersion: MARKET_MODEL_VERSION,
          sourceValues: external,
          independentSourceCount: independent,
        },
      ];
    }),
  );
}

function dynamicTiers(
  selectedPlayers: LeaguePlayer[],
  fundamentals: Record<string, FundamentalPlayerEstimate>,
) {
  const tiers = new Map<string, number>();
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    const sorted = selectedPlayers
      .filter((player) => player.primaryPosition === position)
      .sort(
        (a, b) =>
          fundamentals[b.id].expectedPoints - fundamentals[a.id].expectedPoints,
      );
    let tier = 1;
    sorted.forEach((player, index) => {
      if (index) {
        const prior = fundamentals[sorted[index - 1].id];
        const current = fundamentals[player.id];
        const gap = prior.expectedPoints - current.expectedPoints;
        const uncertaintyScale = 0.18 * (prior.uncertainty + current.uncertainty);
        if (gap >= Math.max(1.5, uncertaintyScale)) tier++;
      }
      tiers.set(player.id, Math.min(8, tier));
    });
  }
  return tiers;
}

export function buildLeagueIntelligence(
  snapshot: LeagueSnapshot,
  options: IntelligenceBuildOptions = {},
): LeagueIntelligence {
  const selectedPlayers = options.playerIds
    ? [...new Set(options.playerIds)]
        .map((id) => snapshot.players[id])
        .filter((player): player is LeaguePlayer => Boolean(player))
    : Object.values(snapshot.players);
  const fundamentals = Object.fromEntries(
    selectedPlayers.map((p) => [
      p.id,
      estimateFundamental(p, snapshot, options),
    ]),
  );
  const markets = estimateMarkets(snapshot, fundamentals, options);
  const tiers = dynamicTiers(selectedPlayers, fundamentals);
  const fundamentalValues = Object.values(fundamentals).map(
    (f) => f.expectedPoints,
  );
  const raw = selectedPlayers
    .map((p) => ({
      id: p.id,
      gap:
        percentile(fundamentalValues, fundamentals[p.id].expectedPoints) -
        markets[p.id].value,
    }))
    .filter((item) => markets[item.id].sufficientForMispricing);
  const gapMean = mean(raw.map((x) => x.gap));
  const gapSd = Math.sqrt(mean(raw.map((x) => (x.gap - gapMean) ** 2))) || 1;
  const players = Object.fromEntries(
    selectedPlayers.map((player) => {
      const fundamental = fundamentals[player.id],
        market = markets[player.id],
        role = estimateRole(player.primaryPosition, options.usage?.[player.id]);
      const fp = percentile(fundamentalValues, fundamental.expectedPoints);
      const z = market.sufficientForMispricing
        ? (fp - market.value - gapMean) / gapSd
        : undefined;
      // A fresh projection and market feed can be reliable without usage data,
      // but a mispricing recommendation cannot be high-confidence when the
      // role layer has no sample at all.
      const joint =
        Math.min(fundamental.confidence, market.confidence) *
        (role.confidence > 0 ? 0.75 + 0.25 * role.confidence : 0.75);
      const classification =
        z === undefined
          ? "INSUFFICIENT_DATA"
          : z >= 0.65 && !isFallingTrend(role.trend)
            ? "BUY_LOW"
            : z <= -0.65 && !isRisingTrend(role.trend)
              ? "SELL_HIGH"
              : "FAIR";
      const evidence = [
        `Fundamental projection is at the ${ordinal(fp)} league percentile.`,
        ...(market.sufficientForMispricing
          ? [`Market estimate is ${Math.round(market.value)}/100.`]
          : ["Independent market evidence is insufficient for mispricing."]),
        ...role.evidence,
        ...(fundamental.expectedProduction.fantasyPointsOverExpected === undefined
          ? []
          : [
              `Recent production is ${fundamental.expectedProduction.fantasyPointsOverExpected >= 0 ? "+" : ""}${fundamental.expectedProduction.fantasyPointsOverExpected.toFixed(1)} PPR points per game versus opportunity-based expectation.`,
            ]),
      ];
      const risks: string[] = [];
      if (isFallingTrend(role.trend))
        risks.push("Available role evidence is falling.");
      if (fundamental.confidence < 0.45)
        risks.push("Fundamental estimate has limited supporting data.");
      if (market.confidence < 0.45)
        risks.push("Market estimate has limited source coverage.");
      const trajectory = isRisingTrend(role.trend)
        ? 1.15
        : isFallingTrend(role.trend)
          ? 0.7
          : 1;
      const optionValue = round(
        Math.max(
          0,
          (fundamental.ceiling - fundamental.expectedPoints) *
            (0.15 + (0.35 * (role.opportunityScore ?? 0)) / 100) *
            (0.5 + 0.5 * fundamental.confidence) * trajectory,
        ),
      );
      return [
        player.id,
        {
          playerId: player.id,
          position: player.primaryPosition,
          fundamental,
          market,
          role,
          fundamentalPercentile: round(fp),
          fundamentalTier: tiers.get(player.id) ?? 8,
          mispricingZ: z === undefined ? undefined : round(z),
          classification,
          confidence: band(joint),
          optionValue,
          evidence,
          risks,
        } satisfies PlayerIntelligence,
      ];
    }),
  );
  return {
    asOf: snapshot.provenance.asOf,
    modelVersion: INTELLIGENCE_MODEL_VERSION,
    players,
    buyLow: [],
    sellHigh: [],
    dataWarnings: [
      ...(raw.length < 20
        ? [
            "Market coverage is too limited for stable league-wide standardized gaps.",
          ]
        : []),
      ...(Object.values(players).every((p) => p.role.trend === "unknown")
        ? [
            "Usage adapters supplied no route, snap, target, or carry data; role trends are not inferred from fantasy points.",
          ]
        : []),
      ...(options.providerDiagnostics ?? [])
        .filter((item) => item.status !== "available")
        .map(
          (item) =>
            `${item.provider}: ${item.status}${item.message ? ` — ${item.message}` : ""}`,
        ),
    ],
    usage: options.usage,
    marketSources: options.marketSources,
    providerDiagnostics: options.providerDiagnostics,
  };
}

export function applyFundamentalForecasts(
  snapshot: LeagueSnapshot,
  intelligence: LeagueIntelligence,
): LeagueSnapshot {
  const players = { ...snapshot.players };
  for (const intelligencePlayer of Object.values(intelligence.players)) {
    const player = snapshot.players[intelligencePlayer.playerId];
    if (!player) continue;
    const estimate = intelligencePlayer.fundamental;
    const future = player.forecasts.filter(
        (f) => f.week >= snapshot.currentWeek,
      ),
      baseline = mean(future.map((f) => f.mean * f.availabilityProbability)),
      ratio =
        baseline > 0
          ? clamp(estimate.expectedPoints / baseline, 0.85, 1.15)
          : 1;
    players[player.id] = {
      ...player,
      forecasts: player.forecasts.map((forecast) =>
        forecast.week < snapshot.currentWeek
          ? forecast
          : {
              ...forecast,
              mean: round(forecast.mean * ratio),
              lower: round(
                Math.max(
                  0,
                  forecast.mean * ratio - 1.282 * estimate.uncertainty,
                ),
              ),
              upper: round(
                forecast.mean * ratio + 1.282 * estimate.uncertainty,
              ),
              source: `${forecast.source} + bounded role model`,
              version: FUNDAMENTAL_MODEL_VERSION,
            },
      ),
    };
  }
  return {
    ...snapshot,
    players,
    provenance: {
      ...snapshot.provenance,
      version: `${snapshot.provenance.version ?? "snapshot"}+${FUNDAMENTAL_MODEL_VERSION}`,
    },
  };
}

export function confidenceBand(value: number): ConfidenceBand {
  return band(value);
}
