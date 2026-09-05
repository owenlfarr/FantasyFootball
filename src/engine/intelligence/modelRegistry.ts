import type { ConfidenceBand, FundamentalPlayerEstimate, TrendDirection } from "./types";
import type { ForecastMetrics, RegressionModel } from "./calibration";

export type ForecastChampion = "ESPN_BASELINE" | "V4_RULE_MODEL" | "V6_CALIBRATED";
export interface RestOfSeasonForecast {
  playerId: string; expectedPpg: number; expectedRemainingPoints: number; uncertainty: number;
  weeklyForecasts: FundamentalPlayerEstimate[]; roleTrend: TrendDirection; confidence: ConfidenceBand; modelVersion: string;
}
export interface ModelRegistryEntry { id: ForecastChampion; validation?: ForecastMetrics; directEspnComparison: boolean; selectedAt: string; reason: string; }
/**
 * V6 will not silently replace an ESPN-informed live forecast. A challenger
 * needs a direct historical ESPN comparison, stronger rank correlation, and no
 * material MAE regression. Historical internal-only validation is useful, but
 * insufficient to claim an ESPN blend improved.
 */
export function selectForecastChampion(entries: ModelRegistryEntry[]): ModelRegistryEntry {
  const v6=entries.find(x=>x.id==="V6_CALIBRATED"); const v4=entries.find(x=>x.id==="V4_RULE_MODEL"); const espn=entries.find(x=>x.id==="ESPN_BASELINE");
  if (v6?.validation && v6.directEspnComparison && espn?.validation &&
    v6.validation.spearman >= espn.validation.spearman + 0.01 && v6.validation.mae <= espn.validation.mae + 0.15) return v6;
  return v4 ?? espn ?? {id:"ESPN_BASELINE",directEspnComparison:false,selectedAt:new Date(0).toISOString(),reason:"No validated challenger."};
}
export function rosForecast(playerId:string, weekly: FundamentalPlayerEstimate[], trend: TrendDirection, confidence: ConfidenceBand): RestOfSeasonForecast {
  const expectedPpg=weekly.length?weekly.reduce((s,x)=>s+x.expectedPoints,0)/weekly.length:0;
  return {playerId,expectedPpg,expectedRemainingPoints:expectedPpg*weekly.length,uncertainty:weekly.length?weekly.reduce((s,x)=>s+x.uncertainty,0)/weekly.length:0,weeklyForecasts:weekly,roleTrend:trend,confidence,modelVersion:weekly[0]?.modelVersion??"unknown"};
}
export function challengerPrediction(model: RegressionModel | undefined, features: Record<string,number>, fallback: number) { return model ? predict(model,features) : fallback; }
function predict(model:RegressionModel,f:Record<string,number>) { return model.intercept+model.featureNames.reduce((s,n,i)=>s+((f[n]??0)-model.means[i])/model.scales[i]*model.coefficients[i],0); }
