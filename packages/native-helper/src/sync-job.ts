import { syncClips, type AudioSampleProvider, type AudioSampleWindow, type SyncGroup } from '@pea/sync';
import { MediaService, type DecodedWindow } from './media.js';
import { aborted, HelperError, publicError } from './errors.js';
import { HELPER_VERSION, MAX_SAMPLES, integer, object, parseWindow, text, type WindowSpec } from './protocol.js';
export interface SyncClip {clipId:string;assetId:string;window:WindowSpec}
export interface SyncRequest {kind:'sync';clips:SyncClip[];referenceClipId:string;maxLagSamples?:number;minOverlapSamples:number}
export interface SyncInputReport {clipId:string;assetId:string;revision:string;window:WindowSpec;pcmSha256?:string;policy?:DecodedWindow['policy'];error?:{code:string;message:string}}
export interface SyncJobResult {group:SyncGroup;inputs:SyncInputReport[];helperVersion:string;analysis:'bounded-audio-window'}
export function parseSyncRequest(value:unknown):SyncRequest{
  const r=object(value,['kind','clips','referenceClipId','maxLagSamples','minOverlapSamples']);
  if(r.kind!=='sync'||!Array.isArray(r.clips)||r.clips.length<2||r.clips.length>16)throw new HelperError('INVALID_REQUEST','A sync job requires 2 to 16 clips');
  const clips=r.clips.map(item=>{const c=object(item,['clipId','assetId','window']);return {clipId:text(c.clipId,'clip ID',128),assetId:text(c.assetId,'asset ID',128),window:parseWindow(c.window??{})};});
  if(new Set(clips.map(c=>c.clipId)).size!==clips.length)throw new HelperError('INVALID_REQUEST','Duplicate clip IDs');
  if(new Set(clips.map(c=>c.window.sampleRate)).size!==1)throw new HelperError('INVALID_REQUEST','All windows must request the same analysis rate');
  const referenceClipId=r.referenceClipId===undefined?clips[0].clipId:text(r.referenceClipId,'reference clip',128);
  if(!clips.some(c=>c.clipId===referenceClipId))throw new HelperError('INVALID_REQUEST','Unknown reference clip');
  const minCount=Math.min(...clips.map(c=>c.window.sampleCount));
  return {kind:'sync',clips,referenceClipId,maxLagSamples:r.maxLagSamples===undefined?undefined:integer(r.maxLagSamples,0,MAX_SAMPLES-1,'search radius'),
    minOverlapSamples:integer(r.minOverlapSamples??Math.max(16,Math.min(Math.floor(minCount/2),clips[0].window.sampleRate/2)),16,minCount,'minimum overlap')};
}
export async function executeSync(id:string,value:unknown,media:MediaService,signal:AbortSignal,progress:(value:number)=>void):Promise<SyncJobResult>{
  aborted(signal);const request=parseSyncRequest(value);
  const inputs:SyncInputReport[]=request.clips.map(c=>({clipId:c.clipId,assetId:c.assetId,revision:media.info(c.assetId).revision,window:c.window}));
  let reads=0;const pending=new Set<Promise<AudioSampleWindow>>();
  const provider:AudioSampleProvider={id:'@pea/native-helper/ffmpeg',version:HELPER_VERSION,read(clip,context){
    const work=(async()=>{
    const c=request.clips.find(x=>x.clipId===clip.clipId)!;const report=inputs.find(x=>x.clipId===clip.clipId)!;
    try{
      const decoded=await media.read(c.assetId,c.window,context?.signal??signal);
      report.pcmSha256=decoded.sha256;report.policy=decoded.policy;return decoded.window;
    }catch(error){const safe=publicError(error);report.error={code:safe.code,message:safe.message};throw error;}
    finally{progress(Math.min(.9,(++reads/request.clips.length)*.9));}
    })();
    pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
  }};
  const items=request.clips.map(c=>({clipId:c.clipId,mediaAssetId:c.assetId,hasAudio:media.info(c.assetId).audio.length>0}));
  try{
  const group=await syncClips(id,items,{audioOnly:true,audioProvider:provider,referenceClipId:request.referenceClipId,signal,
    audio:{minScore:.85,minMargin:.1,minOverlapSamples:request.minOverlapSamples,maxLagSamples:request.maxLagSamples}});
  aborted(signal);progress(1);
  return {group,inputs,helperVersion:HELPER_VERSION,analysis:'bounded-audio-window'};
  }finally{
    // Core can release an aborted caller before a provider stops. Retain ownership here.
    await Promise.allSettled([...pending]);
  }
}
