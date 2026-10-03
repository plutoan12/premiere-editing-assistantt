import type { MediaTime } from '@pea/core';
import type { AudioSampleProvider, AudioSampleWindow } from './audio-provider.js';
import { snapshotAudioWindow, validateAudioWindow } from './audio-provider.js';
import type { AudioCorrelationOptions } from './audio-correlation.js';
import { correlateAudio } from './audio-correlation.js';
import type { SyncCandidate, SyncEvidence, SyncGroup } from './types.js';
import { makeMember, SyncValidationError, throwIfAborted, validateEvidence } from './types.js';
import { frameTimebase, matchTimecode } from './timecode.js';

export interface SyncOptions {
  referenceClipId?: string;
  audioProvider?: AudioSampleProvider;
  audio?: Omit<AudioCorrelationOptions,'signal'>;
  signal?: AbortSignal;
  /** Playback takes must align by sound, not recording clock. */
  audioOnly?: boolean;
}
function awaitWithAbort<T>(work:Promise<T>,signal?:AbortSignal):Promise<T> {
  if(!signal) return work;
  return new Promise<T>((resolve,reject)=>{
    const cleanup=()=>signal.removeEventListener('abort',cancel);
    const cancel=()=>{cleanup();reject(new DOMException('Sync cancelled','AbortError'));};
    signal.addEventListener('abort',cancel,{once:true});
    // Consume late provider failures even after cancellation; never leave an unhandled rejection.
    work.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted) cancel();
  });
}
/** Each target matches the SAME reference. No offset-chaining across cameras. */
export async function syncClips(id:string,items:readonly SyncEvidence[],options:SyncOptions={}):Promise<SyncGroup> {
  throwIfAborted(options.signal);validateEvidence(items);
  if(!id.trim()) throw new SyncValidationError('group id required');
  const reference=options.referenceClipId?items.find(x=>x.clipId===options.referenceClipId):items[0];
  if(!reference) throw new SyncValidationError('reference clip not found');
  let zero:MediaTime={ticks:0n,timebase:{numerator:1,denominator:1}};
  if(reference.frameRate) {try {zero={ticks:0n,timebase:frameTimebase(reference.frameRate)};} catch(error) {
    if(!(error instanceof SyncValidationError)) throw error;
  }}
  const members=[makeMember(reference,zero)],candidates:SyncCandidate[]=[];
  const provider=options.audioProvider,cache=new Map<string,Promise<AudioSampleWindow>>();
  const load=(clip:SyncEvidence):Promise<AudioSampleWindow>=>{
    let value=cache.get(clip.clipId);
    if(!value) {
      value=awaitWithAbort(Promise.resolve().then(()=>{throwIfAborted(options.signal);
        return provider!.read(clip,{signal:options.signal,providerVersion:provider!.version});})
        .then(w=>{throwIfAborted(options.signal);validateAudioWindow(w);return snapshotAudioWindow(w);}),options.signal);
      cache.set(clip.clipId,value);
    }
    return value;
  };
  for(const item of items) {
    if(item.clipId===reference.clipId) continue;
    // Allows cancellation between pairs on a main event loop; FFT itself is synchronous.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    throwIfAborted(options.signal);
    let candidate=matchTimecode(reference,item);
    if(options.audioOnly || candidate.status!=='matched') {
      candidate={referenceClipId:reference.clipId,clipId:item.clipId,strategy:'manual',status:'review',
        confidence:{score:0,calibrated:false},reason:'MISSING_EVIDENCE',provenance:{provider:'@pea/sync',version:'strategy-v1'},evidence:[]};
      if(provider && reference.hasAudio && item.hasAudio) {
        try {
          const rw=await load(reference),tw=await load(item);
          throwIfAborted(options.signal);
          const result=correlateAudio(rw,tw,{...options.audio,signal:options.signal});
          candidate={referenceClipId:reference.clipId,clipId:item.clipId,strategy:'audio',status:result.status,
            offset:result.offsetSamples===null?undefined:{ticks:BigInt(result.offsetSamples)+rw.startSample-tw.startSample,
              timebase:{numerator:1,denominator:rw.sampleRate}},
            confidence:{score:result.score,secondBestScore:result.secondBestScore,margin:result.margin,calibrated:false},
            reason:result.reason,provenance:{provider:provider.id,version:provider.version},
            evidence:[result.method,`windows:${rw.startSample}:${tw.startSample}`,`rate:${rw.sampleRate}:${tw.sampleRate}`,
              `overlap:${result.overlapSamples}`,`polarity:${result.polarity}`]};
        } catch(error) {
          throwIfAborted(options.signal);
          if(error instanceof Error && error.name==='AbortError') throw error;
          candidate={...candidate,reason:'PROVIDER_ERROR',provenance:{provider:provider.id,version:provider.version},
            evidence:[error instanceof Error?error.message:'unknown audio failure']};
        }
      }
    }
    candidates.push(candidate);
    if(candidate.status==='matched' && candidate.offset) members.push(makeMember(item,candidate.offset));
  }
  throwIfAborted(options.signal);
  const matched=candidates.filter(x=>x.status==='matched'),strategies=new Set(matched.map(x=>x.strategy));
  return {schemaVersion:'1.0.0',id,referenceClipId:reference.clipId,
    strategy:strategies.size>1?'mixed':matched[0]?.strategy??'manual',
    status:matched.length===candidates.length?'matched':matched.length?'partial':'review',
    confidence:matched.length?Math.min(...matched.map(x=>x.confidence.score)):0,members,candidates};
}
