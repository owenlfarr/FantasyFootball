import type { LeagueSnapshot, SnapshotValidation } from "../types";

export function validateLeagueSnapshot(
  snapshot: LeagueSnapshot,
): SnapshotValidation {
  const missingRequirements: string[] = [];
  const warnings: string[] = [];
  const active = snapshot.settings.lineupSlots.filter(
    (slot) => slot.kind === "active" && slot.count > 0,
  );
  if (!snapshot.id) missingRequirements.push("league identity missing");
  if (!snapshot.season) missingRequirements.push("league season missing");
  if (!snapshot.currentWeek)
    missingRequirements.push("current matchup period missing");
  if (!snapshot.settings.scoring.length)
    missingRequirements.push("scoring configuration unavailable");
  if (!active.length)
    missingRequirements.push("active lineup configuration unavailable");
  if (active.some((slot) => !slot.eligiblePositions.length))
    missingRequirements.push("lineup slot eligibility missing");
  if (!snapshot.settings.rosterSize)
    missingRequirements.push("roster size unavailable");
  if (!snapshot.teams.length)
    missingRequirements.push("league teams unavailable");
  if (!snapshot.teams.some((team) => team.id === snapshot.primaryTeamId))
    missingRequirements.push("primary team unavailable");
  if (!Object.keys(snapshot.players).length)
    missingRequirements.push("player pool unavailable");
  if (!snapshot.freeAgentIds.length)
    warnings.push(
      "free-agent pool unavailable; waiver replacement values are omitted",
    );
  if (!snapshot.settings.playoffWeeks.length)
    warnings.push("playoff weeks unavailable; playoff utility is omitted");
  const forecasted = Object.values(snapshot.players).filter(
    (player) => player.forecasts.length > 0,
  ).length;
  if (!forecasted) missingRequirements.push("player forecasts unavailable");
  return {
    status: missingRequirements.length ? "ENGINE_NOT_READY" : "READY",
    missingRequirements,
    warnings,
  };
}
