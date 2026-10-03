import type { SyncEvidence, SyncGroup } from './types.js';
import type { SyncOptions } from './sync.js';
import { syncClips } from './sync.js';
/** Music playback alignment deliberately ignores the camera's recording timecode. */
export function syncPlayback(id:string,master:SyncEvidence,takes:readonly SyncEvidence[],
  options:Omit<SyncOptions,'referenceClipId'|'audioOnly'>={}):Promise<SyncGroup> {
  return syncClips(id,[master,...takes],{...options,referenceClipId:master.clipId,audioOnly:true});
}
