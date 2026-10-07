import type {MediaTime} from "@pea/core";
import type {SyncGroup} from "@pea/sync";
import type {PremiereProjectSnapshot,PremiereSyncDryRun,PremiereSyncOptions,PremiereSyncOperation} from "./types.js";

function seconds(t:MediaTime):number {return Number(t.ticks)*t.timebase.numerator/t.timebase.denominator}
export function buildSyncDryRun(group:SyncGroup,snapshot:PremiereProjectSnapshot,options:PremiereSyncOptions):PremiereSyncDryRun {
 const warnings:string[]=[],errors:string[]=[],operations:PremiereSyncOperation[]=[];
 if(snapshot.sequenceNames.includes(options.sequenceName)) errors.push(`sequence already exists: ${options.sequenceName}`);
 if(!Number.isFinite(options.frameRate.numerator)||!Number.isFinite(options.frameRate.denominator)||options.frameRate.numerator<=0||options.frameRate.denominator<=0) errors.push("invalid frame rate");
 const matchedIds=new Set([group.referenceClipId,...group.candidates.filter(x=>x.status==="matched").map(x=>x.clipId)]);
 const members=group.members.filter(x=>matchedIds.has(x.clipId));
 for(const m of members) if(!snapshot.media.some(x=>x.clipId===m.clipId&&(!m.mediaAssetId||x.mediaAssetId===m.mediaAssetId))) errors.push(`missing stable media mapping: ${m.clipId}`);
 if(errors.length) return {sequenceName:options.sequenceName,projectId:snapshot.projectId,projectVersion:snapshot.projectVersion,operations,warnings,errors};
 const raw=members.map(m=>({m,s:seconds(m.offset)})); const min=Math.min(...raw.map(x=>x.s),0);
 const frameSeconds=options.frameRate.denominator/options.frameRate.numerator;
 raw.forEach(({m,s},trackIndex)=>{
   const unquantized=s-min,quantized=Math.round(unquantized/frameSeconds)*frameSeconds,error=quantized-unquantized;
   if(Math.abs(error)>1e-12) warnings.push(`${m.clipId} quantized by ${error} seconds`);
   const media=snapshot.media.find(x=>x.clipId===m.clipId)!;
   operations.push({kind:"place",clipId:m.clipId,projectItemId:media.projectItemId,startSeconds:quantized,trackIndex,quantizationErrorSeconds:error});
 });
 return {sequenceName:options.sequenceName,projectId:snapshot.projectId,projectVersion:snapshot.projectVersion,operations,warnings,errors};
}
