import type { AudioSampleProvider, AudioSamples } from "./audio-provider.js";
import { MAX_AUDIO_WINDOW_SAMPLES, snapshotAudioWindow } from "./audio-provider.js";
import { correlateAudio } from "./audio-correlation.js";
import type { CorrelationOptions } from "./audio-correlation.js";
import type { SyncCandidate, SyncEvidence, SyncProvenance, SyncReason, SyncResult } from "./types.js";
import { buildTimecodeSyncGroup, compatibleTimecodes } from "./timecode.js";
import { isAbort, memberAt, requireId, throwIfAborted, validateItems } from "./validation.js";

export interface SyncRequest {
  id: string;
  items: readonly SyncEvidence[];
  provider?: AudioSampleProvider;
  referenceClipId?: string;
  /** Playback alignment must use audio, never the cameras' recording timecodes. */
  mode?: "auto" | "audio";
  correlation?: Omit<CorrelationOptions, "signal">;
  signal?: AbortSignal;
}
function confidence(result: ReturnType<typeof correlateAudio>) {
  return { score: result.score, secondBestScore: result.secondBestScore, margin: result.margin, overlapSamples: result.overlapSamples };
}
function message(error: unknown): string { return error instanceof Error ? error.message : "audio provider failed"; }
/** The provider must honor signal too; this releases the caller if an adapter ignores it. */
async function readSamples(provider: AudioSampleProvider, clipId: string, signal?: AbortSignal): Promise<AudioSamples> {
  throwIfAborted(signal);
  if (!signal) return provider.getSamples(clipId, { maxSamples: MAX_AUDIO_WINDOW_SAMPLES });
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? Object.assign(new Error("Operation cancelled"), {name:"AbortError"})); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { throwIfAborted(signal); return provider.getSamples(clipId, {maxSamples:MAX_AUDIO_WINDOW_SAMPLES,signal}); })
      .then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export async function synchronize(request: SyncRequest): Promise<SyncResult> {
  throwIfAborted(request.signal);
  requireId(request.id, "group ID"); validateItems(request.items, 2);
  const referenceClipId = request.referenceClipId ?? request.items[0].clipId;
  const reference = request.items.find(item => item.clipId === referenceClipId);
  if (!reference) throw new Error("unknown reference clip");
  if (request.mode !== undefined && request.mode !== "auto" && request.mode !== "audio") throw new Error("invalid sync mode");
  if (request.mode !== "audio" && compatibleTimecodes(request.items)) {
    return {status:"synced",group:buildTimecodeSyncGroup(request.id, request.items, referenceClipId),candidates:[],reasons:[]};
  }
  const reasons: SyncReason[] = request.mode === "audio" ? [] : [request.items.every(item=>item.timecodeTicks!==undefined) ? "incompatible-timecode" : "missing-timecode"];
  if (!request.provider) return {status:"review-required",candidates:[],reasons:[...reasons,"no-audio-provider"]};
  let master: AudioSamples;
  try { master = await readSamples(request.provider, referenceClipId, request.signal); }
  catch(error) {
    throwIfAborted(request.signal); if (isAbort(error)) throw error;
    return {status:"review-required",candidates:request.items.filter(item=>item.clipId!==referenceClipId)
      .map(item=>({clipId:item.clipId,referenceClipId,status:"review-required",reason:"provider-error",detail:message(error)})),reasons:[...reasons,"provider-error"]};
  }
  throwIfAborted(request.signal);
  try { master = snapshotAudioWindow(master); }
  catch(error) {
    return {status:"review-required",candidates:request.items.filter(item=>item.clipId!==referenceClipId)
      .map(item=>({clipId:item.clipId,referenceClipId,status:"review-required",reason:"invalid-audio",detail:message(error)})),reasons:[...reasons,"invalid-audio"]};
  }
  const timebase = {numerator:1,denominator:master.sampleRate};
  const offsets = new Map<string,bigint>([[referenceClipId,0n]]);
  const candidates: SyncCandidate[] = [];
  const provenance: SyncProvenance[] = [{clipId:referenceClipId,method:"audio-reference",timebase:{...timebase},windowStartSample:master.startSample}];
  for (const item of request.items) {
    if (item.clipId === referenceClipId) continue;
    throwIfAborted(request.signal);
    let window: AudioSamples;
    try { window = await readSamples(request.provider,item.clipId,request.signal); }
    catch(error) {
      throwIfAborted(request.signal); if(isAbort(error)) throw error;
      candidates.push({clipId:item.clipId,referenceClipId,status:"review-required",reason:"provider-error",detail:message(error)});continue;
    }
    throwIfAborted(request.signal);
    try {
      const result = correlateAudio(master,window,{...request.correlation,signal:request.signal});
      const offset = result.offsetSamples === null ? undefined : {
        ticks:BigInt(result.offsetSamples)+BigInt(master.startSample)-BigInt(window.startSample),timebase:{...timebase}};
      candidates.push({clipId:item.clipId,referenceClipId,status:result.status,offset,confidence:confidence(result),reason:result.reason});
      if(result.status === "matched" && offset) {
        offsets.set(item.clipId,offset.ticks);
        provenance.push({clipId:item.clipId,referenceClipId,method:"audio-correlation",timebase:{...timebase},windowStartSample:window.startSample,
          referenceWindowStartSample:master.startSample,lagSamples:result.offsetSamples!,confidence:confidence(result)});
      }
    } catch(error) {
      throwIfAborted(request.signal); if(isAbort(error)) throw error;
      candidates.push({clipId:item.clipId,referenceClipId,status:"review-required",reason:"invalid-audio",detail:message(error)});
    }
  }
  throwIfAborted(request.signal);
  if(offsets.size !== request.items.length) return {status:"review-required",candidates,
    reasons:[...new Set([...reasons,...candidates.flatMap(candidate=>candidate.reason?[candidate.reason]:[])])]};
  const earliest = [...offsets.values()].reduce((min,value)=>value<min?value:min,0n);
  return {status:"synced",candidates,reasons,group:{id:request.id,strategy:"audio",referenceClipId,timebase,
    confidence:Math.min(...candidates.map(candidate=>candidate.confidence!.score)),
    members:request.items.map(item=>memberAt(item,offsets.get(item.clipId)!-earliest,timebase)),provenance}};
}
