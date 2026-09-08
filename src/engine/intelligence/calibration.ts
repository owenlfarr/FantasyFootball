/**
 * Offline-only V6 calibration primitives.  Nothing in this module fetches data
 * or trains during a live recommendation request.  A feature row is explicitly
 * stamped with its as-of week; this is the boundary that prevents hindsight.
 */
export type CalibrationPosition = "QB" | "RB" | "WR" | "TE";
export type Horizon = "next1" | "next3" | "next5";

export interface HistoricalWeeklyStat {
  playerId: string;
  season: number;
  week: number;
  position: CalibrationPosition;
  fantasyPoints?: number;
  active?: boolean;
  targets?: number;
  targetShare?: number;
  carries?: number;
  carryShare?: number;
  airYardShare?: number;
  passAttempts?: number;
  touchdowns?: number;
  provenance?: { source:string; asOf:string; retrievedAt:string; version?:string };
}
export interface CalibrationFeatureRow {
  playerId: string;
  season: number;
  predictionWeek: number;
  featureThroughWeek: number;
  position: CalibrationPosition;
  features: Record<string, number>;
  targets: Partial<Record<Horizon, number>>;
}
export interface RegressionModel {
  version: string;
  position: CalibrationPosition;
  horizon: Horizon;
  featureNames: string[];
  means: number[];
  scales: number[];
  coefficients: number[];
  intercept: number;
  residualStd: number;
  trainedThrough: string;
}
export interface SerializedForecastModel extends RegressionModel { artifactVersion:string; trainingSeasons:number[]; sha256?:string; }
export const V6_FEATURE_NAMES=["seasonPpg","last3Ppg","ewmaPpg","volume","targets","carries","airYardShare"] as const;
export function serializeForecastModel(model:RegressionModel, trainingSeasons:number[]):SerializedForecastModel { return {...model,artifactVersion:"v6-artifact-1",trainingSeasons}; }
export function validateSerializedForecastModel(value:unknown): SerializedForecastModel | undefined {
  const x=value as Partial<SerializedForecastModel>;
  const positions:CalibrationPosition[]=["QB","RB","WR","TE"], horizons:Horizon[]=["next1","next3","next5"];
  if(x?.artifactVersion!=="v6-artifact-1"||x.version!=="v6-ridge-1"||!positions.includes(x.position!)||!horizons.includes(x.horizon!)||
    !Array.isArray(x.featureNames)||new Set(x.featureNames).size!==x.featureNames.length||x.featureNames.some(f=>typeof f!=="string")||
    !Array.isArray(x.coefficients)||x.featureNames.length!==x.coefficients.length||x.featureNames.length!==V6_FEATURE_NAMES.length||x.featureNames.some((f,i)=>f!==V6_FEATURE_NAMES[i])||x.coefficients.some(v=>!Number.isFinite(v))||
    !Array.isArray(x.means)||!Array.isArray(x.scales)||x.means.length!==x.featureNames.length||x.scales.length!==x.featureNames.length||
    x.means.some(v=>!Number.isFinite(v))||x.scales.some(v=>!Number.isFinite(v)||v<=0)||x.coefficients.some(v=>!Number.isFinite(v))||
    !Number.isFinite(x.intercept)||!Number.isFinite(x.residualStd)||x.residualStd === undefined||x.residualStd<=0||!Array.isArray(x.trainingSeasons)||
    x.trainingSeasons.some(v=>!Number.isInteger(v))||typeof x.trainedThrough!=="string"||!x.trainedThrough) return undefined;
  return x as SerializedForecastModel;
}
export interface ForecastMetrics {
  samples: number; mae: number; rmse: number; pearson: number; spearman: number;
  top12?: number; top24?: number; top36?: number; interval80Coverage?: number;
}
export interface CalibrationReport {
  horizon: Horizon;
  byPosition: Partial<Record<CalibrationPosition, Record<string, ForecastMetrics>>>;
  selected: Partial<Record<CalibrationPosition, RegressionModel>>;
}
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const std = (xs: number[]) => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2))) || 1;
const rank = (xs: number[]) => xs.map((x, i) => 1 + xs.filter((y, j) => y < x || (y === x && j < i)).length);
const correlation = (a: number[], b: number[]) => {
  if (a.length < 2) return 0;
  const am = mean(a), bm = mean(b);
  const num = a.reduce((s, x, i) => s + (x - am) * (b[i] - bm), 0);
  const den = Math.sqrt(a.reduce((s, x) => s + (x-am) ** 2, 0) * b.reduce((s, x) => s + (x-bm) ** 2, 0));
  return den ? num / den : 0;
};
const key = (x: Pick<HistoricalWeeklyStat, "season" | "playerId">) => `${x.season}:${x.playerId}`;
const opportunity = (x: HistoricalWeeklyStat) =>
  x.position === "QB" ? (x.passAttempts ?? 0) :
  x.position === "RB" ? (x.carries ?? 0) + 1.5 * (x.targets ?? 0) : (x.targets ?? 0);

/** Throws rather than silently admitting a future feature. */
export function assertAsOfRow(row: CalibrationFeatureRow) {
  if (row.featureThroughWeek >= row.predictionWeek)
    throw new Error(`LEAKAGE: feature week ${row.featureThroughWeek} is not before prediction week ${row.predictionWeek}`);
  if (!Object.keys(row.features).length) throw new Error("Calibration row has no features");
}

function futureAverage(all: HistoricalWeeklyStat[], startIndex: number, count: number) {
  const values: number[] = [];
  for (let i = startIndex; i < all.length && values.length < count; i++) {
    // Missing/inactive games are availability observations, not zero production.
    if (all[i].active !== false && Number.isFinite(all[i].fantasyPoints) && opportunity(all[i]) > 0) values.push(all[i].fantasyPoints!);
  }
  return values.length === count ? mean(values) : undefined;
}
function weighted(values: number[], decay = 0.65) {
  const weights = values.map((_, i) => decay ** (values.length - 1 - i));
  return values.reduce((s, x, i) => s + x * weights[i], 0) / weights.reduce((a,b) => a+b, 0);
}
/** The single historical/live V6 feature implementation. */
export function buildV6FeatureRow(priorGames: HistoricalWeeklyStat[], position: CalibrationPosition) {
  const prior=priorGames.filter(x=>x.position===position&&x.active!==false&&Number.isFinite(x.fantasyPoints)&&opportunity(x)>0).sort((a,b)=>a.week-b.week);
  if(prior.length<2)return undefined;
  const last=prior[prior.length-1], last3=prior.slice(-3), ppg=prior.map(x=>x.fantasyPoints!), recent=last3.map(x=>x.fantasyPoints!);
  const avg=(field:keyof HistoricalWeeklyStat,xs=prior)=>mean(xs.map(x=>Number(x[field]??0)));
  const recentAvg=(field:keyof HistoricalWeeklyStat)=>avg(field,last3);
  const targetOrCarry=position==="RB"?"carryShare":position==="QB"?"passAttempts":"targetShare";
  return {featureThroughWeek:last.week,features:{lastGamePpg:last.fantasyPoints!,seasonPpg:mean(ppg),last3Ppg:mean(recent),ewmaPpg:weighted(ppg),volume:avg(targetOrCarry),recentVolumeDelta:recentAvg(targetOrCarry)-avg(targetOrCarry,prior.slice(0,-Math.min(3,prior.length))),targets:avg("targets"),carries:avg("carries"),airYardShare:avg("airYardShare"),touchdownRate:avg("touchdowns")/Math.max(1,prior.length),roleVolatility:std(prior.map(opportunity)),games:prior.length}};
}
/** Creates rows before each week using only preceding completed regular-season games. */
export function buildStrictAsOfDataset(stats: HistoricalWeeklyStat[]): CalibrationFeatureRow[] {
  const groups = new Map<string, HistoricalWeeklyStat[]>();
  for (const item of stats.filter(x => x.week > 0).sort((a,b) => a.season-b.season || a.week-b.week))
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  const rows: CalibrationFeatureRow[] = [];
  for (const games of groups.values()) for (let index = 2; index < games.length; index++) {
    const prior = games.slice(0, index).filter(x => x.active !== false && x.fantasyPoints !== undefined && opportunity(x) > 0);
    if (prior.length < 2) continue;
    const current = games[index];
    const calculated=buildV6FeatureRow(games.slice(0,index),current.position);
    if(!calculated)continue;
    const row: CalibrationFeatureRow = {
      playerId: current.playerId, season: current.season, predictionWeek: current.week,
      featureThroughWeek: calculated.featureThroughWeek, position: current.position, features: calculated.features,
      targets: { next1: futureAverage(games, index, 1), next3: futureAverage(games, index, 3), next5: futureAverage(games, index, 5) },
    };
    assertAsOfRow(row); rows.push(row);
  }
  return rows;
}
function solve(a: number[][], b: number[]) {
  const n = b.length, m = a.map((r, i) => [...r, b[i]]);
  for (let c=0;c<n;c++) { let pivot=c; for(let r=c+1;r<n;r++) if(Math.abs(m[r][c])>Math.abs(m[pivot][c])) pivot=r;
    [m[c],m[pivot]]=[m[pivot],m[c]]; const d=m[c][c] || 1e-12;
    for(let j=c;j<=n;j++) m[c][j]/=d;
    for(let r=0;r<n;r++) if(r!==c) { const f=m[r][c]; for(let j=c;j<=n;j++) m[r][j]-=f*m[c][j]; }
  } return m.map(r=>r[n]);
}
export function trainRidge(rows: CalibrationFeatureRow[], position: CalibrationPosition, horizon: Horizon, featureNames: string[], lambda = 12): RegressionModel | undefined {
  const selected = rows.filter(r => r.position === position && r.targets[horizon] !== undefined);
  if (selected.length < Math.max(20, featureNames.length * 3)) return undefined;
  const means = featureNames.map(f=>mean(selected.map(r=>r.features[f] ?? 0)));
  const scales = featureNames.map((f,i)=>std(selected.map(r=>(r.features[f] ?? 0)-means[i])));
  const x = selected.map(r=>featureNames.map((f,i)=>((r.features[f] ?? 0)-means[i])/scales[i]));
  const y = selected.map(r=>r.targets[horizon]!); const ym=mean(y), p=featureNames.length;
  const xtx=Array.from({length:p},(_,i)=>Array.from({length:p},(_,j)=>x.reduce((s,row)=>s+row[i]*row[j],0)+(i===j?lambda:0)));
  const xty=Array.from({length:p},(_,i)=>x.reduce((s,row,index)=>s+row[i]*(y[index]-ym),0));
  const coefficients=solve(xtx,xty); const predictions=x.map(row=>ym+row.reduce((s,v,i)=>s+v*coefficients[i],0));
  return { version:"v6-ridge-1", position, horizon, featureNames, means, scales, coefficients, intercept:ym,
    residualStd:std(predictions.map((p,i)=>y[i]-p)), trainedThrough:`${Math.max(...selected.map(r=>r.season))}`, };
}
export function predictRidge(model: RegressionModel, features: Record<string, number>) {
  return model.intercept + model.featureNames.reduce((s,f,i)=>s+((features[f]??0)-model.means[i])/model.scales[i]*model.coefficients[i],0);
}
export function metrics(actual: number[], predicted: number[], intervalStd?: number): ForecastMetrics {
  const errors=actual.map((x,i)=>x-predicted[i]); const n=actual.length;
  const top = (k:number) => { const truth=new Set(actual.map((x,i)=>[x,i] as const).sort((a,b)=>b[0]-a[0]).slice(0,k).map(x=>x[1])); const picks=predicted.map((x,i)=>[x,i] as const).sort((a,b)=>b[0]-a[0]).slice(0,k).map(x=>x[1]); return picks.filter(i=>truth.has(i)).length/Math.max(1,Math.min(k,n)); };
  return {samples:n, mae:mean(errors.map(Math.abs)), rmse:Math.sqrt(mean(errors.map(x=>x*x))), pearson:correlation(predicted,actual), spearman:correlation(rank(predicted),rank(actual)), top12:top(12), top24:top(24), top36:top(36), interval80Coverage: intervalStd === undefined ? undefined : actual.filter((x,i)=>Math.abs(x-predicted[i])<=1.282*intervalStd).length/Math.max(1,n)};
}
export const FEATURE_FAMILIES = {
  baseline:["seasonPpg","last3Ppg","ewmaPpg"], usage:["volume","targets","carries","airYardShare"], trend:["recentVolumeDelta","roleVolatility"], regression:["touchdownRate"], environment:[] as string[],
};
