import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import type { FrameRate } from '@pea/core';
import { runProcess, type ProcessOptions } from './process.js';
export const INPUT_FORMATS='mov,matroska,webm,avi,wav,aiff,flac,mp3,ogg';
const EXTENSIONS=new Set(['.mov','.mp4','.m4v','.m4a','.mkv','.webm','.avi','.wav','.aif','.aiff','.flac','.mp3','.ogg']);
export interface AudioStreamInfo { index:number; channels:number; sampleRate:number; startSeconds:number; durationSeconds?:number }
export interface VideoStreamInfo { index:number; width:number; height:number; frameRate:FrameRate; vfrSuspected:boolean; startSeconds:number; durationSeconds?:number }
export interface MediaInfo { path:string; durationSeconds:number; startSeconds:number; size:number; mtimeMs:number; video?:VideoStreamInfo; audio:AudioStreamInfo[] }
export interface ProbeOptions extends ProcessOptions { ffprobePath?:string }
export async function localMediaPath(path:string):Promise<string>{
  if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0')||/^[a-z]+:\/\//i.test(path))throw new Error('absolute local media path required');
  const resolved=await realpath(path),info=await stat(resolved);
  if(!info.isFile())throw new Error('regular media file required');
  if(!EXTENSIONS.has(extname(resolved).toLowerCase()))throw new Error('unsupported media extension');
  return resolved;
}
function positive(value:unknown,label:string):number {const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error(`invalid ${label}`);return n;}
function seconds(value:unknown,fallback=0):number {if(value===undefined||value==='N/A')return fallback;const n=Number(value);if(!Number.isFinite(n))throw new Error('invalid timestamp');return n;}
function rate(value:unknown):{numerator:number;denominator:number}{
  if(typeof value!=='string'||!/^\d+\/\d+$/.test(value))throw new Error('invalid video frame rate');
  const [numerator,denominator]=value.split('/').map(Number);
  if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||numerator<=0||denominator<=0)throw new Error('invalid video frame rate');
  return {numerator,denominator};
}
/** Metadata is evidence only: equal average/nominal rates do not prove full-file CFR. */
export async function probeMedia(path:string,options:ProbeOptions={}):Promise<MediaInfo>{
  const resolved=await localMediaPath(path);
  const {stdout}=await runProcess(options.ffprobePath??'ffprobe',['-v','error','-protocol_whitelist','file','-format_whitelist',INPUT_FORMATS,
    '-show_format','-show_streams','-of','json','-i',resolved],options);
  const data=JSON.parse(stdout.toString('utf8'));
  if(!Array.isArray(data.streams)||!data.format)throw new Error('invalid ffprobe document');
  const durationSeconds=positive(data.format.duration,'media duration'),startSeconds=seconds(data.format.start_time);
  const info=await stat(resolved);const audio:AudioStreamInfo[]=[];let video:VideoStreamInfo|undefined;
  for(const s of data.streams){
    if(!Number.isSafeInteger(s.index)||s.index<0)throw new Error('invalid stream index');
    const d=s.duration===undefined||s.duration==='N/A'?undefined:positive(s.duration,'stream duration');
    if(s.codec_type==='audio'){
      const channels=positive(s.channels,'channel count'),sampleRate=positive(s.sample_rate,'sample rate');
      if(!Number.isInteger(channels)||!Number.isInteger(sampleRate))throw new Error('invalid audio metadata');
      audio.push({index:s.index,channels,sampleRate,startSeconds:seconds(s.start_time,startSeconds),durationSeconds:d});
    }
    if(s.codec_type==='video'&&!video&&s.disposition?.attached_pic!==1){
      const r=rate(s.r_frame_rate);let vfrSuspected=true;
      try{const avg=rate(s.avg_frame_rate);vfrSuspected=BigInt(r.numerator)*BigInt(avg.denominator)!==BigInt(avg.numerator)*BigInt(r.denominator);}catch{}
      video={index:s.index,width:positive(s.width,'width'),height:positive(s.height,'height'),frameRate:{rate:r,dropFrame:false},
        vfrSuspected,startSeconds:seconds(s.start_time,startSeconds),durationSeconds:d};
    }
  }
  return {path:resolved,durationSeconds,startSeconds,size:info.size,mtimeMs:info.mtimeMs,video,audio};
}
