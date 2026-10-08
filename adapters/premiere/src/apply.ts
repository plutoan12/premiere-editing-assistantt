import type {PremiereProjectSnapshot,PremiereSyncDryRun,PremiereSyncOperation} from "./types.js";
import {validateApplySnapshot} from "./state.js";
export interface PremiereHost {
 snapshot():Promise<PremiereProjectSnapshot>;
 createSyncSequence(name:string):Promise<string>;
 placeClip(sequenceId:string,operation:PremiereSyncOperation):Promise<void>;
}
export interface ApplyReport {sequenceId:string|null;applied:string[];failed:{clipId:string;error:string}[];rolledBack:false}
export async function applySyncDryRun(host:PremiereHost,dry:PremiereSyncDryRun):Promise<ApplyReport> {
 if(dry.errors.length) throw new Error("dry run contains errors");
 const validation=validateApplySnapshot(dry,await host.snapshot());
 if(!validation.ok) throw new Error(`stale apply plan: ${validation.reasons.join("; ")}`);
 const sequenceId=await host.createSyncSequence(dry.sequenceName);
 const report:ApplyReport={sequenceId,applied:[],failed:[],rolledBack:false};
 for(const operation of dry.operations) {
  try {await host.placeClip(sequenceId,operation);report.applied.push(operation.clipId);}
  catch(error){report.failed.push({clipId:operation.clipId,error:error instanceof Error?error.message:String(error)});}
 }
 return report;
}
