import assert from "node:assert/strict";
import test from "node:test";
import artifactJson from "../../artifacts/v6-ridge-2022-2025.json";
import {
  assertAsOfRow, buildStrictAsOfDataset, metrics, predictRidge, selectForecastChampion, trainRidge,
  type HistoricalWeeklyStat,
  buildV6FeatureRow, loadV6Artifact, predictWithV6,
} from "../../src/engine/index";

const make = (position: "QB"|"RB"|"WR"|"TE", id: string): HistoricalWeeklyStat[] => Array.from({length: 12}, (_, i) => ({
  playerId:id, season:2025, week:i+1, position, active:i !== 7,
  fantasyPoints: i === 7 ? undefined : 6 + i * .8, targets: position === "WR" ? 4+i*.4 : 0,
  carries: position === "RB" ? 8+i*.5 : 0, targetShare:position === "WR" ? .14+i*.01:0,
  airYardShare:position === "WR" ? .2:0, passAttempts:position === "QB" ? 25+i:0, touchdowns:i%3,
}));
test("V6 rejects future feature timestamps and excludes inactive zeros from conditional targets", () => {
  assert.throws(() => assertAsOfRow({playerId:"x",season:2025,predictionWeek:4,featureThroughWeek:4,position:"WR",features:{x:1},targets:{next1:1}}), /LEAKAGE/);
  const rows=buildStrictAsOfDataset(make("WR","x"));
  assert.ok(rows.every(r=>r.featureThroughWeek<r.predictionWeek));
  assert.ok(rows.some(r=>r.predictionWeek === 8 && r.targets.next1 !== 0));
});
test("V6 ridge inference is deterministic and never mixes chronological test data into fitting", () => {
  const stats=[...Array.from({length:30},(_,i)=>make("WR",`a${i}`)).flat(), ...Array.from({length:30},(_,i)=>make("RB",`b${i}`)).flat()];
  const rows=buildStrictAsOfDataset(stats).map((r,i)=>({...r,season:i%3===0?2022:i%3===1?2023:2025}));
  const train=rows.filter(r=>r.season<2025), testRows=rows.filter(r=>r.season===2025);
  const model=trainRidge(train,"WR","next1",["seasonPpg","last3Ppg","volume"],2)!;
  const one=predictRidge(model,testRows.find(r=>r.position==="WR")!.features);
  assert.equal(one,predictRidge(model,testRows.find(r=>r.position==="WR")!.features));
  assert.equal(model.trainedThrough,"2023");
});
test("metrics measure intervals and ranking without changing fantasy utility", () => {
  const result=metrics([10,20,30],[11,19,31],5);
  assert.equal(result.samples,3); assert.ok(result.interval80Coverage! > .9); assert.ok(result.spearman > .9);
});
test("champion registry refuses an internal-only challenger even when its standalone metrics look good", () => {
  const selected=selectForecastChampion([
    {id:"ESPN_BASELINE",directEspnComparison:false,selectedAt:"x",reason:"base",validation:{samples:10,mae:4,rmse:5,pearson:.5,spearman:.5}},
    {id:"V4_RULE_MODEL",directEspnComparison:false,selectedAt:"x",reason:"current"},
    {id:"V6_CALIBRATED",directEspnComparison:false,selectedAt:"x",reason:"internal",validation:{samples:10,mae:2,rmse:3,pearson:.8,spearman:.8}},
  ]);
  assert.equal(selected.id,"V4_RULE_MODEL");
});
test("serialized V6 bundle loads all models and live features exactly match historical features", () => {
  const result=loadV6Artifact(artifactJson); assert.equal(result.status,"READY");
  if(result.status!=="READY")return;
  assert.equal(result.artifact.models.length,12);
  const prior=make("WR","parity").slice(0,4), historical=buildStrictAsOfDataset([...prior,{...prior[3],week:5}])[2];
  const live=buildV6FeatureRow(prior,"WR"); assert.ok(live); assert.deepEqual(live?.features,historical.features);
  const prediction=predictWithV6(result.artifact.models.find(m=>m.position==="WR"&&m.horizon==="next1")!,live!.features,"2026-09-05T10:00:00.000Z");
  assert.ok(prediction); assert.ok(prediction!.upper>prediction!.expectedPoints); assert.ok(prediction!.lower<=prediction!.expectedPoints);
});
test("V6 artifact states fail closed",()=>{
  assert.equal(loadV6Artifact({artifactVersion:"v9"}).status,"UNSUPPORTED_VERSION");
  assert.equal(loadV6Artifact({artifactVersion:"v6-bundle-1",createdAt:"x",models:[]}).status,"INVALID");
});
