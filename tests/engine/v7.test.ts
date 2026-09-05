/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import artifactJson from "../../artifacts/v6-ridge-2022-2025.json";
import { buildComparisonSets, captureForecastSnapshots, captureLiveForecastExperiment, loadV6Artifact, modelMetrics, outcomesFromLeaguePlayers, promotionStatus, type LeagueSnapshot, type LiveForecastSnapshot } from "../../src/engine/index";

const at="2026-09-05T10:00:00.000Z";
const snapshot=(source:"ESPN"|"V4"|"V6", time:string, points:number, lock:"PRE_LOCK"|"POST_LOCK"="PRE_LOCK"):LiveForecastSnapshot=>({id:`${source}-${time}`,leagueId:"L",season:2026,week:2,playerId:"p",generatedAt:time,source,expectedPoints:points,modelVersion:source,leagueSnapshotVersion:"s",position:"WR",kickoffTime:"2026-09-06T17:00:00.000Z",lockState:lock});
test("V7 preserves multiple immutable prediction timestamps and excludes post-lock forecasts",()=>{
  const rows=[snapshot("ESPN",at,10),snapshot("ESPN","2026-09-06T18:00:00.000Z",99,"POST_LOCK"),snapshot("V4",at,11),snapshot("V6",at,12)];
  const sets=buildComparisonSets(rows,[{leagueId:"L",playerId:"p",season:2026,week:2,fantasyPoints:14,active:true,gameCompletedAt:"2026-09-06T20:00:00.000Z",position:"WR",provenance:[]}]);
  assert.equal(rows.length,4); assert.equal(sets.length,1); assert.equal(sets[0].forecasts.ESPN?.expectedPoints,10); assert.equal(sets[0].forecasts.V6?.capturePhase,"FINAL_PRELOCK");
});
test("V7 requires equal pre-kickoff model coverage and handles inactive players outside production metrics",()=>{
  assert.equal(buildComparisonSets([snapshot("ESPN",at,10),snapshot("V4",at,11)],[]).length,0);
  const sets=buildComparisonSets([snapshot("ESPN",at,10),snapshot("V4",at,11),snapshot("V6",at,12)],[{leagueId:"L",playerId:"p",season:2026,week:2,fantasyPoints:0,active:false,gameCompletedAt:at,provenance:[]}]);
  assert.equal(modelMetrics(sets,"V6").samples,0);
});
test("V7 promotion blocks insufficient sample, weak rank gain, MAE regression, and unstable windows",()=>{
  const status=promotionStatus("WR","next1",{samples:150,mae:4,rmse:5,spearman:.5,pearson:.5,bias:0},{samples:100,mae:4.3,rmse:5,spearman:.51,pearson:.5,bias:0},[true,false]);
  assert.equal(status.promotionEligible,false); assert.ok(status.blockingReasons.length>=3);
  const eligible=promotionStatus("WR","next1",{samples:150,mae:4,rmse:5,spearman:.5,pearson:.5,bias:0},{samples:160,mae:3.9,rmse:5,spearman:.53,pearson:.5,bias:0},[true,true,true,false]);
  assert.equal(eligible.promotionEligible,true);
});
test("V7 capture retains model separation and no outcome is part of a prediction snapshot",()=>{
  // Compact test doubles intentionally model only capture fields.
  const player:any={id:"p",name:"P",primaryPosition:"WR",forecasts:[{week:1,mean:10,lower:5,upper:15,availabilityProbability:1,version:"espn"}],actuals:[{week:1,points:20,source:"ESPN",asOf:at}]};
  const intel:any={p:{fundamental:{expectedPoints:11,floor:6,ceiling:16,modelVersion:"v4"}}};
  const captured=captureForecastSnapshots("L",2026,1,{p:player},intel,at,"s");
  assert.deepEqual(captured.map(x=>x.source),["ESPN","V4"]); assert.ok(!("fantasyPoints" in captured[0]));
  assert.equal(outcomesFromLeaguePlayers("L",2026,1,{p:player},at)[0].fantasyPoints,20);
});
test("V8 post-week-1 fixture produces a genuine V6 row, persists idempotently, and compares at one cutoff",async()=>{
  const player:any={id:"p",name:"P",nflTeam:"BUF",primaryPosition:"WR",eligiblePositions:["WR"],forecasts:[{week:3,mean:10,lower:5,upper:15,availabilityProbability:1,version:"espn"}],actuals:[],provenance:{source:"fixture",asOf:at,retrievedAt:at}};
  const snapshot={id:"fixture",season:2026,currentWeek:3,name:"Fixture",primaryTeamId:"t",dataMode:"live",players:{p:player},freeAgentIds:["p"],waiverPlayerIds:[],schedule:[],teams:[{id:"t",name:"T",ownerIds:[],record:{wins:0,losses:0,ties:0},roster:[]}],settings:{scoring:[{statId:1,points:1,raw:{}}],lineupSlots:[{id:"wr",espnSlotId:4,name:"WR",count:1,kind:"active",eligiblePositions:["WR"]}],rosterSize:1,positionLimits:{},irSlots:0,playoffWeeks:[],raw:{}},provenance:{source:"fixture",asOf:at,retrievedAt:at,version:"fixture-v1"}} as unknown as LeagueSnapshot;
  const artifact=loadV6Artifact(artifactJson); assert.equal(artifact.status,"READY");
  const intelligence:any={p:{fundamental:{expectedPoints:11,floor:6,ceiling:16,modelVersion:"v4"}}};
  const rows:any[]=[];const outcomes:any[]=[];const store={appendForecasts:async(xs:LiveForecastSnapshot[])=>{for(const x of xs)if(!rows.some(y=>y.id===x.id))rows.push(x);},appendOutcomes:async(xs:any[])=>{outcomes.push(...xs);},forecasts:async()=>rows,outcomes:async()=>outcomes};
  const usage={p:[1,2].map(week=>({playerId:"p",season:2026,week,games:1,metrics:{targets:6,targetShare:.2,actualFantasyPoints:10+week},provenance:{source:"fixture",asOf:at,retrievedAt:at}}))};
  const result=await captureLiveForecastExperiment({snapshot,usage,intelligence,artifact,scheduleProvider:{getSeason:async()=>[{gameId:"g",season:2026,week:3,homeTeam:"BUF",awayTeam:"NYJ",kickoffAt:"2026-09-06T17:00:00.000Z",status:"scheduled"}]},store,now:()=>at});
  assert.equal(result.diagnostics.v6,1);assert.equal(result.snapshots.find(x=>x.source==="V6")?.lockState,"PRE_LOCK");assert.equal(result.diagnostics.persistence,"READY");assert.equal(buildComparisonSets(rows,[]).length,1);
  await captureLiveForecastExperiment({snapshot,usage,intelligence,artifact,scheduleProvider:{getSeason:async()=>[{gameId:"g",season:2026,week:3,homeTeam:"BUF",awayTeam:"NYJ",kickoffAt:"2026-09-06T17:00:00.000Z",status:"scheduled"}]},store,now:()=>at});assert.equal(rows.length,3);
  const later=await captureLiveForecastExperiment({snapshot,usage,intelligence,artifact,scheduleProvider:{getSeason:async()=>[{gameId:"g",season:2026,week:3,homeTeam:"BUF",awayTeam:"NYJ",kickoffAt:"2026-09-06T17:00:00.000Z",status:"scheduled"}]},store,now:()=>"2026-09-05T12:00:00.000Z"});assert.equal(later.diagnostics.v6,1);assert.equal(rows.length,6);
});
test("V8 missing artifact and schedule failure preserve ESPN/V4 without fabricating V6",async()=>{
  const player:any={id:"p",name:"P",nflTeam:"BUF",primaryPosition:"WR",eligiblePositions:["WR"],forecasts:[{week:3,mean:10,lower:5,upper:15,availabilityProbability:1,version:"espn"}],provenance:{source:"fixture",asOf:at,retrievedAt:at}};
  const snapshot:any={id:"fixture2",season:2026,currentWeek:3,name:"Fixture",primaryTeamId:"t",dataMode:"live",players:{p:player},freeAgentIds:["p"],waiverPlayerIds:[],schedule:[],teams:[{id:"t",name:"T",ownerIds:[],record:{wins:0,losses:0,ties:0},roster:[]}],settings:{scoring:[{statId:1,points:1,raw:{}}],lineupSlots:[{id:"wr",espnSlotId:4,name:"WR",count:1,kind:"active",eligiblePositions:["WR"]}],rosterSize:1,positionLimits:{},irSlots:0,playoffWeeks:[],raw:{}},provenance:{source:"fixture",asOf:at,retrievedAt:at,version:"fixture-v1"}};
  const rows:LiveForecastSnapshot[]=[];const store={appendForecasts:async(xs:LiveForecastSnapshot[])=>rows.push(...xs),appendOutcomes:async()=>{},forecasts:async()=>rows,outcomes:async()=>[]};const result=await captureLiveForecastExperiment({snapshot,usage:{},intelligence:{p:{fundamental:{expectedPoints:11,floor:6,ceiling:16,modelVersion:"v4"}}} as any,artifact:{status:"INVALID",diagnostic:"corrupt"},scheduleProvider:{getSeason:async()=>{throw new Error("provider failed")}},store,now:()=>at});assert.equal(result.diagnostics.v6,0);assert.equal(result.diagnostics.artifactStatus,"INVALID");assert.equal(result.diagnostics.espn,1);assert.equal(result.diagnostics.v4,1);assert.equal(result.snapshots.every(x=>x.source!=="V6"),true);
});
