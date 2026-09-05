import type { CanonicalPosition } from "../types";
import type { RoleChange, RoleEstimate, UsageMetrics, UsageSnapshot } from "./types";

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const valid = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
function blend(parts: Array<[number | undefined, number]>) {
  const usable = parts.filter((part): part is [number, number] => valid(part[0]));
  const weight = usable.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return weight ? usable.reduce((sum, [value, itemWeight]) => sum + clamp(value) * itemWeight, 0) / weight : undefined;
}
function components(position: CanonicalPosition, metrics: UsageMetrics): Record<string, number | undefined> {
  if (position === "WR" || position === "TE") return { routes: metrics.routeParticipation, targets: metrics.targetShare, airYards: metrics.airYardShare };
  if (position === "RB") return { snaps: metrics.snapShare, carries: metrics.carryShare, routes: metrics.routeParticipation, targets: metrics.targetShare };
  if (position === "QB") return {
    dropbacks: metrics.teamPassRate,
    rushing: metrics.scrambleRate,
    designedRushing: metrics.designedRushes === undefined ? undefined : clamp(metrics.designedRushes / 8),
    attempts: metrics.passAttempts === undefined ? undefined : clamp(metrics.passAttempts / 40),
  };
  return { snaps: metrics.snapShare };
}
function scoreFor(position: CanonicalPosition, metrics: UsageMetrics) {
  const c = components(position, metrics);
  if (position === "WR" || position === "TE") return blend([[c.targets, 0.45], [c.routes, 0.35], [c.airYards, 0.2]]);
  if (position === "RB") return blend([[c.snaps, 0.35], [c.carries, 0.35], [c.routes, 0.15], [c.targets, 0.15]]);
  if (position === "QB") return blend([[c.attempts, 0.45], [c.rushing, 0.2], [c.designedRushing, 0.2], [c.dropbacks, 0.15]]);
  return blend([[c.snaps, 1]]);
}
function averageMetrics(items: UsageSnapshot[]) {
  const keys = new Set(items.flatMap((item) => Object.keys(item.metrics)));
  return Object.fromEntries([...keys].flatMap((key) => {
    const values = items.map((item) => item.metrics[key as keyof UsageMetrics]).filter(valid);
    return values.length ? [[key, mean(values)]] : [];
  })) as UsageMetrics;
}
export const isRisingTrend = (trend: RoleEstimate["trend"]) => trend === "rising" || trend === "strongly_rising";
export const isFallingTrend = (trend: RoleEstimate["trend"]) => trend === "falling" || trend === "strongly_falling";

export function estimateRole(position: CanonicalPosition, snapshots: UsageSnapshot[] = []): RoleEstimate {
  const ordered = [...snapshots].sort((a, b) => a.week - b.week);
  if (!ordered.length) return { trend: "unknown", confidence: 0, evidence: [] };
  const recent = ordered.slice(-2), prior = ordered.slice(-6, -2);
  const recentMetrics = averageMetrics(recent), priorMetrics = averageMetrics(prior);
  const opportunity = scoreFor(position, recentMetrics), previous = prior.length ? scoreFor(position, priorMetrics) : undefined;
  const recentComponents = components(position, recentMetrics), priorComponents = components(position, priorMetrics);
  const componentDeltas = Object.keys(recentComponents).flatMap((key) => {
    const current = recentComponents[key], before = priorComponents[key];
    return valid(current) && valid(before) ? [current - before] : [];
  });
  const positive = componentDeltas.filter((delta) => delta >= 0.06).length;
  const negative = componentDeltas.filter((delta) => delta <= -0.06).length;
  const delta = valid(opportunity) && valid(previous) ? opportunity - previous : 0;
  const recentScoresForTrend = recent
    .map((item) => scoreFor(position, item.metrics))
    .filter(valid);
  const sustainedPositive = valid(previous) && recentScoresForTrend.length === 2 && recentScoresForTrend.every((score) => score >= previous + 0.04);
  const sustainedNegative = valid(previous) && recentScoresForTrend.length === 2 && recentScoresForTrend.every((score) => score <= previous - 0.04);
  const fieldCount = recent.reduce((sum, item) => sum + Object.values(item.metrics).filter(valid).length, 0);
  const sampleConfidence = clamp(ordered.length / 6), coverageConfidence = clamp(fieldCount / 14);
  const confidence = clamp(0.7 * sampleConfidence + 0.3 * coverageConfidence);
  let trend: RoleEstimate["trend"] = "stable";
  if (recent.length >= 2 && prior.length >= 2 && confidence >= 0.45) {
    if (delta >= 0.25 && positive >= 2 && sustainedPositive && fieldCount >= 6) trend = "strongly_rising";
    else if (delta >= 0.07 && positive >= 2 && sustainedPositive) trend = "rising";
    else if (delta <= -0.25 && negative >= 2 && sustainedNegative && fieldCount >= 6) trend = "strongly_falling";
    else if (delta <= -0.07 && negative >= 2 && sustainedNegative) trend = "falling";
  }
  const recentScores = recent.map((item) => scoreFor(position, item.metrics)).filter(valid);
  const recentRange = recentScores.length > 1 ? Math.max(...recentScores) - Math.min(...recentScores) : 0.35;
  const roleSecurity = valid(opportunity) ? clamp(0.55 * opportunity + 0.3 * (1 - recentRange) + 0.15 * sampleConfidence) : undefined;
  const latest = recent.at(-1)?.metrics ?? {};
  const highValue = blend([
    [latest.redZoneTargets === undefined ? undefined : latest.redZoneTargets / 3, 0.35],
    [latest.endZoneTargets === undefined ? undefined : latest.endZoneTargets / 2, 0.25],
    [latest.redZoneCarries === undefined ? undefined : latest.redZoneCarries / 5, 0.25],
    [latest.goalLineCarries === undefined ? undefined : latest.goalLineCarries / 3, 0.15],
  ]);
  const receiving = blend([[latest.routeParticipation, 0.45], [latest.targetShare, 0.4], [latest.thirdDownShare, 0.15]]);
  const goalLine = blend([
    [latest.redZoneCarries === undefined ? undefined : latest.redZoneCarries / 5, 0.55],
    [latest.goalLineCarries === undefined ? undefined : latest.goalLineCarries / 3, 0.45],
  ]);
  const structuralChanges: RoleChange[] = [];
  if (valid(opportunity) && valid(previous) && recent.length >= 2 && prior.length >= 2) {
    if (previous <= 0.35 && opportunity >= 0.65 && positive >= 2) structuralChanges.push("BACKUP_TO_STARTER");
    if (position === "RB" && (priorMetrics.carryShare ?? 1) < 0.45 && (recentMetrics.carryShare ?? 0) >= 0.6) structuralChanges.push("COMMITTEE_TO_LEAD");
    if (position === "RB" && (priorMetrics.carryShare ?? 0) >= 0.6 && (recentMetrics.carryShare ?? 1) < 0.45) structuralChanges.push("STARTER_TO_COMMITTEE");
    if ((recentMetrics.routeParticipation ?? 0) >= 0.85 && (priorMetrics.routeParticipation ?? 1) < 0.7) structuralChanges.push("EVERY_DOWN_ROLE_GAINED");
    if ((latest.goalLineCarries ?? 0) >= 2 && (priorMetrics.goalLineCarries ?? 0) < 0.5) structuralChanges.push("GOAL_LINE_ROLE_GAINED");
    if ((priorMetrics.thirdDownShare ?? 0) >= 0.5 && (recentMetrics.thirdDownShare ?? 1) < 0.3) structuralChanges.push("PASSING_DOWN_ROLE_LOST");
  }
  const evidence: string[] = [];
  if (valid(opportunity)) evidence.push(`Opportunity score ${Math.round(opportunity * 100)}/100 from available role inputs.`);
  if (valid(recentMetrics.routeParticipation)) evidence.push(`Recent route participation ${Math.round(recentMetrics.routeParticipation * 100)}%.`);
  if (valid(recentMetrics.targetShare)) evidence.push(`Recent target share ${Math.round(recentMetrics.targetShare * 100)}%.`);
  if (valid(recentMetrics.carryShare)) evidence.push(`Recent carry share ${Math.round(recentMetrics.carryShare * 100)}%.`);
  if (trend !== "stable") evidence.push(`${Math.max(positive, negative)} opportunity indicators support a ${trend.replace("_", " ")} role.`);
  return {
    opportunityScore: valid(opportunity) ? Math.round(opportunity * 100) : undefined,
    roleSecurity: valid(roleSecurity) ? Math.round(roleSecurity * 100) : undefined,
    securityBand: !valid(roleSecurity) ? undefined : roleSecurity >= 0.72 ? "high" : roleSecurity >= 0.45 ? "medium" : "low",
    highValueTouchScore: valid(highValue) ? Math.round(highValue * 100) : undefined,
    receivingRole: valid(receiving) ? Math.round(receiving * 100) : undefined,
    goalLineRole: valid(goalLine) ? Math.round(goalLine * 100) : undefined,
    trend, structuralChanges,
    recentOpportunity: valid(opportunity) ? opportunity : undefined,
    priorOpportunity: valid(previous) ? previous : undefined,
    confidence, evidence,
  };
}
