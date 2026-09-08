import type { ExplanationFactor, RosterEvaluation } from "../types";

function factor(
  code: string,
  direction: ExplanationFactor["direction"],
  metric: string,
  before: number,
  after: number,
  message: string,
  weeks?: number[],
): ExplanationFactor {
  return {
    code,
    direction,
    metric,
    before,
    after,
    delta: Math.round((after - before) * 1000) / 1000,
    message,
    weeks,
  };
}

export function explainRosterChange(
  before: RosterEvaluation,
  after: RosterEvaluation,
): ExplanationFactor[] {
  const factors: ExplanationFactor[] = [];
  const starterDelta =
    after.expectedRemainingStarterPoints -
    before.expectedRemainingStarterPoints;
  factors.push(
    factor(
      "STARTER_POINTS_CHANGE",
      starterDelta > 0 ? "positive" : starterDelta < 0 ? "negative" : "neutral",
      "remainingStarterPoints",
      before.expectedRemainingStarterPoints,
      after.expectedRemainingStarterPoints,
      `${starterDelta >= 0 ? "Adds" : "Costs"} ${Math.abs(starterDelta).toFixed(1)} projected starter points over evaluated weeks.`,
    ),
  );
  if (
    before.expectedPlayoffStarterPoints !== undefined &&
    after.expectedPlayoffStarterPoints !== undefined
  ) {
    const delta =
      after.expectedPlayoffStarterPoints - before.expectedPlayoffStarterPoints;
    factors.push(
      factor(
        "PLAYOFF_POINTS_CHANGE",
        delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
        "playoffStarterPoints",
        before.expectedPlayoffStarterPoints,
        after.expectedPlayoffStarterPoints,
        `${delta >= 0 ? "Adds" : "Costs"} ${Math.abs(delta).toFixed(1)} projected playoff-week starter points.`,
      ),
    );
  }
  const depthDelta = after.depthValue - before.depthValue;
  if (Math.abs(depthDelta) >= 0.01)
    factors.push(
      factor(
        "DEPTH_CHANGE",
        depthDelta > 0 ? "positive" : "negative",
        "depthValue",
        before.depthValue,
        after.depthValue,
        `${depthDelta > 0 ? "Improves" : "Reduces"} scenario-weighted bench coverage by ${Math.abs(depthDelta).toFixed(1)} points.`,
      ),
    );
  const resilienceDelta = after.injuryResilience - before.injuryResilience;
  if (Math.abs(resilienceDelta) >= 2)
    factors.push(
      factor(
        "INJURY_RESILIENCE_CHANGE",
        resilienceDelta > 0 ? "positive" : "negative",
        "injuryResilience",
        before.injuryResilience,
        after.injuryResilience,
        `${resilienceDelta > 0 ? "Improves" : "Weakens"} injury resilience by ${Math.abs(resilienceDelta).toFixed(1)} points.`,
      ),
    );
  const changedWeeks = after.weeklyLineups
    .filter(
      (lineup, index) =>
        Math.abs(
          lineup.projectedPoints -
            (before.weeklyLineups[index]?.projectedPoints ?? 0),
        ) >= 0.1,
    )
    .map((lineup) => lineup.week);
  if (changedWeeks.length)
    factors.push({
      code: "WEEKS_AFFECTED",
      direction: starterDelta >= 0 ? "positive" : "negative",
      metric: "weeks",
      weeks: changedWeeks,
      message: `Changes the optimized lineup in weeks ${changedWeeks.join(", ")}.`,
    });
  if (after.starterConcentration > before.starterConcentration + 0.01)
    factors.push(
      factor(
        "CONSOLIDATION_EFFECT",
        "positive",
        "starterConcentration",
        before.starterConcentration,
        after.starterConcentration,
        "Concentrates more projected production in the five most valuable starters.",
      ),
    );
  if (after.vulnerabilityPenalty > before.vulnerabilityPenalty + 0.1)
    factors.push(
      factor(
        "VULNERABILITY_CREATED",
        "negative",
        "vulnerabilityPenalty",
        before.vulnerabilityPenalty,
        after.vulnerabilityPenalty,
        "Creates additional injury or mandatory-slot vulnerability.",
      ),
    );
  return factors;
}
