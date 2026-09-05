import type { CanonicalPosition } from "../types";
import type { ExpectedProductionEstimate, UsageSnapshot } from "./types";
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
export function shrinkRate(observedEvents: number, opportunities: number, priorRate: number, priorOpportunities = 30) {
  return opportunities + priorOpportunities > 0 ? (observedEvents + priorRate * priorOpportunities) / (opportunities + priorOpportunities) : priorRate;
}
export function estimateExpectedProduction(position: CanonicalPosition, usage: UsageSnapshot[] = []): ExpectedProductionEstimate {
  const samples = [...usage].sort((a, b) => a.week - b.week).slice(-5);
  if (!samples.length) return { regressionDirection: "unknown", confidence: 0 };
  const estimates = samples.flatMap((item) => {
    const m = item.metrics, targets = m.targets ?? 0, carries = m.carries ?? 0, attempts = m.passAttempts ?? 0;
    const highValue = (m.redZoneTargets ?? 0) + (m.redZoneCarries ?? 0) + 1.5 * (m.goalLineCarries ?? 0) + 1.5 * (m.endZoneTargets ?? 0);
    let expectedTouchdowns = 0, expected = 0;
    if (position === "WR" || position === "TE") {
      const rate = shrinkRate(m.touchdowns ?? 0, Math.max(1, targets), position === "TE" ? 0.055 : 0.05);
      expectedTouchdowns = targets * Math.min(0.09, rate) + 0.08 * highValue;
      expected = targets * (position === "TE" ? 1.45 : 1.5) + (m.airYards ?? 0) * 0.025 + expectedTouchdowns * 6;
    } else if (position === "RB") {
      const opportunities = carries + targets;
      const rate = shrinkRate(m.touchdowns ?? 0, Math.max(1, opportunities), 0.032, 45);
      expectedTouchdowns = opportunities * Math.min(0.055, rate) + 0.08 * highValue;
      expected = carries * 0.56 + targets * 1.45 + expectedTouchdowns * 6;
    } else if (position === "QB") {
      const rate = shrinkRate(m.touchdowns ?? 0, Math.max(1, attempts), 0.045, 120);
      expectedTouchdowns = attempts * Math.min(0.07, rate);
      expected = attempts * 0.19 + expectedTouchdowns * 4 + carries * 0.65;
    } else return [];
    return [{ expected, actual: m.actualFantasyPoints, expectedTouchdowns, actualTouchdowns: m.touchdowns }];
  });
  if (!estimates.length) return { regressionDirection: "unknown", confidence: 0 };
  const expected = mean(estimates.map((item) => item.expected));
  const actualValues = estimates.map((item) => item.actual).filter((value): value is number => value !== undefined);
  const actual = actualValues.length ? mean(actualValues) : undefined;
  const fpoe = actual === undefined ? undefined : actual - expected;
  const availableFields = samples.reduce((sum, item) => sum + Object.values(item.metrics).filter((value) => value !== undefined).length, 0);
  const confidence = clamp(0.7 * (samples.length / 5) + 0.3 * Math.min(1, availableFields / 30));
  return {
    expectedFantasyPoints: expected, actualFantasyPoints: actual,
    fantasyPointsOverExpected: fpoe,
    expectedTouchdowns: mean(estimates.map((item) => item.expectedTouchdowns)),
    actualTouchdowns: mean(estimates.map((item) => item.actualTouchdowns ?? 0)),
    regressionDirection: fpoe === undefined || Math.abs(fpoe) < 2 ? "neutral" : fpoe < 0 ? "positive" : "negative",
    confidence,
  };
}
