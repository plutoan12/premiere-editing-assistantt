import {HelperError} from './errors.js';
import {validateLocalPath,LOCAL_MEDIA_FORMATS} from './media-path.js';

export interface MeasureInput {path: string; streamIndex: number; monoPolicy: 'native'|'dual-mono'}
export interface LoudnessTarget {integratedLufs: number; truePeakDbtp: number; loudnessRangeLu: number}
export interface NormalizeInput extends MeasureInput {approved: true; target: LoudnessTarget; allowDynamic: boolean}
export interface MeterValues {
  status: 'measured'|'unmeasurable'; integratedLufs: number|null; truePeakDbtp: number|null;
  loudnessRangeLu: number; sampleCount: number;
}
export interface LoudnormStats {integrated: number; peak: number; range: number; threshold: number; offset: number; mode: 'linear'|'dynamic'}
export interface AudioMetadata {sampleRate: number; channels: number; channelLayout: string; durationSeconds: number; startSeconds: number; containerStartSeconds: number}
function bad(message='Invalid audio measurement'): never {throw new HelperError('INVALID_AUDIO_MEASUREMENT',message,422);}
export function record(value: unknown): Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new HelperError('INVALID_AUDIO_INPUT','Expected an input object',400);
  return value as Record<string,unknown>;
}
function keys(x: Record<string,unknown>,allowed: string[]):void {
  if(Object.keys(x).some(k=>!allowed.includes(k))) throw new HelperError('INVALID_AUDIO_INPUT','Unknown audio input field',400);
}
function bounded(x: unknown,min: number,max: number):x is number {return typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;}
function measureFields(x: Record<string,unknown>):MeasureInput {
  if(typeof x.path!=='string') throw new HelperError('INVALID_PATH','A local media path is required',400);
  validateLocalPath(x.path);
  if(!Number.isSafeInteger(x.streamIndex)||!bounded(x.streamIndex,0,1024)) throw new HelperError('INVALID_STREAM','Explicit audio stream index required',400);
  if(x.monoPolicy!=='native'&&x.monoPolicy!=='dual-mono') throw new HelperError('INVALID_MONO_POLICY','Explicit native or dual-mono policy required',400);
  return {path:x.path,streamIndex:x.streamIndex,monoPolicy:x.monoPolicy};
}
export function validateMeasureInput(value: unknown):MeasureInput {
  const x=record(value); keys(x,['path','streamIndex','monoPolicy']);return measureFields(x);
}
export function validateNormalizeInput(value: unknown):NormalizeInput {
  const x=record(value); keys(x,['path','streamIndex','monoPolicy','approved','target','allowDynamic']);
  const base=measureFields(x),t=record(x.target);keys(t,['integratedLufs','truePeakDbtp','loudnessRangeLu']);
  if(x.approved!==true) throw new HelperError('APPROVAL_REQUIRED','Explicit render approval is required',400);
  if(typeof x.allowDynamic!=='boolean') throw new HelperError('INVALID_AUDIO_INPUT','Explicit allowDynamic boolean required',400);
  if(!bounded(t.integratedLufs,-70,-5)||!bounded(t.truePeakDbtp,-9,0)||!bounded(t.loudnessRangeLu,1,50)) throw new HelperError('INVALID_AUDIO_TARGET','Invalid loudness targets',400);
  return {...base,approved:true,allowDynamic:x.allowDynamic,target:{integratedLufs:t.integratedLufs,truePeakDbtp:t.truePeakDbtp,loudnessRangeLu:t.loudnessRangeLu}};
}
export function parseMeter(text: string):MeterValues {
  const summary=text.slice(text.lastIndexOf('Summary:'));
  const il=/Integrated loudness:\s*I:\s*(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary);
  const lra=/Loudness range:\s*LRA:\s*(\d+(?:\.\d+)?)\s+LU/.exec(summary);
  const tp=/True peak:\s*Peak:\s*(-?\d+(?:\.\d+)?|-inf)\s+dBFS/.exec(summary);
  const counts=[...text.matchAll(/Number of samples:\s*(\d+(?:\.\d+)?)/g)];
  if(!il||!lra||!tp||counts.length!==1) return bad();
  const sampleCount=Number(counts[0][1]),i=Number(il[1]),range=Number(lra[1]);
  if(!Number.isSafeInteger(sampleCount)||sampleCount<1||!bounded(i,-120,120)||!bounded(range,0,120)) return bad();
  const peak=tp[1]==='-inf'?null:Number(tp[1]);
  if(peak!==null&&!bounded(peak,-200,120))return bad();
  const integratedLufs=i<=-70||peak===null?null:i;
  return {status:integratedLufs===null?'unmeasurable':'measured',integratedLufs,truePeakDbtp:peak,loudnessRangeLu:range,sampleCount};
}
export function parseLoudnorm(text: string):LoudnormStats {
  const blocks=text.match(/\{[^{}]*\}/g)??[];
  const block=blocks.filter(b=>b.includes('"input_i"')).at(-1);
  if(!block)return bad('Missing loudnorm measurement');
  let x:Record<string,unknown>;try{x=record(JSON.parse(block));}catch{return bad();}
  function num(key:string,min:number,max:number):number {
    const value=x[key]; if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(value))return bad('Unmeasurable loudnorm input');
    const n=Number(value);if(!bounded(n,min,max))return bad();return n;
  }
  if(x.normalization_type!=='linear'&&x.normalization_type!=='dynamic')return bad();
  return {integrated:num('input_i',-99,0),peak:num('input_tp',-99,99),range:num('input_lra',0,99),threshold:num('input_thresh',-99,0),offset:num('target_offset',-99,99),mode:x.normalization_type};
}
export function parseAudioMetadata(text: string,index: number,maxSeconds: number):AudioMetadata {
  let raw:Record<string,unknown>;try{raw=record(JSON.parse(text));}catch{return bad('Invalid media probe metadata');}
  if(!Array.isArray(raw.streams))return bad('Invalid media probe streams');
  const streams=raw.streams.map(record),s=streams.find(v=>v.index===index&&v.codec_type==='audio');
  if(!s)throw new HelperError('INVALID_STREAM','Selected audio stream is unavailable',422);
  const format=record(raw.format??{}),rate=Number(s.sample_rate),channels=Number(s.channels);
  const duration=Number(s.duration??format.duration),start=Number(s.start_time??format.start_time??0),containerStart=Number(format.start_time??0);
  if(!Number.isSafeInteger(rate)||rate<8000||rate>192000||!Number.isSafeInteger(channels)||channels<1||channels>8||!Number.isFinite(duration)||duration<=0||duration>maxSeconds||!Number.isFinite(start)||!Number.isFinite(containerStart))return bad('Unsupported audio metadata or duration limit');
  const layout=typeof s.channel_layout==='string'?s.channel_layout:(channels===1?'mono':channels===2?'stereo':'');
  const layouts:Record<string,number>={mono:1,stereo:2,'5.1':6,'5.1(side)':6,'7.1':8};
  if(layouts[layout]!==channels)throw new HelperError('UNSUPPORTED_LAYOUT','Explicit supported audio channel layout required',422);
  return {sampleRate:rate,channels,channelLayout:layout,durationSeconds:duration,startSeconds:start,containerStartSeconds:containerStart};
}
export function inputArgs(input:MeasureInput):string[] {
  return ['-hide_banner','-nostdin','-nostats','-v','info','-protocol_whitelist','file,pipe','-format_whitelist',LOCAL_MEDIA_FORMATS,'-i',input.path,'-map',`0:${input.streamIndex}`,'-vn','-sn','-dn'];
}
export function meterFilter(policy:MeasureInput['monoPolicy']):string {
  return `ebur128=peak=true:framelog=verbose:dualmono=${policy==='dual-mono'?1:0},astats=metadata=0:reset=0:measure_perchannel=none:measure_overall=Number_of_samples`;
}
export function loudnormFilter(target:LoudnessTarget,policy:MeasureInput['monoPolicy'],stats?:LoudnormStats):string {
  let f=`loudnorm=I=${target.integratedLufs}:TP=${target.truePeakDbtp}:LRA=${target.loudnessRangeLu}:dual_mono=${policy==='dual-mono'?'true':'false'}:print_format=json`;
  if(stats)f+=`:measured_I=${stats.integrated}:measured_TP=${stats.peak}:measured_LRA=${stats.range}:measured_thresh=${stats.threshold}:offset=${stats.offset}:linear=true`;
  return f;
}
