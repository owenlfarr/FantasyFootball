import { evaluateRoster } from "../roster/evaluateRoster";
import { normalizeRosterSize } from "../transactions/evaluateTransactions";
import type { LeagueSnapshot, RosterEntry } from "../types";
import type { AssetCharacterization, AssetClass, SearchCache } from "./types";

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.max(
        0,
        Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)),
      )
    ] ?? 0
  );
}

export function createSearchCache(
  snapshot: LeagueSnapshot,
  exactMarginalTeamIds: string[] = [],
): SearchCache {
  const exactTeams = new Set(exactMarginalTeamIds);
  const baseline = new Map(
    snapshot.teams.map((team) => [
      team.id,
      evaluateRoster(snapshot, team.id, undefined, {
        includeMarginals: exactTeams.has(team.id),
      }),
    ]),
  );
  const removalMarginal = new Map<string, number>();
  for (const team of snapshot.teams) {
    const evaluation = baseline.get(team.id)!;
    for (const entry of team.roster) {
      const exact = evaluation.playerMarginalValues.find(
        (value) => value.playerId === entry.playerId,
      )?.removalUtility;
      if (exact !== undefined) {
        removalMarginal.set(`${team.id}:${entry.playerId}`, round(exact));
        continue;
      }
      const player = snapshot.players[entry.playerId];
      let estimate = 0;
      for (const lineup of evaluation.weeklyLineups) {
        const assignment = lineup.assignments.find(
          (item) => item.playerId === entry.playerId,
        );
        const forecast = player?.forecasts.find(
          (item) => item.week === lineup.week,
        );
        if (!forecast) continue;
        if (assignment) {
          const replacement = Math.max(
            0,
            ...lineup.benchPlayerIds
              .filter((id) =>
                snapshot.players[id]?.eligiblePositions.some((position) =>
                  player.eligiblePositions.includes(position),
                ),
              )
              .map((id) => {
                const f = snapshot.players[id]?.forecasts.find(
                  (item) => item.week === lineup.week,
                );
                return f ? f.mean * f.availabilityProbability : 0;
              }),
          );
          estimate += Math.max(0, assignment.projectedPoints - replacement);
        } else
          estimate += forecast.mean * forecast.availabilityProbability * 0.04;
      }
      removalMarginal.set(`${team.id}:${entry.playerId}`, round(estimate));
    }
  }
  return { baseline, removalMarginal, acquisitionMarginal: new Map() };
}

export function acquisitionValue(
  snapshot: LeagueSnapshot,
  teamId: string,
  playerId: string,
  cache: SearchCache,
): number {
  const key = `${teamId}:${playerId}`;
  const cached = cache.acquisitionMarginal.get(key);
  if (cached !== undefined) return cached;
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) return Number.NEGATIVE_INFINITY;
  if (team.roster.some((entry) => entry.playerId === playerId))
    return cache.removalMarginal.get(key) ?? 0;
  const player = snapshot.players[playerId];
  const baseline = cache.baseline.get(teamId)!;
  let estimate = 0;
  for (const lineup of baseline.weeklyLineups) {
    const forecast = player?.forecasts.find(
      (item) => item.week === lineup.week,
    );
    if (!forecast) continue;
    const projected = forecast.mean * forecast.availabilityProbability;
    const comparable = lineup.assignments.filter((assignment) =>
      snapshot.players[assignment.playerId]?.eligiblePositions.some(
        (position) => player.eligiblePositions.includes(position),
      ),
    );
    const weakest = comparable.length
      ? Math.min(...comparable.map((assignment) => assignment.projectedPoints))
      : 0;
    estimate +=
      Math.max(0, projected - weakest) + Math.min(projected, weakest) * 0.04;
  }
  if (
    team.roster.filter((entry) => entry.location !== "ir").length >=
    snapshot.settings.rosterSize
  ) {
    const cheapest = Math.min(
      ...team.roster
        .filter((entry) => entry.location !== "ir")
        .map(
          (entry) =>
            cache.removalMarginal.get(`${teamId}:${entry.playerId}`) ?? 0,
        ),
    );
    estimate -= Number.isFinite(cheapest) ? cheapest : 0;
  }
  const value = round(estimate);
  cache.acquisitionMarginal.set(key, value);
  return value;
}

export function exactAcquisitionValue(
  snapshot: LeagueSnapshot,
  teamId: string,
  playerId: string,
  cache: SearchCache,
): number {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) return Number.NEGATIVE_INFINITY;
  const bench = snapshot.settings.lineupSlots.find(
    (slot) => slot.kind === "bench",
  );
  const raw: RosterEntry[] = [
    ...team.roster,
    { playerId, assignedSlotId: bench?.espnSlotId ?? -1, location: "bench" },
  ];
  const normalized = normalizeRosterSize(snapshot, teamId, raw);
  const after = evaluateRoster(snapshot, teamId, normalized.roster, {
    includeMarginals: false,
  });
  return round(after.utility.total - cache.baseline.get(teamId)!.utility.total);
}

export function characterizeRosterAssets(
  snapshot: LeagueSnapshot,
  ownerTeamId: string,
  acquiringTeamId: string,
  cache: SearchCache,
): AssetCharacterization[] {
  const team = snapshot.teams.find((candidate) => candidate.id === ownerTeamId);
  if (!team) return [];
  const baseline = cache.baseline.get(ownerTeamId)!;
  const marginalValues = team.roster.map(
    (entry) =>
      cache.removalMarginal.get(`${ownerTeamId}:${entry.playerId}`) ?? 0,
  );
  const coreThreshold = percentile(marginalValues, 0.75);
  const weeks = Math.max(1, baseline.weeklyLineups.length);
  return team.roster.map((entry) => {
    const p = snapshot.players[entry.playerId];
    const marginalValue =
      cache.removalMarginal.get(`${ownerTeamId}:${entry.playerId}`) ?? 0;
    const weeksStarted = baseline.weeklyLineups.filter((lineup) =>
      lineup.assignments.some(
        (assignment) => assignment.playerId === entry.playerId,
      ),
    ).length;
    const starterFrequency = weeksStarted / weeks;
    const playoffContribution = baseline.weeklyLineups
      .filter((lineup) => snapshot.settings.playoffWeeks.includes(lineup.week))
      .flatMap((lineup) => lineup.assignments)
      .filter((assignment) => assignment.playerId === entry.playerId)
      .reduce((sum, assignment) => sum + assignment.projectedPoints, 0);
    const relevant =
      p?.forecasts.filter(
        (forecast) => forecast.week >= snapshot.currentWeek,
      ) ?? [];
    const averageProjection = relevant.length
      ? relevant.reduce(
          (sum, forecast) =>
            sum + forecast.mean * forecast.availabilityProbability,
          0,
        ) / relevant.length
      : 0;
    const depthContribution =
      (1 - starterFrequency) * averageProjection * 0.04 * weeks;
    const strength = baseline.positionalStrengths.find(
      (item) => item.position === p?.primaryPosition,
    );
    const replacementDifficulty = Math.max(
      0,
      (strength?.starterPointsPerWeek ?? 0) -
        Math.max(
          strength?.internalReplacementPointsPerWeek ?? 0,
          strength?.waiverReplacementPointsPerWeek ?? 0,
        ),
    );
    const samePosition = team.roster.filter(
      (candidate) =>
        snapshot.players[candidate.playerId]?.primaryPosition ===
        p?.primaryPosition,
    );
    const positionalRedundancy = samePosition.length
      ? Math.max(
          0,
          samePosition.length -
            samePosition.filter((candidate) =>
              baseline.weeklyLineups.some((lineup) =>
                lineup.assignments.some(
                  (assignment) => assignment.playerId === candidate.playerId,
                ),
              ),
            ).length,
        ) / samePosition.length
      : 0;
    let assetClass: AssetClass = "TRADE_CHIP";
    if (starterFrequency >= 0.8 && marginalValue >= coreThreshold)
      assetClass = "CORE";
    else if (starterFrequency >= 0.5) assetClass = "STARTER";
    else if (depthContribution > Math.max(0.5, marginalValue * 0.2))
      assetClass = "DEPTH_PROTECTION";
    else if (positionalRedundancy >= 0.34 && marginalValue > 0)
      assetClass = "REDUNDANT_VALUE";
    return {
      playerId: entry.playerId,
      teamId: ownerTeamId,
      position: p?.primaryPosition ?? "UNKNOWN",
      assetClass,
      marginalValue: round(marginalValue),
      acquisitionValue: round(
        acquisitionValue(snapshot, acquiringTeamId, entry.playerId, cache),
      ),
      starterFrequency: round(starterFrequency),
      benchFrequency: round(1 - starterFrequency),
      depthContribution: round(depthContribution),
      playoffContribution: round(playoffContribution),
      averageProjection: round(averageProjection),
      replacementDifficulty: round(replacementDifficulty),
      positionalRedundancy: round(positionalRedundancy),
    };
  });
}
