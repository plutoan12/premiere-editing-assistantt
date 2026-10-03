import type { SyncEvidence, SyncGroup } from './types.js';
import type { SyncOptions } from './sync.js';
import { syncClips } from './sync.js';
/** Music playback alignment deliberately ignores the camera's recording timecode. */
export function syncPlayback(id:string,master:SyncEvidence,takes:readonly SyncEvidence[],
  options:Omit<SyncOptions,'referenceClipId'|'audioOnly'>={}):Promise<SyncGroup> {
  return syncClips(id,[master,...takes],{...options,referenceClipId:master.clipId,audioOnly:true});
}

export interface PlaybackTakeResult { takeId:string; group:SyncGroup }
/** Isolate take failures while sharing the provider's internal/cacheable master decode path. Cancellation still aborts the batch. */
export async function syncPlaybackBatch(id:string,master:SyncEvidence,takes:readonly SyncEvidence[],
  options:Omit<SyncOptions,'referenceClipId'|'audioOnly'>={}):Promise<PlaybackTakeResult[]> {
  const results:PlaybackTakeResult[]=[];
  for(const take of takes) {
    const group=await syncClips(`${id}:${take.clipId}`,[master,take],{...options,referenceClipId:master.clipId,audioOnly:true});
    results.push({takeId:take.clipId,group});
  }
  return results;
}
