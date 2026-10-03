import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, isAbsolute } from 'node:path';
import { FfmpegAudioProvider, type FileSource, type FfmpegOptions, type MediaInfo } from '@pea/media-ffmpeg';
import { syncClips, frameTimebase, type SyncGroup } from '@pea/sync';
import { buildPremiereSyncPlan, renderPremiereXml, type PremiereOptions, type PremiereSyncPlan } from '@pea/premiere';
export interface FileSyncJob {schemaVersion:'1.0.0';name:string;referenceClipId:string;files:FileSource[];analysis?:{sampleRate?:number;windowSeconds?:number};sequence:Omit<PremiereOptions,'name'>}
export interface JobOptions extends FfmpegOptions {signal?:AbortSignal}
export interface FileSyncReport {
  schemaVersion:'1.0.0';name:string;group:SyncGroup;media:{clipId:string;media:MediaInfo}[];
  toolchain:{ffmpeg:string;ffprobe:string};analysis:{sampleRate:number;windowSeconds:number;windows:{clipId:string;startSeconds:number;channel:number;audioStream:number}[]};
  warnings:string[];acceptance:{humanSyncReview:'pending';premiereHost:'pending'};
  premiere:{status:'ready-for-review'|'blocked';plan?:PremiereSyncPlan;reason?:string};
}
function object(value:unknown,label:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} object required`);return value as Record<string,unknown>;}
function text(value:unknown,label:string):string{if(typeof value!=='string'||!value.trim()||value.includes('\0'))throw new Error(`${label} required`);return value;}
function optionalNumber(value:unknown,label:string):number|undefined {if(value===undefined)return undefined;if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`invalid ${label}`);return value;}
export function parseFileSyncJob(input:unknown):FileSyncJob{
  const raw=object(input,'job');if(raw.schemaVersion!=='1.0.0')throw new Error('unsupported schema version');
  const name=text(raw.name,'name'),referenceClipId=text(raw.referenceClipId,'reference');
  if(!Array.isArray(raw.files)||raw.files.length<2||raw.files.length>64)throw new Error('2..64 media files required');
  const ids=new Set<string>();
  return parseFiles(raw,name,referenceClipId,ids);
}
function parseFiles(raw:Record<string,unknown>,name:string,referenceClipId:string,ids:Set<string>):FileSyncJob{
  const files=(raw.files as unknown[]).map(value=>{
    const f=object(value,'file'),clipId=text(f.clipId,'clipId'),path=text(f.path,'path');
    if(ids.has(clipId))throw new Error('duplicate clipId');ids.add(clipId);
    if(/^[a-z][a-z0-9+.-]*:\/\//i.test(path))throw new Error('local media paths only');
    return {clipId,path,audioStream:optionalNumber(f.audioStream,'audio stream'),channel:optionalNumber(f.channel,'channel'),windowStartSeconds:optionalNumber(f.windowStartSeconds,'window')};
  });
  if(!ids.has(referenceClipId))throw new Error('reference clip not in files');
  const analysis=raw.analysis===undefined?{}:object(raw.analysis,'analysis');
  const sampleRate=optionalNumber(analysis.sampleRate,'analysis sample rate'),windowSeconds=optionalNumber(analysis.windowSeconds,'analysis window');
  // Validate numeric selectors and memory budget without starting any process.
  new FfmpegAudioProvider(files,{sampleRate,windowSeconds});
  const sequence=object(raw.sequence,'sequence'),r=object(sequence.frameRate,'frameRate'),rr=object(r.rate,'rate');
  const numerator=optionalNumber(rr.numerator,'rate numerator'),denominator=optionalNumber(rr.denominator,'rate denominator');
  const width=optionalNumber(sequence.width,'width'),height=optionalNumber(sequence.height,'height');
  if(numerator===undefined||denominator===undefined||width===undefined||height===undefined||typeof r.dropFrame!=='boolean')throw new Error('explicit sequence rate/dimensions/dropFrame required');
  frameTimebase({rate:{numerator,denominator},dropFrame:r.dropFrame});
  if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0)throw new Error('invalid sequence dimensions');
  if(sequence.rounding!==undefined&&sequence.rounding!=='reject'&&sequence.rounding!=='nearest')throw new Error('invalid rounding policy');
  return {schemaVersion:'1.0.0',name,referenceClipId,files,analysis:{sampleRate,windowSeconds},
    sequence:{width,height,frameRate:{rate:{numerator,denominator},dropFrame:r.dropFrame},rounding:sequence.rounding as 'reject'|'nearest'|undefined}};
}
export async function analyzeFileSync(job:FileSyncJob,baseDirectory:string,options:JobOptions={}):Promise<FileSyncReport>{
  if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const validated=parseFileSyncJob(job);
  const sources=validated.files.map(f=>({...f,path:isAbsolute(f.path)?f.path:resolve(baseDirectory,f.path)}));
  const provider=new FfmpegAudioProvider(sources,{...options,...validated.analysis});
  const toolchain=await provider.toolchain({signal:options.signal});
  const media:{clipId:string;media:MediaInfo}[]=[];
  for(const source of sources){if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');media.push({clipId:source.clipId,media:await provider.probe(source.clipId,{signal:options.signal})});}
  const group=await syncClips(validated.name,media.map(x=>({clipId:x.clipId,hasAudio:x.media.audio.length>0})),
    {referenceClipId:validated.referenceClipId,audioProvider:provider,signal:options.signal});
  const warnings=['Fixed-offset analysis only: inspect the beginning, middle and end of long recordings for drift.',
    'Analysis channel defaults to channel 0 of audio stream 0; the XML preserves original source channels.'];
  for(const source of sources){const m=media.find(x=>x.clipId===source.clipId)!.media;
    if((source.windowStartSeconds??0)>0||m.durationSeconds>provider.sampleCount/provider.sampleRate)
      warnings.push(`${source.clipId}: only the selected analysis window was searched; no full-file match guarantee.`);
  }
  let premiere:FileSyncReport['premiere'];
  try{premiere={status:'ready-for-review',plan:buildPremiereSyncPlan(group,media,{...validated.sequence,name:validated.name})};}
  catch(error){premiere={status:'blocked',reason:error instanceof Error?error.message:String(error)};}
  return {schemaVersion:'1.0.0',name:validated.name,group,media,toolchain,
    analysis:{sampleRate:provider.sampleRate,windowSeconds:provider.sampleCount/provider.sampleRate,
      windows:sources.map(f=>({clipId:f.clipId,startSeconds:Math.round((f.windowStartSeconds??0)*provider.sampleRate)/provider.sampleRate,channel:f.channel??0,audioStream:f.audioStream??0}))},
    warnings,acceptance:{humanSyncReview:'pending',premiereHost:'pending'},premiere};
}
export async function runManifestFile(manifestPath:string,outputDirectory:string,options:JobOptions={}):Promise<FileSyncReport>{
  if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const out=resolve(outputDirectory);try{await lstat(out);throw new Error('output directory already exists');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const file=resolve(manifestPath),bytes=await readFile(file);if(bytes.length>1048576)throw new Error('manifest size limit exceeded');
  const job=parseFileSyncJob(JSON.parse(bytes.toString('utf8'))),report=await analyzeFileSync(job,dirname(file),options);
  const json=JSON.stringify(report,(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n';
  const xml=report.premiere.plan?renderPremiereXml(report.premiere.plan):undefined;
  if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
  // Exclusive creation means a second run never overwrites a previous result or source directory.
  await mkdir(out,{recursive:false});await writeFile(resolve(out,'sync-report.json'),json,{flag:'wx'});
  if(xml!==undefined)await writeFile(resolve(out,'sync.xml'),xml,{flag:'wx'});
  return report;
}
