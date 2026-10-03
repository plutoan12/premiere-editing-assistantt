import { createHash, randomUUID } from 'node:crypto';
import type { AudioSampleWindow } from '@pea/sync';
import { PathGuard, fileRevision, type ApprovedFile } from './paths.js';
import { aborted, HelperError } from './errors.js';
import { runProcess } from './process.js';
import { parseWindow } from './protocol.js';
export interface MediaConfig {roots:readonly string[];ffmpeg?:string;ffprobe?:string;timeoutMs?:number}
export interface StreamInfo {index:number;codec:string;sampleRate:number|null;channels:number|null;startSeconds:number|null;frameRate:string|null}
export interface MediaInfo {assetId:string;revision:string;revisionKind:'stat-v1';durationSeconds:number|null;startSeconds:number|null;format:string;audio:StreamInfo[];video:StreamInfo[]}
interface Asset {path:string;info:MediaInfo}
export interface DecodedWindow {window:AudioSampleWindow;pcm:Buffer;sha256:string;policy:{channel:number;stream:number;sampleRate:number;origin:'clip-start';resample:'ffmpeg-aresample'}}
const DEMUXERS='wav,mov,matroska,mp3,flac,ogg,avi,mxf,aac';
const inputArgs=['-protocol_whitelist','file,pipe','-format_whitelist',DEMUXERS];
function finite(value:unknown):number|null{if(typeof value!=='string'&&typeof value!=='number')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function stream(raw:Record<string,unknown>):StreamInfo{
  const index=finite(raw.index),channels=finite(raw.channels),sampleRate=finite(raw.sample_rate);
  if(index===null||!Number.isSafeInteger(index)||index<0||index>255)throw new HelperError('INVALID_MEDIA','Invalid media stream',422);
  return {index,codec:typeof raw.codec_name==='string'?raw.codec_name.slice(0,64):'unknown',sampleRate,channels,
    startSeconds:finite(raw.start_time),frameRate:typeof raw.r_frame_rate==='string'?raw.r_frame_rate.slice(0,64):null};
}
export class MediaService {
  private readonly assets=new Map<string,Asset>();
  private readonly ffmpeg:string; private readonly ffprobe:string;private readonly timeoutMs:number;
  private constructor(private readonly guard:PathGuard,config:MediaConfig){
    this.ffmpeg=config.ffmpeg??'ffmpeg';this.ffprobe=config.ffprobe??'ffprobe';this.timeoutMs=config.timeoutMs??30000;
  }
  static async create(config:MediaConfig):Promise<MediaService>{
    if(!['darwin','linux'].includes(process.platform))throw new HelperError('UNSUPPORTED_PLATFORM','This development helper supports macOS and Linux',503);
    return new MediaService(await PathGuard.create(config.roots),config);
  }
  private async unchanged(file:ApprovedFile):Promise<void>{
    if(await fileRevision(file.handle)!==file.revision)throw new HelperError('MEDIA_CHANGED','Media changed during processing; probe it again',409);
  }
  async register(path:string,signal?:AbortSignal):Promise<MediaInfo>{
    aborted(signal);const file=await this.guard.open(path);
    try{
      for(const a of this.assets.values())if(a.path===file.path&&a.info.revision===file.revision)return structuredClone(a.info);
      if(this.assets.size>=256)throw new HelperError('ASSET_LIMIT','Restart the helper to clear registered media',429);
      const raw=await runProcess(this.ffprobe,['-v','error',...inputArgs,'-show_entries',
        'format=format_name,duration,start_time:stream=index,codec_type,codec_name,sample_rate,channels,start_time,r_frame_rate','-of','json','/dev/fd/3'],
        {inputFd:file.handle.fd,signal,timeoutMs:this.timeoutMs,maxOutputBytes:262144});
      let data:{streams?:Record<string,unknown>[];format?:Record<string,unknown>};
      try{data=JSON.parse(raw.toString('utf8'));}catch{throw new HelperError('INVALID_MEDIA','Invalid probe response',422);}
      if(!Array.isArray(data.streams)||data.streams.length>256)throw new HelperError('INVALID_MEDIA','Invalid stream metadata',422);
      const audio=data.streams.filter(x=>x.codec_type==='audio').map(stream),video=data.streams.filter(x=>x.codec_type==='video').map(stream);
      if(!audio.length&&!video.length)throw new HelperError('INVALID_MEDIA','No supported media stream was found',422);
      await this.unchanged(file);aborted(signal);
      const info:MediaInfo={assetId:randomUUID(),revision:file.revision,revisionKind:'stat-v1',
        durationSeconds:finite(data.format?.duration),startSeconds:finite(data.format?.start_time),
        format:typeof data.format?.format_name==='string'?data.format.format_name.slice(0,128):'unknown',audio,video};
      this.assets.set(info.assetId,{path:file.path,info});return structuredClone(info);
    }finally{await file.handle.close();}
  }
  info(assetId:string):MediaInfo{
    const a=this.assets.get(assetId);if(!a)throw new HelperError('ASSET_NOT_FOUND','Probe media before requesting an analysis',404);
    return structuredClone(a.info);
  }
  async read(assetId:string,request:unknown,signal?:AbortSignal):Promise<DecodedWindow>{
    aborted(signal);const spec=parseWindow(request),asset=this.assets.get(assetId);
    if(!asset)throw new HelperError('ASSET_NOT_FOUND','Probe media before requesting an analysis',404);
    const info=asset.info;if(!info.audio.length)throw new HelperError('NO_AUDIO','The media has no audio stream',422);
    const track=spec.stream===undefined?info.audio[0]:info.audio.find(s=>s.index===spec.stream);
    if(!track||!track.channels||spec.channel>=track.channels)throw new HelperError('INVALID_STREAM','Audio stream or channel is unavailable',422);
    // Decoder sample order is not sufficient evidence for an A/V stream-start shift.
    const origin=info.startSeconds??0,audioStart=track.startSeconds??0;
    if(Math.abs(audioStart-origin)>1e-6 || info.video.some(v=>v.startSeconds!==null&&Math.abs(v.startSeconds-origin)>1e-6)){
      throw new HelperError('UNSUPPORTED_TIMELINE','Different stream start times require explicit timestamp mapping',422);
    }
    const file=await this.guard.open(asset.path,info.revision);
    try{
      const end=BigInt(spec.startSample)+BigInt(spec.sampleCount);
      const filter=`pan=mono|c0=c${spec.channel},aresample=${spec.sampleRate},atrim=start_sample=${spec.startSample}:end_sample=${end},asetpts=PTS-STARTPTS`;
      const pcm=await runProcess(this.ffmpeg,['-nostdin','-hide_banner','-v','error','-threads','1',...inputArgs,'-i','/dev/fd/3',
        '-map',`0:${track.index}`,'-vn','-sn','-dn','-filter_threads','1','-af',filter,'-c:a','pcm_f32le','-f','f32le','pipe:1'],
        {inputFd:file.handle.fd,signal,timeoutMs:this.timeoutMs,maxOutputBytes:spec.sampleCount*4});
      aborted(signal);await this.unchanged(file);
      if(pcm.length!==spec.sampleCount*4)throw new HelperError('SHORT_WINDOW','Requested window extends beyond available audio',422);
      const samples=new Float32Array(spec.sampleCount);
      for(let i=0;i<samples.length;i++){
        samples[i]=pcm.readFloatLE(i*4);
        if(!Number.isFinite(samples[i])||Math.abs(samples[i])>1)throw new HelperError('INVALID_PCM','Decoded audio is not finite normalized PCM',422);
      }
      return {window:{samples,sampleRate:spec.sampleRate,startSample:BigInt(spec.startSample)},pcm,
        sha256:createHash('sha256').update(pcm).digest('hex'),policy:{channel:spec.channel,stream:track.index,sampleRate:spec.sampleRate,origin:'clip-start',resample:'ffmpeg-aresample'}};
    }finally{await file.handle.close();}
  }
}
