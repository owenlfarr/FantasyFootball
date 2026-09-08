import type {
  EvaluationWarning,
  LeagueSnapshot,
  PositionChange,
  RequiredDrop,
  RosterEntry,
  TeamTransactionImpact,
  TransactionEvaluation,
} from "../types";
import { explainRosterChange } from "../explain/explainTransaction";
import { evaluateRoster } from "../roster/evaluateRoster";
import { exceedsPositionLimit } from "../roster/replacement";
import { profileSync, recordCache, recordState } from "../performance/profile";

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function combinations<T>(
  values: T[],
  count: number,
  start = 0,
  prefix: T[] = [],
  output: T[][] = [],
): T[][] {
  if (prefix.length === count) {
    output.push([...prefix]);
    return output;
  }
  for (
    let index = start;
    index <= values.length - (count - prefix.length);
    index++
  )
    combinations(values, count, index + 1, [...prefix, values[index]], output);
  return output;
}
function incomingEntry(
  snapshot: LeagueSnapshot,
  playerId: string,
): RosterEntry {
  const bench = snapshot.settings.lineupSlots.find(
    (slot) => slot.kind === "bench",
  );
  return {
    playerId,
    assignedSlotId: bench?.espnSlotId ?? -1,
    location: "bench",
  };
}
function ensureUnique(roster: RosterEntry[]): void {
  const ids = roster.map((entry) => entry.playerId);
  if (new Set(ids).size !== ids.length)
    throw new Error("Transaction creates duplicate player ownership.");
}
const requiredDropCache = new WeakMap<
  LeagueSnapshot,
  Map<string, { roster: RosterEntry[]; drops: RequiredDrop[] }>
>();

export function normalizeRosterSize(
  snapshot: LeagueSnapshot,
  teamId: string,
  roster: RosterEntry[],
): { roster: RosterEntry[]; drops: RequiredDrop[] } {
  const activeCount = roster.filter((entry) => entry.location !== "ir").length;
  const excess = activeCount - snapshot.settings.rosterSize;
  if (excess <= 0) return { roster, drops: [] };
  const dropStateKey = `${snapshot.currentWeek}|${snapshot.provenance.version ?? ""}|${teamId}|${excess}|${roster
    .map((entry) => {
      const player = snapshot.players[entry.playerId];
      return `${entry.playerId}:${entry.assignedSlotId}:${entry.location}:${player?.injuryStatus ?? ""}:${[...(player?.byeWeeks ?? [])].sort((a, b) => a - b).join("+")}:${(player?.forecasts ?? []).map((forecast) => `${forecast.week}:${forecast.mean}:${forecast.availabilityProbability}:${forecast.version ?? ""}`).join(";")}`;
    })
    .sort()
    .join(",")}`;
  recordState("requiredDropSearch", dropStateKey);
  const cache =
    requiredDropCache.get(snapshot) ??
    new Map<string, { roster: RosterEntry[]; drops: RequiredDrop[] }>();
  if (!requiredDropCache.has(snapshot)) requiredDropCache.set(snapshot, cache);
  const cached = cache.get(dropStateKey);
  if (cached) {
    recordCache("requiredDropSearch", true);
    return cached;
  }
  recordCache("requiredDropSearch", false);
  return profileSync("requiredDropSearch", () => {
    const candidates = roster.filter((entry) => entry.location !== "ir");
    let best:
      | { roster: RosterEntry[]; utility: number; ids: string[] }
      | undefined;
    for (const dropEntries of combinations(candidates, excess)) {
      const ids = new Set(dropEntries.map((entry) => entry.playerId));
      const candidateRoster = roster.filter(
        (entry) => !ids.has(entry.playerId),
      );
      if (exceedsPositionLimit(snapshot, candidateRoster).length) continue;
      const evaluation = evaluateRoster(snapshot, teamId, candidateRoster, {
        includeMarginals: false,
      });
      if (
        (!best || evaluation.utility.total > best.utility) &&
        evaluation.legal
      )
        best = {
          roster: candidateRoster,
          utility: evaluation.utility.total,
          ids: [...ids],
        };
    }
    if (!best) return { roster, drops: [] };
    const overfull = evaluateRoster(snapshot, teamId, roster, {
      includeMarginals: false,
    });
    const result = {
      roster: best.roster,
      drops: best.ids.map((playerId) => ({
        teamId,
        playerId,
        utilityCost: round(overfull.utility.total - best!.utility),
      })),
    };
    cache.set(dropStateKey, result);
    return result;
  });
}

function positionChanges(
  before: ReturnType<typeof evaluateRoster>,
  after: ReturnType<typeof evaluateRoster>,
): PositionChange[] {
  const positions = new Set([
    ...before.positionalStrengths.map((item) => item.position),
    ...after.positionalStrengths.map((item) => item.position),
  ]);
  return [...positions].map((position) => {
    const a = before.positionalStrengths.find(
      (item) => item.position === position,
    );
    const b = after.positionalStrengths.find(
      (item) => item.position === position,
    );
    return {
      position,
      starterPointsDelta: round(
        (b?.starterPointsPerWeek ?? 0) - (a?.starterPointsPerWeek ?? 0),
      ),
      replacementPointsDelta: round(
        (b?.internalReplacementPointsPerWeek ?? 0) -
          (a?.internalReplacementPointsPerWeek ?? 0),
      ),
      vulnerabilityDelta: round(
        (b?.vulnerabilityPoints ?? 0) - (a?.vulnerabilityPoints ?? 0),
      ),
    };
  });
}
export interface TransactionEvaluationOptions {
  baselineEvaluations?: ReadonlyMap<string, ReturnType<typeof evaluateRoster>>;
  includeMarginals?: boolean;
}
function impact(
  snapshot: LeagueSnapshot,
  teamId: string,
  afterRoster: RosterEntry[],
  requiredDrops: RequiredDrop[],
  options: TransactionEvaluationOptions = {},
): TeamTransactionImpact {
  const includeMarginals = options.includeMarginals ?? true;
  const before =
    options.baselineEvaluations?.get(teamId) ??
    evaluateRoster(snapshot, teamId, undefined, { includeMarginals });
  const after = evaluateRoster(snapshot, teamId, afterRoster, {
    includeMarginals,
  });
  const weeklyStarterDeltas = Object.fromEntries(
    after.weeklyLineups.map((lineup) => [
      lineup.week,
      round(
        lineup.projectedPoints -
          (before.weeklyLineups.find((item) => item.week === lineup.week)
            ?.projectedPoints ?? 0),
      ),
    ]),
  );
  return {
    teamId,
    before,
    after,
    weeklyStarterDeltas,
    remainingStarterPointsDelta: round(
      after.expectedRemainingStarterPoints -
        before.expectedRemainingStarterPoints,
    ),
    playoffPointsDelta:
      before.expectedPlayoffStarterPoints === undefined ||
      after.expectedPlayoffStarterPoints === undefined
        ? undefined
        : round(
            after.expectedPlayoffStarterPoints -
              before.expectedPlayoffStarterPoints,
          ),
    depthDelta: round(after.depthValue - before.depthValue),
    injuryResilienceDelta: round(
      after.injuryResilience - before.injuryResilience,
    ),
    netUtilityDelta: round(after.utility.total - before.utility.total),
    requiredDrops,
    positionalChanges: positionChanges(before, after),
    explanations: explainRosterChange(before, after),
    warnings: after.warnings,
  };
}

export interface TradeInput {
  teamAId: string;
  teamBId: string;
  teamAGives: string[];
  teamBGives: string[];
}
export function evaluateTrade(
  snapshot: LeagueSnapshot,
  input: TradeInput,
  options: TransactionEvaluationOptions = {},
): TransactionEvaluation {
  return profileSync("evaluateTrade", () => {
    const teamA = snapshot.teams.find((team) => team.id === input.teamAId);
    const teamB = snapshot.teams.find((team) => team.id === input.teamBId);
    if (!teamA || !teamB)
      throw new Error("Both trade teams must exist in the league snapshot.");
    if (
      input.teamAGives.some(
        (id) => !teamA.roster.some((entry) => entry.playerId === id),
      ) ||
      input.teamBGives.some(
        (id) => !teamB.roster.some((entry) => entry.playerId === id),
      )
    )
      throw new Error("A team cannot trade a player it does not roster.");
    const aGive = new Set(input.teamAGives);
    const bGive = new Set(input.teamBGives);
    const rawA = [
      ...teamA.roster.filter((entry) => !aGive.has(entry.playerId)),
      ...input.teamBGives.map((id) => incomingEntry(snapshot, id)),
    ];
    const rawB = [
      ...teamB.roster.filter((entry) => !bGive.has(entry.playerId)),
      ...input.teamAGives.map((id) => incomingEntry(snapshot, id)),
    ];
    ensureUnique(rawA);
    ensureUnique(rawB);
    const normalizedA = normalizeRosterSize(snapshot, teamA.id, rawA);
    const normalizedB = normalizeRosterSize(snapshot, teamB.id, rawB);
    const primary = impact(
      snapshot,
      teamA.id,
      normalizedA.roster,
      normalizedA.drops,
      options,
    );
    const opponent = impact(
      snapshot,
      teamB.id,
      normalizedB.roster,
      normalizedB.drops,
      options,
    );
    const descriptors = [
      `Opponent starter impact: ${opponent.remainingStarterPointsDelta >= 0 ? "+" : ""}${opponent.remainingStarterPointsDelta.toFixed(1)} remaining points`,
      `Opponent depth impact: ${opponent.depthDelta >= 0 ? "+" : ""}${opponent.depthDelta.toFixed(1)}`,
      `Opponent required drop: ${opponent.requiredDrops.length ? opponent.requiredDrops.map((drop) => snapshot.players[drop.playerId]?.name ?? drop.playerId).join(", ") : "none"}`,
      "Market fairness: unavailable in V1",
    ];
    const level =
      opponent.netUtilityDelta > 2
        ? "High"
        : opponent.netUtilityDelta >= -2
          ? "Medium"
          : "Low";
    const warnings: EvaluationWarning[] = [
      ...primary.warnings,
      ...opponent.warnings,
    ];
    return {
      legal:
        primary.after.legal &&
        opponent.after.legal &&
        normalizedA.roster.filter((entry) => entry.location !== "ir").length <=
          snapshot.settings.rosterSize &&
        normalizedB.roster.filter((entry) => entry.location !== "ir").length <=
          snapshot.settings.rosterSize,
      primaryTeam: primary,
      opponentTeam: opponent,
      plausibility: { level, confidence: "Low", descriptors },
      warnings,
    };
  });
}

export interface AddDropInput {
  teamId: string;
  addPlayerId: string;
  dropPlayerId?: string;
}
function evaluateAddDropInternal(
  snapshot: LeagueSnapshot,
  input: AddDropInput,
  options: TransactionEvaluationOptions = {},
): TransactionEvaluation {
  const team = snapshot.teams.find(
    (candidate) => candidate.id === input.teamId,
  );
  if (!team) throw new Error(`Unknown team ${input.teamId}.`);
  if (!snapshot.players[input.addPlayerId])
    throw new Error(`Unknown add player ${input.addPlayerId}.`);
  if (snapshot.players[input.addPlayerId].rosteredTeamId)
    throw new Error("Add/drop can only add an available player.");
  if (
    input.dropPlayerId &&
    !team.roster.some((entry) => entry.playerId === input.dropPlayerId)
  )
    throw new Error("Drop player is not on the selected roster.");
  const raw = [
    ...team.roster.filter((entry) => entry.playerId !== input.dropPlayerId),
    incomingEntry(snapshot, input.addPlayerId),
  ];
  const normalized = normalizeRosterSize(snapshot, team.id, raw);
  const drops = input.dropPlayerId
    ? [
        { teamId: team.id, playerId: input.dropPlayerId, utilityCost: 0 },
        ...normalized.drops,
      ]
    : normalized.drops;
  const primary = impact(snapshot, team.id, normalized.roster, drops, options);
  return {
    legal: primary.after.legal,
    primaryTeam: primary,
    warnings: primary.warnings,
  };
}

export function evaluateAddDrop(
  snapshot: LeagueSnapshot,
  input: AddDropInput,
  options: TransactionEvaluationOptions = {},
): TransactionEvaluation {
  return profileSync("evaluateAddDrop", () =>
    evaluateAddDropInternal(snapshot, input, options),
  );
}

function findBestDropForAddInternal(
  snapshot: LeagueSnapshot,
  teamId: string,
  addPlayerId: string,
  options: TransactionEvaluationOptions = {},
): TransactionEvaluation {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error(`Unknown team ${teamId}.`);
  const mustDrop =
    team.roster.filter((entry) => entry.location !== "ir").length >=
    snapshot.settings.rosterSize;
  if (!mustDrop)
    return evaluateAddDrop(snapshot, { teamId, addPlayerId }, options);
  // normalizeRosterSize already enumerates every legal required-drop combination
  // and selects the highest-utility post-add roster.
  return evaluateAddDrop(snapshot, { teamId, addPlayerId }, options);
}

export function findBestDropForAdd(
  snapshot: LeagueSnapshot,
  teamId: string,
  addPlayerId: string,
  options: TransactionEvaluationOptions = {},
): TransactionEvaluation {
  return profileSync("findBestDropForAdd", () =>
    findBestDropForAddInternal(snapshot, teamId, addPlayerId, options),
  );
}
