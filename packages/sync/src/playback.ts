import { snapshotAudioWindow } from './audio-provider.js';
import type { AudioSampleProvider, AudioSampleWindow } from './audio-provider.js';
import type { SyncEvidence, SyncGroup } from './types.js';
import type { SyncOptions } from './sync.js';
import { syncClips } from './sync.js';
/** Music playback alignment deliberately ignores the camera's recording timecode. */
export function syncPlayback(id:string,master:SyncEvidence,takes:readonly SyncEvidence[],
  options:Omit<SyncOptions,'referenceClipId'|'audioOnly'>={}):Promise<SyncGroup> {
  return syncClips(id,[master,...takes],{...options,audioProvider:cachedProvider,referenceClipId:master.clipId,audioOnly:true});
}

export interface PlaybackTakeResult { takeId:string; group:SyncGroup }
/** Isolate take failures while sharing the provider's internal/cacheable master decode path. Cancellation still aborts the batch. */
export async function syncPlaybackBatch(id:string,master:SyncEvidence,takes:readonly SyncEvidence[],
  options:Omit<SyncOptions,'referenceClipId'|'audioOnly'>={}):Promise<PlaybackTakeResult[]> {
  const results:PlaybackTakeResult[]=[];
  const source=options.audioProvider;
  let masterWindow:Promise<AudioSampleWindow>|undefined;
  const cachedProvider:AudioSampleProvider|undefined=source?{
    id:source.id,version:source.version,
    read(clip,context){
      if(clip.clipId!==master.clipId) return source.read(clip,context);
      masterWindow??=source.read(clip,context).then(snapshotAudioWindow);
      return masterWindow;
    }
  }:undefined;
  for(const take of takes) {
    const group=await syncClips(`${id}:${take.clipId}`,[master,take],{...options,referenceClipId:master.clipId,audioOnly:true});
    results.push({takeId:take.clipId,group});
  }
  return results;
}
