import type { LeagueIntelligence } from "../intelligence/types";
import { assessMarketFairness } from "../intelligence/marketFairness";
import { derivePositionalNeeds } from "../roster/positionalNeeds";
import { evaluateRoster } from "../roster/evaluateRoster";
import { calculateOpponentFit } from "../search/opponentFit";
import type { DealPlausibility, PlausibilityContext } from "../plausibility/types";
import { evaluateDealPlausibility } from "../plausibility/managerModel";
import type { LeagueSnapshot, LineupAssignment, TransactionEvaluation } from "../types";
import { evaluateTrade, type TradeInput } from "./evaluateTransactions";

export type ManualTradeInput = Pick<TradeInput, "teamBId" | "teamAGives" | "teamBGives">;
export type ManualTradeEvaluation = {
  evaluation: TransactionEvaluation;
  verdict: "INVALID TRADE" | "GREAT FOR YOU" | "GOOD FOR YOU" | "SLIGHT WIN" | "ROUGHLY EVEN" | "BAD FOR YOU" | "VERY BAD FOR YOU";
  opponentFit: ReturnType<typeof calculateOpponentFit>;
  marketFairness: ReturnType<typeof assessMarketFairness>;
  plausibility: DealPlausibility;
  explanations: TransactionEvaluation["primaryTeam"]["explanations"];
  beforeAssignments: Array<Pick<LineupAssignment, "slotInstanceId" | "slotName" | "playerId">>;
  afterAssignments: Array<Pick<LineupAssignment, "slotInstanceId" | "slotName" | "playerId">>;
  evaluationTimeMs: number;
};

/** Conservative display-only thresholds over authoritative V1 net utility. */
export const MANUAL_TRADE_VERDICT_THRESHOLDS = { great: 15, good: 7.5, slight: 2, even: -2, bad: -7.5 } as const;

export function evaluateManualTrade(
  snapshot: LeagueSnapshot,
  input: ManualTradeInput,
  intelligence: LeagueIntelligence,
  plausibilityContext: PlausibilityContext,
): ManualTradeEvaluation {
  const started = performance.now();
  if (snapshot.dataMode !== "live" || !snapshot.provenance.version) throw new Error("A current live ESPN snapshot is required.");
  if (snapshot.primaryTeamId === input.teamBId) throw new Error("Choose another fantasy team.");
  if (!input.teamAGives.length || !input.teamBGives.length) throw new Error("Select at least one player on each side.");
  const all = [...input.teamAGives, ...input.teamBGives];
  if (new Set(all).size !== all.length) throw new Error("A player cannot appear twice in a trade.");
  const teamA = snapshot.teams.find((team) => team.id === snapshot.primaryTeamId);
  const teamB = snapshot.teams.find((team) => team.id === input.teamBId);
  if (!teamA || !teamB) throw new Error("The selected fantasy team is unavailable.");
  if (input.teamAGives.some((id) => !teamA.roster.some((entry) => entry.playerId === id)) || input.teamBGives.some((id) => !teamB.roster.some((entry) => entry.playerId === id))) throw new Error("Every selected player must belong to the selected roster.");
  const baselines = new Map(snapshot.teams.map((team) => [team.id, evaluateRoster(snapshot, team.id, undefined, { includeMarginals: false })]));
  const evaluation = evaluateTrade(snapshot, { teamAId: teamA.id, teamBId: teamB.id, teamAGives: input.teamAGives, teamBGives: input.teamBGives }, { baselineEvaluations: baselines, includeMarginals: false });
  const needs = derivePositionalNeeds(snapshot, teamB.id, [...baselines.values()]);
  const opponentFit = calculateOpponentFit(evaluation, needs, input.teamAGives.length, input.teamBGives.length);
  const marketFairness = assessMarketFairness(input.teamAGives, input.teamBGives, intelligence);
  const plausibility = evaluateDealPlausibility({ trade: input, evaluation, opponentTeamId: teamB.id, opponentFit, marketFairness }, plausibilityContext);
  const delta = evaluation.primaryTeam.netUtilityDelta;
  const thresholds = MANUAL_TRADE_VERDICT_THRESHOLDS;
  const verdict = !evaluation.legal ? "INVALID TRADE" : delta >= thresholds.great ? "GREAT FOR YOU" : delta >= thresholds.good ? "GOOD FOR YOU" : delta >= thresholds.slight ? "SLIGHT WIN" : delta >= thresholds.even ? "ROUGHLY EVEN" : delta >= thresholds.bad ? "BAD FOR YOU" : "VERY BAD FOR YOU";
  const week = snapshot.currentWeek;
  const before = evaluation.primaryTeam.before.weeklyLineups.find((lineup) => lineup.week === week);
  const after = evaluation.primaryTeam.after.weeklyLineups.find((lineup) => lineup.week === week);
  const selectAssignment = (item: LineupAssignment) => ({ slotInstanceId: item.slotInstanceId, playerId: item.playerId, slotName: item.slotName });
  return { evaluation, verdict, opponentFit, marketFairness, plausibility, explanations: evaluation.primaryTeam.explanations, beforeAssignments: before?.assignments.map(selectAssignment) ?? [], afterAssignments: after?.assignments.map(selectAssignment) ?? [], evaluationTimeMs: Math.round((performance.now() - started) * 100) / 100 };
}
