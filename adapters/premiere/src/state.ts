import type {PremiereProjectSnapshot,PremiereSyncDryRun} from "./types.js";
export interface ApplyValidation {ok:boolean;reasons:string[]}
export function validateApplySnapshot(dry:PremiereSyncDryRun,current:PremiereProjectSnapshot):ApplyValidation {
 const reasons:string[]=[];
 if(current.projectId!==dry.projectId||current.projectVersion!==dry.projectVersion) reasons.push("stale project state");
 for(const op of dry.operations) if(!current.media.some(m=>m.clipId===op.clipId&&m.projectItemId===op.projectItemId)) reasons.push(`stale media mapping: ${op.clipId}`);
 if(current.sequenceNames.includes(dry.sequenceName)) reasons.push(`target sequence now exists: ${dry.sequenceName}`);
 return {ok:reasons.length===0,reasons};
}
