import type { PositionalNeed, TransactionEvaluation } from "../types";
import type { OpponentFit, OpponentFitBand } from "./types";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const fitBand = (score: number): OpponentFitBand =>
  score < 20
    ? "very_low"
    : score < 40
      ? "low"
      : score < 60
        ? "medium"
        : score < 80
          ? "high"
          : "very_high";
export const fitBandRank = (band: OpponentFitBand) =>
  ({ very_low: 0, low: 1, medium: 2, high: 3, very_high: 4 })[band];

export function calculateOpponentFit(
  evaluation: TransactionEvaluation,
  opponentNeeds: PositionalNeed[],
  receivedCount: number,
  sentCount: number,
): OpponentFit {
  const impact = evaluation.opponentTeam!;
  const weeks = Math.max(1, impact.after.weeklyLineups.length);
  const starterImpact = impact.remainingStarterPointsDelta / weeks;
  const utilityPerWeek = impact.netUtilityDelta / weeks;
  const depthPerWeek = impact.depthDelta / weeks;
  const improved = new Set(
    impact.positionalChanges
      .filter(
        (change) =>
          change.starterPointsDelta > 0.25 ||
          change.replacementPointsDelta > 0.25,
      )
      .map((change) => change.position),
  );
  const fillsNeed = opponentNeeds.some(
    (need) => need.needScore >= 50 && improved.has(need.position),
  );
  const losesCriticalStarter =
    !impact.after.legal ||
    (impact.remainingStarterPointsDelta < 0 &&
      impact.positionalChanges.some(
        (change) =>
          change.starterPointsDelta < -2 && change.replacementPointsDelta <= 0,
      ));
  const requiredDropBurden = impact.requiredDrops.reduce(
    (sum, drop) => sum + Math.max(0, drop.utilityCost),
    0,
  );
  const asymmetryPenalty = Math.max(0, receivedCount - sentCount) * 3;
  const raw =
    50 +
    8 * clamp(starterImpact, -4, 4) +
    4 * clamp(utilityPerWeek, -4, 4) +
    3 * clamp(depthPerWeek, -3, 3) +
    (fillsNeed ? 8 : 0) -
    (losesCriticalStarter ? 18 : 0) -
    4 * clamp(requiredDropBurden / weeks, 0, 5) -
    asymmetryPenalty;
  const score = Math.round(clamp(raw, 0, 100));
  const reasons = [
    {
      code: "OPPONENT_STARTER_IMPACT",
      direction:
        starterImpact > 0
          ? ("positive" as const)
          : starterImpact < 0
            ? ("negative" as const)
            : ("neutral" as const),
      metric: "starterPointsPerWeek",
      before: 0,
      after: starterImpact,
      delta: starterImpact,
      message: `Opponent optimized starters change ${starterImpact >= 0 ? "+" : ""}${starterImpact.toFixed(1)} points per week.`,
    },
    {
      code: "OPPONENT_ROSTER_UTILITY",
      direction:
        utilityPerWeek > 0
          ? ("positive" as const)
          : utilityPerWeek < 0
            ? ("negative" as const)
            : ("neutral" as const),
      metric: "utilityPerWeek",
      before: 0,
      after: utilityPerWeek,
      delta: utilityPerWeek,
      message: `Opponent roster utility changes ${utilityPerWeek >= 0 ? "+" : ""}${utilityPerWeek.toFixed(1)} per evaluated week.`,
    },
    ...(fillsNeed
      ? [
          {
            code: "FILLS_OPPONENT_NEED",
            direction: "positive" as const,
            metric: "positionalNeed",
            message:
              "Incoming assets improve one of the opponent's higher-need positions.",
          },
        ]
      : []),
    ...(requiredDropBurden > 0
      ? [
          {
            code: "OPPONENT_REQUIRED_DROP",
            direction: "negative" as const,
            metric: "requiredDropBurden",
            before: 0,
            after: requiredDropBurden,
            delta: requiredDropBurden,
            message: `The opponent must absorb ${requiredDropBurden.toFixed(1)} utility of required-drop cost.`,
          },
        ]
      : []),
    ...(losesCriticalStarter
      ? [
          {
            code: "OPPONENT_CRITICAL_STARTER_LOSS",
            direction: "negative" as const,
            metric: "lineupLegality",
            message:
              "The package removes critical opponent starter production without a sufficient replacement.",
          },
        ]
      : []),
  ];
  return {
    score,
    band: fitBand(score),
    starterImpact,
    utilityDelta: impact.netUtilityDelta,
    depthDelta: impact.depthDelta,
    requiredDropBurden,
    fillsNeed,
    losesCriticalStarter,
    reasons,
  };
}
