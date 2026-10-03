import {createHash,randomUUID} from 'node:crypto';
import {syncClips,type AudioSampleWindow,type AudioSampleProvider} from '@pea/sync';
import {validateWindowRequest,type AudioWindowRequest} from './audio-provider.js';
import {validateLocalPath} from './media-path.js';
import {object,exactKeys,pcmBytes} from './http-codec.js';
import {HelperError,publicError,throwIfAborted} from './errors.js';

export interface SyncInput {
  referenceClipId:string; sampleRate:number; maxSamples:number;
  clips:{clipId:string;path:string;startSample:string}[];
}
export type AudioReader=(path:string,request:AudioWindowRequest,sampleRate:number)=>Promise<AudioSampleWindow>;
export function validateSyncInput(value:unknown):SyncInput {
  const body=object(value);exactKeys(body,['referenceClipId','sampleRate','maxSamples','clips']);
  if(typeof body.referenceClipId!=='string'||!Array.isArray(body.clips)||body.clips.length<2||body.clips.length>16||
    typeof body.sampleRate!=='number'||![8000,16000,48000].includes(body.sampleRate)||typeof body.maxSamples!=='number'||body.maxSamples<64) {
    throw new HelperError('INVALID_SYNC','Use 2..16 sources, an explicit reference and a bounded analysis window',400);
  }
  const ids=new Set<string>();
  const clips=body.clips.map(value=>{
    const clip=object(value);exactKeys(clip,['clipId','path','startSample']);
    if(typeof clip.clipId!=='string'||!clip.clipId.trim()||clip.clipId.length>256||/[\x00-\x1f]/.test(clip.clipId)||ids.has(clip.clipId)||
      typeof clip.path!=='string'||clip.path.length>4096||typeof clip.startSample!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(clip.startSample)) {
      throw new HelperError('INVALID_SYNC','Invalid or duplicate source identity or window',400);
    }
    validateLocalPath(clip.path);
    validateWindowRequest(body.sampleRate as number,{startSample:BigInt(clip.startSample),maxSamples:body.maxSamples as number});
    ids.add(clip.clipId);return {clipId:clip.clipId,path:clip.path,startSample:clip.startSample};
  });
  if(!ids.has(body.referenceClipId))throw new HelperError('INVALID_SYNC','Reference must be one of the selected sources',400);
  return {referenceClipId:body.referenceClipId,sampleRate:body.sampleRate,maxSamples:body.maxSamples,clips};
}
/** Decode in this process, not in UXP. Never publish raw PCM or private file paths in the report. */
export async function runSyncJob(input:SyncInput,audio:AudioReader,signal:AbortSignal):Promise<unknown> {
  throwIfAborted(signal);
  const controller=new AbortController();
  const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)controller.abort();
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},120000);
  const pending=new Set<Promise<AudioSampleWindow>>();
  const analyses:{clipId:string;startSample:string;sampleCount:number;sampleRate:number;pcmSha256:string}[]=[];
  const provider:AudioSampleProvider={id:'ffmpeg-local',version:'2',async read(evidence){
    const source=input.clips.find(c=>c.clipId===evidence.clipId)!;
    throwIfAborted(controller.signal);
    const work=Promise.resolve().then(()=>{
      throwIfAborted(controller.signal);
      return audio(source.path,{startSample:BigInt(source.startSample),maxSamples:input.maxSamples,signal:controller.signal},input.sampleRate);
    });
    pending.add(work);
    try {
      const window=await work;throwIfAborted(controller.signal);
      if(window.sampleRate!==input.sampleRate||window.startSample!==BigInt(source.startSample)||window.samples.length>input.maxSamples) {
        throw new HelperError('INVALID_PCM','Decoder returned a different window policy',422);
      }
      const bytes=pcmBytes(window);
      analyses.push({clipId:source.clipId,startSample:String(window.startSample),sampleCount:window.samples.length,sampleRate:window.sampleRate,
        pcmSha256:createHash('sha256').update(bytes).digest('hex')});
      return window;
    } catch(error) {
      throwIfAborted(controller.signal);
      const safe=publicError(error);throw new HelperError(safe.code,safe.message,safe.status);
    } finally {pending.delete(work);}
  }};
  try {
    const group=await syncClips(randomUUID(),input.clips.map(c=>({clipId:c.clipId,hasAudio:true})),{
      referenceClipId:input.referenceClipId,audioOnly:true,audioProvider:provider,signal:controller.signal});
    throwIfAborted(controller.signal);
    return JSON.parse(JSON.stringify({schemaVersion:'1.0.0',helperVersion:'0.1.2',mode:'audio',sampleRate:input.sampleRate,
      maxSamples:input.maxSamples,origin:'original-file-zero',humanReview:'pending',analyses,group},(_key,value)=>typeof value==='bigint'?String(value):value));
  } catch(error) {
    if(timedOut&&!signal.aborted)throw new HelperError('SYNC_TIMEOUT','Sync analysis deadline exceeded',408);
    throw error;
  } finally {
    clearTimeout(timer);controller.abort();
    // syncClips releases an aborted caller early; retain ownership until actual decoders finish.
    await Promise.allSettled([...pending]);signal.removeEventListener('abort',abort);
  }
}
