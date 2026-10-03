import type { AudioSampleProvider, AudioSamples } from "./audio-provider.js";
import { snapshotAudioWindow } from "./audio-provider.js";
import type { SyncEvidence, SyncResult } from "./types.js";
import type { CorrelationOptions } from "./audio-correlation.js";
import { synchronize } from "./sync.js";
import { requireId, throwIfAborted, validateItems } from "./validation.js";
export interface PlaybackRequest {
  id:string;
  reference:SyncEvidence;
  takes:readonly SyncEvidence[];
  provider:AudioSampleProvider;
  correlation?:Omit<CorrelationOptions,"signal">;
  signal?:AbortSignal;
}
export interface PlaybackResult { takeId:string; result:SyncResult }
export async function syncPlayback(request:PlaybackRequest):Promise<PlaybackResult[]> {
  requireId(request.id,"group ID");validateItems([request.reference,...request.takes]);throwIfAborted(request.signal);
  // Cache the reference promise, including a failure; never launch repeated failed decodes.
  let master:Promise<AudioSamples>|undefined;
  const cached:AudioSampleProvider={getSamples(clipId,options){
    if(clipId!==request.reference.clipId) return request.provider.getSamples(clipId,options);
    master??=Promise.resolve().then(()=>request.provider.getSamples(clipId,options)).then(snapshotAudioWindow);
    return master;
  }};
  const output:PlaybackResult[]=[];
  for(const take of request.takes) {
    throwIfAborted(request.signal);
    const result=await synchronize({id:`${request.id}:${take.clipId}`,items:[request.reference,take],provider:cached,
      referenceClipId:request.reference.clipId,mode:"audio",correlation:request.correlation,signal:request.signal});
    output.push({takeId:take.clipId,result});
  }
  return output;
}
