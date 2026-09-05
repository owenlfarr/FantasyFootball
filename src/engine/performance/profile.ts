export type ProfileMetric =
  | "baselineRoster"
  | "evaluateRoster"
  | "lineupOptimization"
  | "incrementalLineup"
  | "depthScenarios"
  | "marginalValues"
  | "marginalValue"
  | "requiredDropSearch"
  | "evaluateTrade"
  | "evaluateAddDrop"
  | "findBestDropForAdd"
  | "quickEvaluateTrade"
  | "opponentEvaluation"
  | "forecastPreparation";
export interface ProfileEntry {
  calls: number;
  totalMs: number;
  maxMs: number;
  averageMs: number;
  cacheHits: number;
  cacheMisses: number;
  uniqueStates: number;
  repeatedStates: number;
}
const metrics = new Map<ProfileMetric, ProfileEntry>();
const states = new Map<ProfileMetric, Set<string>>();
const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();
export function recordTiming(metric: ProfileMetric, elapsedMs: number): void {
  const current = metrics.get(metric) ?? {
    calls: 0,
    totalMs: 0,
    maxMs: 0,
    averageMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    uniqueStates: 0,
    repeatedStates: 0,
  };
  current.calls++;
  current.totalMs += elapsedMs;
  current.maxMs = Math.max(current.maxMs, elapsedMs);
  metrics.set(metric, current);
}
function entry(metric: ProfileMetric): ProfileEntry {
  const current = metrics.get(metric) ?? {
    calls: 0,
    totalMs: 0,
    maxMs: 0,
    averageMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    uniqueStates: 0,
    repeatedStates: 0,
  };
  metrics.set(metric, current);
  return current;
}
export function recordCache(metric: ProfileMetric, hit: boolean): void {
  const current = entry(metric);
  if (hit) current.cacheHits++;
  else current.cacheMisses++;
}
export function recordState(metric: ProfileMetric, key: string): void {
  const seen = states.get(metric) ?? new Set<string>();
  const current = entry(metric);
  if (seen.has(key)) current.repeatedStates++;
  else {
    seen.add(key);
    current.uniqueStates++;
  }
  states.set(metric, seen);
}
export function profileSync<T>(metric: ProfileMetric, work: () => T): T {
  const start = now();
  try {
    return work();
  } finally {
    recordTiming(metric, now() - start);
  }
}
export function resetEngineProfile(): void {
  metrics.clear();
  states.clear();
}
export function getEngineProfile(): Record<string, ProfileEntry> {
  return Object.fromEntries(
    [...metrics].map(([key, value]) => [
      key,
      {
        calls: value.calls,
        totalMs: Math.round(value.totalMs * 1000) / 1000,
        averageMs:
          value.calls > 0
            ? Math.round((value.totalMs / value.calls) * 1000) / 1000
            : 0,
        maxMs: Math.round(value.maxMs * 1000) / 1000,
        cacheHits: value.cacheHits,
        cacheMisses: value.cacheMisses,
        uniqueStates: value.uniqueStates,
        repeatedStates: value.repeatedStates,
      },
    ]),
  );
}
