import type {
  CanonicalPosition,
  EvaluationWarning,
  LeagueSnapshot,
  PlayerForecast,
  RosterEntry,
  RosterEvaluation,
  RosterUtilityConfig,
} from "../types";
import {
  optimizeLineup,
  optimizeLineupIncremental,
} from "../lineup/optimizeLineup";
import { getRosterEvaluationKey } from "../performance/evaluationKeys";
import {
  calculatePositionStrengths,
  exceedsPositionLimit,
} from "./replacement";
import { recordCache, recordState, recordTiming } from "../performance/profile";

export const DEFAULT_UTILITY_CONFIG: RosterUtilityConfig = {
  regularSeasonWeight: 1,
  playoffWeight: 0.25,
  depthWeight: 0.5,
  vulnerabilityPenaltyWeight: 0.75,
  positionMissedGameProbability: {
    QB: 0.05,
    RB: 0.15,
    WR: 0.12,
    TE: 0.12,
    K: 0.03,
    "D/ST": 0.03,
    HC: 0.03,
    DL: 0.08,
    LB: 0.08,
    DB: 0.08,
    P: 0.03,
  },
};

export interface EvaluateRosterOptions {
  weeks?: number[];
  config?: RosterUtilityConfig;
  includeMarginals?: boolean;
  /** Test/diagnostic oracle; production uses the exact incremental path. */
  useIncrementalDepth?: boolean;
}
const rosterEvaluationCache = new WeakMap<
  LeagueSnapshot,
  Map<string, RosterEvaluation>
>();

function forecastMaps(
  snapshot: LeagueSnapshot,
  roster: RosterEntry[],
  weeks: number[],
): Map<number, Map<string, PlayerForecast>> {
  return new Map(
    weeks.map((week) => [
      week,
      new Map(
        roster.flatMap((entry) => {
          const forecast = snapshot.players[entry.playerId]?.forecasts.find(
            (item) => item.week === week,
          );
          return forecast ? [[entry.playerId, forecast] as const] : [];
        }),
      ),
    ]),
  );
}
function uniqueWeeks(snapshot: LeagueSnapshot): number[] {
  const end = Math.max(
    snapshot.settings.regularSeasonWeeks ?? snapshot.currentWeek,
    ...snapshot.settings.playoffWeeks,
    ...Object.values(snapshot.players).flatMap((player) =>
      player.forecasts.map((forecast) => forecast.week),
    ),
    snapshot.currentWeek,
  );
  return Array.from(
    { length: Math.max(1, end - snapshot.currentWeek + 1) },
    (_, index) => snapshot.currentWeek + index,
  );
}
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
const clock = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export function evaluateRoster(
  snapshot: LeagueSnapshot,
  teamId: string,
  rosterOverride?: RosterEntry[],
  options: EvaluateRosterOptions = {},
): RosterEvaluation {
  const evaluationStarted = clock();
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error(`Unknown team ${teamId}.`);
  const roster = rosterOverride ?? team.roster;
  const weeks = options.weeks ?? uniqueWeeks(snapshot);
  const config = options.config ?? DEFAULT_UTILITY_CONFIG;
  const snapshotCache =
    rosterEvaluationCache.get(snapshot) ?? new Map<string, RosterEvaluation>();
  if (!rosterEvaluationCache.has(snapshot))
    rosterEvaluationCache.set(snapshot, snapshotCache);
  const cacheKey = `${options.useIncrementalDepth === false ? "legacy" : "incremental"}|${getRosterEvaluationKey(
    snapshot,
    teamId,
    roster,
    weeks,
    config,
    options.includeMarginals !== false,
  )}`;
  const cached = snapshotCache.get(cacheKey);
  recordState("evaluateRoster", cacheKey);
  if (cached) {
    recordCache("evaluateRoster", true);
    recordTiming("evaluateRoster", clock() - evaluationStarted);
    return cached;
  }
  recordCache("evaluateRoster", false);
  const forecastStarted = clock();
  const maps = forecastMaps(snapshot, roster, weeks);
  recordTiming("forecastPreparation", clock() - forecastStarted);
  const baselineStarted = clock();
  const weeklyLineups = weeks.map((week) =>
    optimizeLineup(
      roster,
      week,
      maps.get(week)!,
      snapshot.settings,
      snapshot.players,
    ),
  );
  recordTiming("baselineRoster", clock() - baselineStarted);
  const expectedRemainingStarterPoints = weeklyLineups.reduce(
    (sum, lineup) => sum + lineup.projectedPoints,
    0,
  );
  const playoffLineups = weeklyLineups.filter((lineup) =>
    snapshot.settings.playoffWeeks.includes(lineup.week),
  );
  const expectedPlayoffStarterPoints = snapshot.settings.playoffWeeks.length
    ? playoffLineups.reduce((sum, lineup) => sum + lineup.projectedPoints, 0)
    : undefined;
  const warnings: EvaluationWarning[] = weeklyLineups.flatMap(
    (lineup) => lineup.warnings,
  );
  const overLimits = exceedsPositionLimit(snapshot, roster);
  if (overLimits.length)
    warnings.push({
      code: "POSITION_LIMIT_EXCEEDED",
      severity: "error",
      message: `Position limit exceeded: ${overLimits.join(", ")}.`,
    });
  const nonIrCount = roster.filter((entry) => entry.location !== "ir").length;
  if (nonIrCount > snapshot.settings.rosterSize)
    warnings.push({
      code: "ROSTER_SIZE_EXCEEDED",
      severity: "error",
      message: `Roster has ${nonIrCount - snapshot.settings.rosterSize} player(s) too many.`,
    });
  let depthValue = 0;
  let vulnerabilityPenalty = 0;
  const positionVulnerability = new Map<CanonicalPosition, number>();
  const depthStarted = clock();
  for (const lineup of weeklyLineups)
    for (const assignment of lineup.assignments) {
      const player = snapshot.players[assignment.playerId];
      if (!player) continue;
      const probability =
        config.positionMissedGameProbability[player.primaryPosition] ?? 0.1;
      const reduced = roster.filter(
        (entry) => entry.playerId !== assignment.playerId,
      );
      const depthStateKey = `${lineup.week}|${reduced
        .map((entry) => `${entry.playerId}:${entry.location}`)
        .sort()
        .join(",")}`;
      recordState("depthScenarios", depthStateKey);
      const replacement =
        options.useIncrementalDepth === false
          ? optimizeLineup(
              reduced,
              lineup.week,
              maps.get(lineup.week)!,
              snapshot.settings,
              snapshot.players,
            )
          : optimizeLineupIncremental(
              roster,
              lineup,
              reduced,
              lineup.week,
              maps.get(lineup.week)!,
              snapshot.settings,
              snapshot.players,
              [assignment.playerId],
            );
      const actualLoss = Math.max(
        0,
        lineup.projectedPoints - replacement.projectedPoints,
      );
      const coverage = Math.max(0, assignment.projectedPoints - actualLoss);
      depthValue += probability * coverage;
      vulnerabilityPenalty += probability * actualLoss;
      positionVulnerability.set(
        player.primaryPosition,
        (positionVulnerability.get(player.primaryPosition) ?? 0) +
          probability * actualLoss,
      );
    }
  recordTiming("depthScenarios", clock() - depthStarted);
  const positionalStrengths = calculatePositionStrengths(
    snapshot,
    roster,
    weeklyLineups,
    maps,
  ).map((strength) => ({
    ...strength,
    vulnerabilityPoints: round(
      positionVulnerability.get(strength.position) ?? 0,
    ),
  }));
  const regularSeasonPoints = weeklyLineups
    .filter((lineup) => !snapshot.settings.playoffWeeks.includes(lineup.week))
    .reduce((sum, lineup) => sum + lineup.projectedPoints, 0);
  // The baseline includes every remaining evaluated week. playoffWeight is an
  // additional premium, not a replacement for the baseline value of those weeks.
  const utilityTotal =
    config.regularSeasonWeight * expectedRemainingStarterPoints +
    config.playoffWeight * (expectedPlayoffStarterPoints ?? 0) +
    config.depthWeight * depthValue -
    config.vulnerabilityPenaltyWeight * vulnerabilityPenalty;
  const totalStarterPoints = Math.max(1, expectedRemainingStarterPoints);
  const topContributions = new Map<string, number>();
  weeklyLineups
    .flatMap((lineup) => lineup.assignments)
    .forEach((assignment) =>
      topContributions.set(
        assignment.playerId,
        (topContributions.get(assignment.playerId) ?? 0) +
          assignment.projectedPoints,
      ),
    );
  const sortedContributions = [...topContributions.values()].sort(
    (a, b) => b - a,
  );
  const starterConcentration =
    sortedContributions.slice(0, 5).reduce((sum, value) => sum + value, 0) /
    totalStarterPoints;
  const starterMeans = [...topContributions.entries()].map(([id, points]) => ({
    id,
    points: points / Math.max(1, weeks.length),
  }));
  const byPosition = new Map<CanonicalPosition, number[]>();
  starterMeans.forEach(({ id, points }) => {
    const position = snapshot.players[id]?.primaryPosition ?? "UNKNOWN";
    byPosition.set(position, [...(byPosition.get(position) ?? []), points]);
  });
  const eliteAssetCount = [...byPosition.values()].reduce((count, values) => {
    const threshold =
      values.sort((a, b) => b - a)[
        Math.max(0, Math.ceil(values.length * 0.2) - 1)
      ] ?? Infinity;
    return count + values.filter((value) => value >= threshold).length;
  }, 0);
  const benchRedundancy = weeklyLineups.length
    ? weeklyLineups.reduce(
        (sum, lineup) =>
          sum +
          lineup.benchPlayerIds.filter(
            (id) =>
              !lineup.assignments.some(
                (assignment) => assignment.playerId === id,
              ),
          ).length,
        0,
      ) / weeklyLineups.length
    : 0;
  const forecastPairs = weeks.flatMap((week) =>
    roster.map(
      (entry) =>
        snapshot.players[entry.playerId]?.forecasts.some(
          (forecast) => forecast.week === week,
        ) ?? false,
    ),
  );
  const missingForecasts = forecastPairs.filter(
    (available) => !available,
  ).length;
  const coverage = forecastPairs.length
    ? (forecastPairs.length - missingForecasts) / forecastPairs.length
    : 0;
  const base: RosterEvaluation = {
    teamId,
    legal: warnings.every((warning) => warning.severity !== "error"),
    weeklyLineups,
    expectedRemainingStarterPoints: round(expectedRemainingStarterPoints),
    expectedPlayoffStarterPoints:
      expectedPlayoffStarterPoints === undefined
        ? undefined
        : round(expectedPlayoffStarterPoints),
    positionalStrengths,
    depthValue: round(depthValue),
    injuryResilience: round(
      (depthValue / Math.max(0.001, depthValue + vulnerabilityPenalty)) * 100,
    ),
    vulnerabilityPenalty: round(vulnerabilityPenalty),
    playerMarginalValues: [],
    byeWeekVulnerabilities: weeklyLineups.flatMap((lineup) =>
      lineup.missingSlots.map((slot) => ({
        week: lineup.week,
        position: slot as CanonicalPosition,
        missingSlots: 1,
        projectedLoss: 0,
      })),
    ),
    eliteAssetCount,
    starterConcentration: round(starterConcentration),
    benchRedundancy: round(benchRedundancy),
    utility: {
      regularSeasonStarterPoints: round(regularSeasonPoints),
      playoffStarterPoints: round(expectedPlayoffStarterPoints ?? 0),
      depthValue: round(depthValue),
      vulnerabilityPenalty: round(vulnerabilityPenalty),
      total: round(utilityTotal),
    },
    warnings,
    dataConfidence: {
      level: coverage >= 0.9 ? "high" : coverage >= 0.65 ? "medium" : "low",
      forecastCoverage: round(coverage),
      missingForecasts,
      notes: [
        "V1 intervals use conservative position-level residual defaults.",
      ],
    },
  };
  const marginalStarted = clock();
  if (options.includeMarginals !== false)
    base.playerMarginalValues = roster.map((entry) => {
      const after = evaluateRoster(
        snapshot,
        teamId,
        roster.filter((candidate) => candidate.playerId !== entry.playerId),
        { ...options, includeMarginals: false },
      );
      const weeksStarted = weeklyLineups
        .filter((lineup) =>
          lineup.assignments.some(
            (assignment) => assignment.playerId === entry.playerId,
          ),
        )
        .map((lineup) => lineup.week);
      return {
        playerId: entry.playerId,
        removalUtility: round(base.utility.total - after.utility.total),
        starterPointsLost: round(
          base.expectedRemainingStarterPoints -
            after.expectedRemainingStarterPoints,
        ),
        depthLost: round(base.depthValue - after.depthValue),
        weeksStarted,
      };
    });
  if (options.includeMarginals !== false)
    recordTiming("marginalValues", clock() - marginalStarted);
  snapshotCache.set(cacheKey, base);
  recordTiming("evaluateRoster", clock() - evaluationStarted);
  return base;
}

export function marginalValue(
  playerId: string,
  snapshot: LeagueSnapshot,
  teamId: string,
  rosterOverride?: RosterEntry[],
): number {
  const started = clock();
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error(`Unknown team ${teamId}.`);
  const roster = rosterOverride ?? team.roster;
  const withPlayer = evaluateRoster(snapshot, teamId, roster, {
    includeMarginals: false,
  });
  const without = evaluateRoster(
    snapshot,
    teamId,
    roster.filter((entry) => entry.playerId !== playerId),
    { includeMarginals: false },
  );
  const result = round(withPlayer.utility.total - without.utility.total);
  recordTiming("marginalValue", clock() - started);
  return result;
}
