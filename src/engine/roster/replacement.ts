import type {
  CanonicalPosition,
  LeagueSnapshot,
  LineupEvaluation,
  PlayerForecast,
  PositionStrength,
  RosterEntry,
} from "../types";

function average(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

export function calculatePositionStrengths(
  snapshot: LeagueSnapshot,
  roster: RosterEntry[],
  lineups: LineupEvaluation[],
  forecastMaps: Map<number, Map<string, PlayerForecast>>,
): PositionStrength[] {
  const positions = [
    ...new Set(
      snapshot.settings.lineupSlots
        .filter((slot) => slot.kind === "active")
        .flatMap((slot) => slot.eligiblePositions),
    ),
  ];
  return positions.map((position) => {
    const starterByWeek = lineups.map((lineup) =>
      lineup.assignments
        .filter(
          (assignment) =>
            snapshot.players[assignment.playerId]?.primaryPosition === position,
        )
        .reduce((sum, assignment) => sum + assignment.projectedPoints, 0),
    );
    const internalByWeek = lineups.map((lineup) =>
      Math.max(
        0,
        ...lineup.benchPlayerIds
          .filter((id) =>
            snapshot.players[id]?.eligiblePositions.includes(position),
          )
          .map((id) => {
            const forecast = forecastMaps.get(lineup.week)?.get(id);
            return forecast
              ? forecast.mean * forecast.availabilityProbability
              : 0;
          }),
      ),
    );
    const waiverByWeek = lineups.map((lineup) =>
      Math.max(
        0,
        ...snapshot.freeAgentIds
          .filter((id) =>
            snapshot.players[id]?.eligiblePositions.includes(position),
          )
          .map((id) => {
            const forecast = forecastMaps.get(lineup.week)?.get(id);
            return forecast
              ? forecast.mean * forecast.availabilityProbability
              : 0;
          }),
      ),
    );
    return {
      position,
      starterPointsPerWeek: average(starterByWeek),
      internalReplacementPointsPerWeek: average(internalByWeek),
      waiverReplacementPointsPerWeek: average(waiverByWeek),
      vulnerabilityPoints: 0,
    };
  });
}

export function exceedsPositionLimit(
  snapshot: LeagueSnapshot,
  roster: RosterEntry[],
): CanonicalPosition[] {
  return Object.entries(snapshot.settings.positionLimits).flatMap(
    ([position, limit]) => {
      if (!limit || limit < 0) return [];
      const count = roster.filter(
        (entry) =>
          snapshot.players[entry.playerId]?.primaryPosition === position,
      ).length;
      return count > limit ? [position as CanonicalPosition] : [];
    },
  );
}
