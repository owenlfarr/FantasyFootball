import type {
  ForecastValidation,
  IntelligenceHistoryRecord,
  WalkForwardSample,
} from "./types";
const mean = (v: number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
function ranks(v: number[]) {
  return v.map(
    (x, i) => 1 + v.filter((y, j) => y < x || (y === x && j < i)).length,
  );
}
function corr(a: number[], b: number[]) {
  if (a.length < 2) return 0;
  const am = mean(a),
    bm = mean(b);
  const num = a.reduce((s, x, i) => s + (x - am) * (b[i] - bm), 0);
  const den = Math.sqrt(
    a.reduce((s, x) => s + (x - am) ** 2, 0) *
      b.reduce((s, x) => s + (x - bm) ** 2, 0),
  );
  return den ? num / den : 0;
}
export function buildWalkForwardSamples(
  records: IntelligenceHistoryRecord[],
): WalkForwardSample[] {
  return records
    .filter((record) => record.actualFuturePoints !== undefined)
    .map((record) => ({
      asOf: record.asOf,
      playerId: record.playerId,
      position: record.position,
      predicted: record.fundamental.expectedPoints,
      lower: record.fundamental.floor,
      upper: record.fundamental.ceiling,
      baseline: record.forecastMean,
      actual: record.actualFuturePoints!,
    }));
}
export function validateForecasts(
  samples: WalkForwardSample[],
): ForecastValidation {
  const modelErrors = samples.map((s) => Math.abs(s.predicted - s.actual)),
    baseErrors = samples.map((s) => Math.abs(s.baseline - s.actual));
  const modelSq = samples.map((s) => (s.predicted - s.actual) ** 2),
    baseSq = samples.map((s) => (s.baseline - s.actual) ** 2);
  return {
    samples: samples.length,
    modelMae: mean(modelErrors),
    baselineMae: mean(baseErrors),
    modelRmse: Math.sqrt(mean(modelSq)),
    baselineRmse: Math.sqrt(mean(baseSq)),
    rankCorrelation: corr(
      ranks(samples.map((s) => s.predicted)),
      ranks(samples.map((s) => s.actual)),
    ),
    baselineRankCorrelation: corr(
      ranks(samples.map((s) => s.baseline)),
      ranks(samples.map((s) => s.actual)),
    ),
    intervalCoverage: samples.length
      ? samples.filter((s) => s.actual >= s.lower && s.actual <= s.upper)
          .length / samples.length
      : 0,
    beatsBaseline: samples.length > 0 && mean(modelErrors) < mean(baseErrors),
  };
}

export function validateForecastsByPosition(samples: WalkForwardSample[]) {
  const positions = new Set(samples.map((sample) => sample.position).filter(Boolean));
  return Object.fromEntries(
    [...positions].map((position) => [
      position!,
      validateForecasts(samples.filter((sample) => sample.position === position)),
    ]),
  );
}
