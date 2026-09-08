import type {
  LeaguePlayer,
  LeagueSettings,
  LineupAssignment,
  LineupEvaluation,
  PlayerForecast,
  RosterEntry,
} from "../types";
import { profileSync, recordCache, recordState } from "../performance/profile";
import {
  forecastState,
  getLeagueSettingsVersion,
} from "../performance/evaluationKeys";

interface SlotInstance {
  id: string;
  name: string;
  eligible: Set<string>;
}
interface Candidate {
  id: string;
  player: LeaguePlayer;
  points: number;
}
const lineupCache = new WeakMap<object, Map<string, LineupEvaluation>>();

function slotInstances(settings: LeagueSettings): SlotInstance[] {
  return settings.lineupSlots
    .filter((slot) => slot.kind === "active")
    .flatMap((slot) =>
      Array.from({ length: slot.count }, (_, index) => ({
        id: `${slot.id}:${index}`,
        name: slot.name,
        eligible: new Set(slot.eligiblePositions),
      })),
    );
}

function unavailable(
  player: LeaguePlayer,
  week: number,
  forecast?: PlayerForecast,
): boolean {
  return (
    player.byeWeeks?.includes(week) === true ||
    !forecast ||
    forecast.availabilityProbability <= 0
  );
}

export function optimizeLineup(
  roster: RosterEntry[],
  week: number,
  forecasts: ReadonlyMap<string, PlayerForecast>,
  settings: LeagueSettings,
  players: Readonly<Record<string, LeaguePlayer>>,
): LineupEvaluation {
  const cache =
    lineupCache.get(players as object) ?? new Map<string, LineupEvaluation>();
  if (!lineupCache.has(players as object))
    lineupCache.set(players as object, cache);
  const cacheKey = `${week}|${getLeagueSettingsVersion(settings)}|${roster
    .map((entry) => {
      const player = players[entry.playerId];
      return `${entry.playerId}:${entry.assignedSlotId}:${entry.location}:${player?.injuryStatus ?? ""}:${[...(player?.byeWeeks ?? [])].sort((a, b) => a - b).join("+")}:${[...(player?.eligiblePositions ?? [])].sort().join("+")}:${forecastState(forecasts.get(entry.playerId))}`;
    })
    .sort()
    .join(",")}`;
  const cached = cache.get(cacheKey);
  recordState("lineupOptimization", cacheKey);
  if (cached) {
    recordCache("lineupOptimization", true);
    return profileSync("lineupOptimization", () => cached);
  }
  recordCache("lineupOptimization", false);
  return profileSync("lineupOptimization", () => {
    const slots = slotInstances(settings);
    const candidates: Candidate[] = roster
      .filter((entry) => entry.location !== "ir")
      .flatMap((entry) => {
        const player = players[entry.playerId];
        const forecast = forecasts.get(entry.playerId);
        if (!player || unavailable(player, week, forecast)) return [];
        return [
          {
            id: entry.playerId,
            player,
            points: Math.max(
              0,
              forecast!.mean * forecast!.availabilityProbability,
            ),
          },
        ];
      });

    // Exact maximum-weight matching via DP over filled-slot bitmasks. Iterating players
    // means a player can be assigned at most once; the state space is 2^startingSlots
    // (normally about 1,024), substantially smaller than 2^rosterSize.
    type State = { points: number; picks: number[] };
    let states = new Map<number, State>([
      [0, { points: 0, picks: Array(slots.length).fill(-1) }],
    ]);
    for (
      let candidateIndex = 0;
      candidateIndex < candidates.length;
      candidateIndex++
    ) {
      const candidate = candidates[candidateIndex];
      const next = new Map<number, State>(states);
      for (const [mask, state] of states) {
        for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
          const slot = slots[slotIndex];
          const bit = 2 ** slotIndex;
          if (
            (mask & bit) !== 0 ||
            !candidate.player.eligiblePositions.some((position) =>
              slot.eligible.has(position),
            )
          )
            continue;
          const newMask = mask | bit;
          const points = state.points + candidate.points;
          const previous = next.get(newMask);
          if (!previous || points > previous.points) {
            const picks = [...state.picks];
            picks[slotIndex] = candidateIndex;
            next.set(newMask, { points, picks });
          }
        }
      }
      states = next;
    }
    const best = [...states.values()].reduce(
      (winner, state) => {
        const assigned = state.picks.filter((pick) => pick >= 0).length;
        const winnerAssigned = winner.picks.filter((pick) => pick >= 0).length;
        return assigned > winnerAssigned ||
          (assigned === winnerAssigned && state.points > winner.points)
          ? state
          : winner;
      },
      { points: Number.NEGATIVE_INFINITY, picks: [] as number[] },
    );
    const assignments: LineupAssignment[] = best.picks.flatMap(
      (candidateIndex, slotIndex) =>
        candidateIndex < 0
          ? []
          : [
              {
                slotInstanceId: slots[slotIndex].id,
                slotName: slots[slotIndex].name,
                playerId: candidates[candidateIndex].id,
                projectedPoints: candidates[candidateIndex].points,
              },
            ],
    );
    const selected = new Set(
      assignments.map((assignment) => assignment.playerId),
    );
    const missingSlots = slots
      .filter((_, index) => best.picks[index] < 0)
      .map((slot) => slot.name);
    const result: LineupEvaluation = {
      week,
      legal: missingSlots.length === 0,
      projectedPoints: Math.round(best.points * 1000) / 1000,
      assignments,
      benchPlayerIds: roster
        .filter(
          (entry) => entry.location !== "ir" && !selected.has(entry.playerId),
        )
        .map((entry) => entry.playerId),
      missingSlots,
      warnings: missingSlots.length
        ? [
            {
              code: "MISSING_MANDATORY_STARTER",
              severity: "error",
              message: `No eligible player is available for: ${missingSlots.join(", ")}.`,
              weeks: [week],
            },
          ]
        : [],
    };
    cache.set(cacheKey, result);
    return result;
  });
}

function sameRosterEntry(a: RosterEntry, b: RosterEntry) {
  return (
    a.playerId === b.playerId &&
    a.location === b.location &&
    a.assignedSlotId === b.assignedSlotId
  );
}

export function optimizeLineupIncremental(
  baselineRoster: RosterEntry[],
  baseline: LineupEvaluation,
  roster: RosterEntry[],
  week: number,
  forecasts: ReadonlyMap<string, PlayerForecast>,
  settings: LeagueSettings,
  players: Readonly<Record<string, LeaguePlayer>>,
  explicitChangedPlayerIds: readonly string[] = [],
): LineupEvaluation {
  return profileSync("incrementalLineup", () => {
    const tracksDepthReuse = explicitChangedPlayerIds.length > 0;
    if (!baseline.legal || baseline.week !== week) {
      if (tracksDepthReuse) recordCache("depthScenarios", false);
      return optimizeLineup(roster, week, forecasts, settings, players);
    }
    const changed = new Set(explicitChangedPlayerIds);
    for (const entry of baselineRoster)
      if (!roster.some((candidate) => sameRosterEntry(entry, candidate)))
        changed.add(entry.playerId);
    for (const entry of roster)
      if (
        !baselineRoster.some((candidate) => sameRosterEntry(entry, candidate))
      )
        changed.add(entry.playerId);
    const active = settings.lineupSlots.filter(
      (slot) => slot.kind === "active",
    );
    const changedPositions = new Set(
      [...changed].flatMap((id) => players[id]?.eligiblePositions ?? []),
    );
    const affected = new Set(
      active
        .filter((slot) =>
          slot.eligiblePositions.some((position) =>
            changedPositions.has(position),
          ),
        )
        .map((slot) => slot.id),
    );
    let expanded = true;
    while (expanded) {
      expanded = false;
      const connectedPositions = new Set(
        active
          .filter((slot) => affected.has(slot.id))
          .flatMap((slot) => slot.eligiblePositions),
      );
      for (const slot of active)
        if (
          !affected.has(slot.id) &&
          slot.eligiblePositions.some((position) =>
            connectedPositions.has(position),
          )
        ) {
          affected.add(slot.id);
          expanded = true;
        }
    }
    if (affected.size === active.length) {
      if (tracksDepthReuse) recordCache("depthScenarios", false);
      return optimizeLineup(roster, week, forecasts, settings, players);
    }
    if (tracksDepthReuse) recordCache("depthScenarios", true);
    const fixedAssignments = baseline.assignments.filter(
      (assignment) =>
        !active.some(
          (slot) =>
            affected.has(slot.id) &&
            assignment.slotInstanceId.startsWith(`${slot.id}:`),
        ),
    );
    const fixedPlayers = new Set(
      fixedAssignments.map((assignment) => assignment.playerId),
    );
    const reducedSettings: LeagueSettings = {
      ...settings,
      lineupSlots: settings.lineupSlots.filter(
        (slot) => slot.kind !== "active" || affected.has(slot.id),
      ),
    };
    const reducedRoster = roster.filter(
      (entry) => !fixedPlayers.has(entry.playerId),
    );
    const changedResult = optimizeLineup(
      reducedRoster,
      week,
      forecasts,
      reducedSettings,
      players,
    );
    // Preserve the legacy optimizer's slot-instance ordering. Besides producing a
    // stable result object, this keeps floating-point summation and V1's rounded
    // depth deltas byte-for-byte compatible with a full solve.
    const slotOrder = new Map(
      slotInstances(settings).map((slot, index) => [slot.id, index]),
    );
    const assignments = [...fixedAssignments, ...changedResult.assignments].sort(
      (left, right) =>
        (slotOrder.get(left.slotInstanceId) ?? Number.MAX_SAFE_INTEGER) -
        (slotOrder.get(right.slotInstanceId) ?? Number.MAX_SAFE_INTEGER),
    );
    const selected = new Set(
      assignments.map((assignment) => assignment.playerId),
    );
    const pointsByPlayer = new Map<string, number[]>();
    for (const assignment of assignments)
      pointsByPlayer.set(assignment.playerId, [
        ...(pointsByPlayer.get(assignment.playerId) ?? []),
        assignment.projectedPoints,
      ]);
    const missingSlots = changedResult.missingSlots;
    return {
      week,
      legal: missingSlots.length === 0,
      projectedPoints:
        Math.round(
          // The full DP accumulates selected players in roster/candidate order.
          // Mirroring that order is necessary for exact floating-point parity at
          // V1's three-decimal rounding boundary.
          roster.reduce((sum, entry) => {
            const points = pointsByPlayer.get(entry.playerId);
            if (!points?.length) return sum;
            return sum + points.shift()!;
          }, 0) * 1000,
        ) / 1000,
      assignments,
      benchPlayerIds: roster
        .filter(
          (entry) => entry.location !== "ir" && !selected.has(entry.playerId),
        )
        .map((entry) => entry.playerId),
      missingSlots,
      warnings: missingSlots.length
        ? [
            {
              code: "MISSING_MANDATORY_STARTER",
              severity: "error",
              message: `No eligible player is available for: ${missingSlots.join(", ")}.`,
              weeks: [week],
            },
          ]
        : [],
    };
  });
}
