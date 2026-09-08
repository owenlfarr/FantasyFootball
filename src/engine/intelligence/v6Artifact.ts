import { validateSerializedForecastModel, type CalibrationPosition, type Horizon, type SerializedForecastModel } from "./calibration";
declare global { interface ImportMeta { glob(pattern:string, options?:Record<string,unknown>):Record<string,unknown>; } }

export interface V6ArtifactBundle { artifactVersion:"v6-bundle-1"; createdAt:string; models:SerializedForecastModel[]; }
export type V6ArtifactLoadResult =
  | { status:"READY"; artifact:V6ArtifactBundle; modelVersion:string }
  | { status:"MISSING"|"INVALID"|"UNSUPPORTED_VERSION"; diagnostic:string };
let cached:V6ArtifactLoadResult|undefined;
const positions:CalibrationPosition[]=["QB","RB","WR","TE"], horizons:Horizon[]=["next1","next3","next5"];
export function validateV6Artifact(value:unknown):V6ArtifactBundle|undefined {
  const x=value as Partial<V6ArtifactBundle>;
  if(x.artifactVersion!=="v6-bundle-1"||typeof x.createdAt!=="string"||!Array.isArray(x.models))return undefined;
  const models=x.models.map(validateSerializedForecastModel);
  if(models.some(m=>!m)||models.length!==12)return undefined;
  for(const position of positions)for(const horizon of horizons)
    if(models.filter(m=>m!.position===position&&m!.horizon===horizon).length!==1)return undefined;
  return {...x,models:models as SerializedForecastModel[]} as V6ArtifactBundle;
}
export function loadV6Artifact(rawOverride?:unknown):V6ArtifactLoadResult {
  if(rawOverride!==undefined)return load(rawOverride);
  if(cached?.status === "READY")return cached;
  let modules:Record<string,unknown>={};
  try{modules=import.meta.glob("../../../artifacts/v6-ridge-2022-2025.json",{eager:true,query:"?raw",import:"default"});}catch{/* tsx test runtime has no Vite glob; bundled builds use the asset above. */}
  const raw=Object.values(modules)[0];
  if(raw===undefined)return {status:"MISSING",diagnostic:"V6 artifact is not bundled."};
  try{const result=load(typeof raw==="string"?JSON.parse(raw):raw);if(result.status==="READY")cached=result;return result;}catch(error){return {status:"INVALID",diagnostic:error instanceof Error?error.message:"invalid V6 artifact"};}
}
function load(raw:unknown):V6ArtifactLoadResult {
  if((raw as {artifactVersion?:string})?.artifactVersion!=="v6-bundle-1")return {status:"UNSUPPORTED_VERSION",diagnostic:"Unsupported V6 artifact version."};
  const artifact=validateV6Artifact(raw); return artifact?{status:"READY",artifact,modelVersion:artifact.models[0].version}:{status:"INVALID",diagnostic:"V6 artifact failed schema validation."};
}
export function resetV6ArtifactCache(){cached=undefined;}
