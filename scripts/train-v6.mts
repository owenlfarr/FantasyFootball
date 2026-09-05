import { mkdir, writeFile } from "node:fs/promises";
import { buildStrictAsOfDataset, serializeForecastModel, trainRidge, FEATURE_FAMILIES } from "../src/engine/intelligence/calibration";
import { NflverseHistoricalProvider } from "../src/engine/intelligence/providers/nflverseHistorical";
import { validateV6Artifact } from "../src/engine/intelligence/v6Artifact";
const trainingSeasons=[2022,2023,2024,2025];
const stats=await new NflverseHistoricalProvider().getSeasons(trainingSeasons);const rows=buildStrictAsOfDataset(stats);const models=["QB","RB","WR","TE"].flatMap(position=>["next1","next3","next5"].flatMap(horizon=>{const model=trainRidge(rows.filter(r=>r.season<=2025),position as "QB"|"RB"|"WR"|"TE",horizon as "next1"|"next3"|"next5",[...FEATURE_FAMILIES.baseline,...FEATURE_FAMILIES.usage],12);if(!model)throw new Error(`Unable to train ${position}/${horizon}`);return [serializeForecastModel(model,trainingSeasons)];}));
const bundle={artifactVersion:"v6-bundle-1" as const,createdAt:new Date().toISOString(),models};if(!validateV6Artifact(bundle))throw new Error("Generated V6 artifact failed validation");
await mkdir("artifacts",{recursive:true});await writeFile("artifacts/v6-ridge-2022-2025.json",JSON.stringify(bundle,null,2));console.log(`Path: artifacts/v6-ridge-2022-2025.json\nArtifact version: ${bundle.artifactVersion}\nModel version: ${models[0].version}\nPositions: QB,RB,WR,TE\nHorizons: next1,next3,next5\nTraining seasons: ${trainingSeasons.join(",")}\nFeature counts: ${[...new Set(models.map(m=>m.featureNames.length))].join(",")}\nValidation: READY`);
