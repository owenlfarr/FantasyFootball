import { buildStrictAsOfDataset, FEATURE_FAMILIES, metrics, predictRidge, trainRidge } from "../src/engine/intelligence/calibration";
import { NflverseHistoricalProvider } from "../src/engine/intelligence/providers/nflverseHistorical";
const seasons = (process.argv.find(x=>x.startsWith("--seasons="))?.split("=")[1] ?? "2022,2023,2024,2025").split(",").map(Number);
const stats = await new NflverseHistoricalProvider().getSeasons(seasons);
const rows = buildStrictAsOfDataset(stats);
const train=rows.filter(r=>r.season<=2023), validation=rows.filter(r=>r.season===2024), test=rows.filter(r=>r.season===2025);
const families = { baseline:FEATURE_FAMILIES.baseline, usage:[...FEATURE_FAMILIES.baseline,...FEATURE_FAMILIES.usage], trend:[...FEATURE_FAMILIES.baseline,...FEATURE_FAMILIES.usage,...FEATURE_FAMILIES.trend], regression:[...FEATURE_FAMILIES.baseline,...FEATURE_FAMILIES.usage,...FEATURE_FAMILIES.trend,...FEATURE_FAMILIES.regression] };
const positions=["QB","RB","WR","TE"] as const;
// This CLI intentionally emits a flexible JSON report for offline inspection.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const result:any={source:"nflverse weekly player stats", seasons, rows:rows.length, splits:{train:train.length,validation:validation.length,test:test.length}, directHistoricalEspnProjectionAvailable:false, note:"Internal role-model validation only; ESPN remains live champion because historical timestamped ESPN projection snapshots were unavailable." , horizons:{}};
for (const horizon of ["next1","next3","next5"] as const) { result.horizons[horizon]={}; for(const position of positions) { // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const block:any={}; for(const [name,features] of Object.entries(families)) { const model=trainRidge(train,position,horizon,features); const samples=test.filter(r=>r.position===position && r.targets[horizon]!==undefined); if(!model || !samples.length) continue; const p=samples.map(r=>predictRidge(model,r.features)); block[name]=metrics(samples.map(r=>r.targets[horizon]!),p,model.residualStd); } result.horizons[horizon][position]=block; } }
console.log(JSON.stringify(result,null,2));
