import type {
  LeagueSettings,
  LeagueSnapshot,
  PlayerForecast,
  RosterEntry,
  RosterUtilityConfig,
} from "../types";

const rosterPart = (roster: RosterEntry[]) =>
  roster
    .map(
      (entry) => `${entry.playerId}:${entry.assignedSlotId}:${entry.location}`,
    )
    .sort()
    .join(",");

export function getLeagueSettingsVersion(settings: LeagueSettings): string {
  return settings.lineupSlots
    .map(
      (slot) =>
        `${slot.id}:${slot.espnSlotId}:${slot.kind}:${slot.count}:${[...slot.eligiblePositions].sort().join("+")}`,
    )
    .sort()
    .join(",");
}

function playerState(
  snapshot: LeagueSnapshot,
  roster: RosterEntry[],
  weeks: number[],
) {
  const wanted = new Set(weeks);
  return roster
    .map((entry) => {
      const player = snapshot.players[entry.playerId];
      const forecasts = (player?.forecasts ?? [])
        .filter((forecast) => wanted.has(forecast.week))
        .map(
          (forecast) =>
            `${forecast.week}:${forecast.mean}:${forecast.lower}:${forecast.upper}:${forecast.availabilityProbability}:${forecast.version ?? ""}:${forecast.asOf}`,
        )
        .sort()
        .join(";");
      return `${entry.playerId}:${player?.injuryStatus ?? ""}:${[...(player?.byeWeeks ?? [])].sort((a, b) => a - b).join("+")}:${[...(player?.eligiblePositions ?? [])].sort().join("+")}:${forecasts}`;
    })
    .sort()
    .join("|");
}

export function getLineupEvaluationKey(
  snapshot: LeagueSnapshot,
  roster: RosterEntry[],
  week: number,
  settings: LeagueSettings = snapshot.settings,
): string {
  return `${week}|${getLeagueSettingsVersion(settings)}|${rosterPart(roster)}|${playerState(snapshot, roster, [week])}`;
}

export function getRosterEvaluationKey(
  snapshot: LeagueSnapshot,
  teamId: string,
  roster: RosterEntry[],
  weeks: number[],
  config: RosterUtilityConfig,
  includeMarginals: boolean,
): string {
  const configVersion = `${config.regularSeasonWeight}:${config.playoffWeight}:${config.depthWeight}:${config.vulnerabilityPenaltyWeight}:${Object.entries(
    config.positionMissedGameProbability,
  )
    .sort()
    .map(([position, value]) => `${position}:${value}`)
    .join(",")}`;
  return [
    teamId,
    includeMarginals ? "m" : "n",
    snapshot.currentWeek,
    snapshot.provenance.version ?? "",
    snapshot.provenance.asOf,
    weeks.join(","),
    getLeagueSettingsVersion(snapshot.settings),
    configVersion,
    rosterPart(roster),
    playerState(snapshot, roster, weeks),
  ].join("|");
}

export function forecastState(forecast: PlayerForecast | undefined): string {
  return forecast
    ? `${forecast.playerId}:${forecast.week}:${forecast.mean}:${forecast.availabilityProbability}:${forecast.version ?? ""}:${forecast.asOf}`
    : "missing";
}
