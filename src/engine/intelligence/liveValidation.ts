import type { CanonicalPosition, DataProvenance, LeaguePlayer } from "../types";
import type { ConfidenceBand, PlayerIntelligence } from "./types";
import { predictRidge, type SerializedForecastModel } from "./calibration";
import type { NFLGameSchedule } from "./providers/nflverseSchedule";

export type ForecastSource = "ESPN" | "V4" | "V6";
export type ComparisonCutoff = "kickoff" | "sunday_morning" | "hours_24_before";
export interface LiveForecastSnapshot {
  id: string; leagueId: string; season: number; week: number; playerId: string;
  generatedAt: string; source: ForecastSource; expectedPoints: number; lower?: number; upper?: number;
  availabilityProbability?: number; injuryStatus?: string; usageSnapshotId?: string; marketSnapshotId?: string;
  modelVersion: string; leagueSnapshotVersion: string; gameId?: string; kickoffTime?: string;
  position?: CanonicalPosition; lockState: "PRE_LOCK" | "POST_LOCK" | "UNKNOWN_LOCK";
  artifactVersion?: string; trainedThrough?: string; forecastHorizon?: "next1"|"next3"|"next5";
  featureThroughWeek?: number; featureDataAsOf?: string;
  capturePhase?: "EARLY_WEEK"|"MID_WEEK"|"FINAL_PRELOCK"|"POST_LOCK";
}
export interface V6PlayerDiagnostic { playerId:string; requiredFeatures:string[]; availableFeatures:string[]; missingFeatures:string[]; inferenceProduced:boolean; code?:"V6_UNAVAILABLE_FOR_PLAYER"; reason?:"INSUFFICIENT_CURRENT_SEASON_FEATURES"|"MISSING_FEATURES"|"IDENTITY_MAPPING_FAILURE"|"USAGE_PROVIDER_UNAVAILABLE"|"ARTIFACT_ERROR"; }
export interface CaptureDiagnostics { eligible:number; kickoffMapped:number; kickoffCoverage?:{eligible:number;mapped:number;unmapped:number}; preLock?:{ESPN:number;V4:number;V6:number}; espn:number; v4:number; v6:number; kickoffUnknown:number; postLock:number; missingV6Features:number; v6Attempted?:number; insufficientCurrentSeasonFeatures?:number; usageProviderErrors?:number; usageProviderStatus?:string; identityMappingFailures?:number; identityMappingFailurePlayers?:number; artifactErrors?:number; playerDiagnostics?:V6PlayerDiagnostic[]; timings?:Record<string,number>; comparisonSets?:number; persistence?:"READY"|"FAILED"; persistenceError?:string; artifactStatus?:string; artifactDiagnostic?:string; }
export interface PlayerOutcome {
  leagueId: string; playerId: string; season: number; week: number; fantasyPoints: number;
  active: boolean; gameCompletedAt: string; position?: CanonicalPosition; provenance: DataProvenance[];
}
export interface ComparisonForecastSet {
  leagueId: string; season: number; week: number; playerId: string; position?: CanonicalPosition;
  cutoff: ComparisonCutoff; predictionDeadline: string; kickoffTime?: string;
  forecasts: Partial<Record<ForecastSource, LiveForecastSnapshot>>; outcome?: PlayerOutcome;
}
export interface LiveModelMetrics { samples:number; mae:number; rmse:number; spearman:number; pearson:number; bias:number; }
export interface ModelChampionStatus {
  position: string; horizon: "next1" | "next3" | "next5"; championModel: ForecastSource;
  challengerModel: ForecastSource; sampleSize:number; championMetrics?: LiveModelMetrics; challengerMetrics?: LiveModelMetrics;
  promotionEligible:boolean; promotionReasons:string[]; blockingReasons:string[]; evaluatedAt:string;
}
export interface ForecastValidationStore { appendForecasts(s: LiveForecastSnapshot[]):Promise<unknown>; appendOutcomes(s: PlayerOutcome[]):Promise<unknown>; forecasts(leagueId:string,season:number):Promise<LiveForecastSnapshot[]>; outcomes(leagueId:string,season:number):Promise<PlayerOutcome[]>; }
const rank=(v:number[])=>v.map((x,i)=>1+v.filter((y,j)=>y<x||(y===x&&j<i)).length);
const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:0;
const corr=(a:number[],b:number[])=>{if(a.length<2)return 0;const am=mean(a),bm=mean(b),n=a.reduce((s,x,i)=>s+(x-am)*(b[i]-bm),0),d=Math.sqrt(a.reduce((s,x)=>s+(x-am)**2,0)*b.reduce((s,x)=>s+(x-bm)**2,0));return d?n/d:0;};
const snapshotId=(x:Omit<LiveForecastSnapshot,"id">)=>`${x.leagueId}:${x.season}:${x.week}:${x.playerId}:${x.source}:${x.generatedAt}:${x.modelVersion}:${x.expectedPoints}:${x.lower??""}:${x.upper??""}:${x.artifactVersion??""}`;

/** Captures immutable, model-separated predictions. A caller may invoke it many times safely. */
export function captureForecastSnapshots(leagueId:string, season:number, week:number, players:Record<string,LeaguePlayer>, intelligence:Record<string,PlayerIntelligence>, generatedAt:string, snapshotVersion:string): LiveForecastSnapshot[] {
  const out:LiveForecastSnapshot[]=[];
  for(const player of Object.values(players)) {
    if(!["QB","RB","WR","TE"].includes(player.primaryPosition)) continue;
    const espn=player.forecasts.find(f=>f.week===week); const intel=intelligence[player.id];
    const base={leagueId,season,week,playerId:player.id,generatedAt,leagueSnapshotVersion:snapshotVersion,position:player.primaryPosition} as Omit<LiveForecastSnapshot,"id"|"source"|"expectedPoints"|"modelVersion"|"lockState">;
    const lockState:"PRE_LOCK"|"POST_LOCK"="PRE_LOCK"; // ESPN does not expose player game times in this snapshot yet.
    if(espn) { const item={...base,injuryStatus:player.injuryStatus,source:"ESPN" as const,expectedPoints:espn.mean,lower:espn.lower,upper:espn.upper,availabilityProbability:espn.availabilityProbability,modelVersion:espn.version??"espn",lockState}; out.push({...item,id:snapshotId(item)}); }
    if(intel) { const f=intel.fundamental; const item={...base,injuryStatus:player.injuryStatus,source:"V4" as const,expectedPoints:f.expectedPoints,lower:f.floor,upper:f.ceiling,availabilityProbability:espn?.availabilityProbability,modelVersion:f.modelVersion,lockState}; out.push({...item,id:snapshotId(item)}); }
    // V6 is intentionally not synthesized from V4. Once a serialized, validated
    // V6 artifact is registered, the capture caller supplies it as a true third model.
  }
  return out;
}
export function mapKickoffs(snapshots:LiveForecastSnapshot[], players:Record<string,LeaguePlayer>, games:NFLGameSchedule[]):LiveForecastSnapshot[]{return snapshots.map(x=>{const game=games.find(g=>g.week===x.week&&(g.homeTeam===players[x.playerId]?.nflTeam||g.awayTeam===players[x.playerId]?.nflTeam));if(!game)return {...x,lockState:"UNKNOWN_LOCK"};return {...x,gameId:game.gameId,kickoffTime:game.kickoffAt,lockState:Date.parse(x.generatedAt)<Date.parse(game.kickoffAt)?"PRE_LOCK":"POST_LOCK"};});}
/** V6 inference uses the exact normalized feature names from V6 ridge training. */
export function predictWithV6(model:SerializedForecastModel, features:Record<string,number>, generatedAt:string){const valid=validateFeatures(model,features);if(!valid)return undefined;const expected=predictRidge(model,features), sigma=model.residualStd;return {expectedPoints:expected,lower:Math.max(0,expected-1.282*sigma),upper:expected+1.282*sigma,generatedAt,modelVersion:model.version};}
function validateFeatures(model:SerializedForecastModel,features:Record<string,number>){return model.featureNames.every(f=>Number.isFinite(features[f]));}
export function outcomesFromLeaguePlayers(leagueId:string, season:number, completedWeek:number, players:Record<string,LeaguePlayer>, completedAt:string): PlayerOutcome[] {
  return Object.values(players).flatMap(player=>{const actual=player.actuals?.find(a=>a.week===completedWeek); return actual===undefined?[]:[{leagueId,playerId:player.id,season,week:completedWeek,fantasyPoints:actual.points,active:true,position:player.primaryPosition,gameCompletedAt:completedAt,provenance:[{source:actual.source,asOf:actual.asOf,retrievedAt:completedAt}]}];});
}
function deadline(set:LiveForecastSnapshot[], cutoff:ComparisonCutoff) { const kickoff=set.find(x=>x.kickoffTime)?.kickoffTime; if(!kickoff)return undefined; const t=Date.parse(kickoff); return new Date(cutoff==="hours_24_before"?t-864e5:cutoff==="sunday_morning"?t:new Date(t).getTime()).toISOString(); }
/** Chooses the latest forecast for each model at one identical deadline. */
export function buildComparisonSets(forecasts:LiveForecastSnapshot[], outcomes:PlayerOutcome[], cutoff:ComparisonCutoff="kickoff"): ComparisonForecastSet[] {
  const grouped=new Map<string,LiveForecastSnapshot[]>(); for(const f of forecasts) grouped.set(`${f.leagueId}:${f.season}:${f.week}:${f.playerId}`,[...(grouped.get(`${f.leagueId}:${f.season}:${f.week}:${f.playerId}`)??[]),f]);
  const outcomeByKey=new Map(outcomes.map(x=>[`${x.leagueId}:${x.season}:${x.week}:${x.playerId}`,x]));
  return [...grouped.entries()].flatMap(([k,items])=>{const d=deadline(items,cutoff); if(!d)return[]; const selected:Partial<Record<ForecastSource,LiveForecastSnapshot>>={}; for(const source of ["ESPN","V4","V6"] as const){const eligible=items.filter(x=>x.source===source&&x.lockState==="PRE_LOCK"&&Date.parse(x.generatedAt)<=Date.parse(d)); if(eligible.length){const latest=eligible.sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt))[0]; selected[source]={...latest,capturePhase:"FINAL_PRELOCK"};}} if(!selected.ESPN||!selected.V4||!selected.V6)return[]; const first=items[0];return[{leagueId:first.leagueId,season:first.season,week:first.week,playerId:first.playerId,position:first.position,cutoff,predictionDeadline:d,kickoffTime:first.kickoffTime,forecasts:selected,outcome:outcomeByKey.get(k)}];});
}
export function modelMetrics(sets:ComparisonForecastSet[], source:ForecastSource):LiveModelMetrics { const valid=sets.filter(s=>s.outcome?.active&&s.forecasts[source]); const p=valid.map(s=>s.forecasts[source]!.expectedPoints),a=valid.map(s=>s.outcome!.fantasyPoints),e=a.map((x,i)=>p[i]-x); return {samples:a.length,mae:mean(e.map(Math.abs)),rmse:Math.sqrt(mean(e.map(x=>x*x))),spearman:corr(rank(p),rank(a)),pearson:corr(p,a),bias:mean(e)}; }
export function promotionStatus(position:string,horizon:"next1"|"next3"|"next5", champion:LiveModelMetrics, challenger:LiveModelMetrics, recentWins:boolean[], now=new Date().toISOString()):ModelChampionStatus { const minimum:{[key:string]:number}={QB:40,RB:100,WR:140,TE:60,ALL:300}; const blocks:string[]=[]; if(challenger.samples<(minimum[position]??300))blocks.push(`Requires ${minimum[position]??300} completed ${position} samples.`); if(challenger.spearman<champion.spearman+.015)blocks.push("Requires +0.015 Spearman improvement."); if(challenger.mae>champion.mae*1.03)blocks.push("MAE regressed by more than 3%."); if(recentWins.filter(Boolean).length<3)blocks.push("Requires improvement in 3 of the last 4 rolling windows."); return {position,horizon,championModel:"V4",challengerModel:"V6",sampleSize:challenger.samples,championMetrics:champion,challengerMetrics:challenger,promotionEligible:!blocks.length,promotionReasons:blocks.length?[]:["All live evidence thresholds met; explicit promotion remains required."],blockingReasons:blocks,evaluatedAt:now}; }
export function disagreementWatchlist(
  players: Record<string, PlayerIntelligence>,
  leaguePlayers: Record<string, LeaguePlayer>,
  challenger: Record<string, { expectedPoints: number; confidence: ConfidenceBand }> = {},
) {
  return Object.entries(challenger)
    .flatMap(([id, v]) => {
      const espn = leaguePlayers[id]?.forecasts.find((f) => f.week >= 1);
      const intel = players[id];
      if (!espn || !intel) return [];
      return [{ playerId: id, name: leaguePlayers[id].name, position: leaguePlayers[id].primaryPosition, espn: espn.mean, v6: v.expectedPoints, difference: v.expectedPoints - espn.mean, confidence: v.confidence }];
    })
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}
