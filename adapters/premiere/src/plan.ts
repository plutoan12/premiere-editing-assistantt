import { isAbsolute } from 'node:path';
import type { FrameRate, MediaTime } from '@pea/core';
import { frameTimebase, type SyncGroup } from '@pea/sync';
import type { MediaInfo } from '@pea/media-ffmpeg';
export interface PremiereSource { clipId:string; media:MediaInfo }
export interface PremiereOptions { name:string; frameRate:FrameRate; width:number; height:number; rounding?:'reject'|'nearest' }
export interface PremiereWarning { code:string; clipId?:string; message:string }
export interface PremiereClip extends PremiereSource { startFrame:number; durationFrames:number; roundingErrorSeconds:number }
export interface PremiereSyncPlan {
  schemaVersion:'1.0.0';mode:'add-new-sequence';approved:false;name:string;
  frameRate:FrameRate;width:number;height:number;durationFrames:number;monitorClipId?:string;clips:PremiereClip[];warnings:PremiereWarning[];
}
export function xmlText(text:string):string {
  if(typeof text!=='string'||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text))throw new Error('invalid XML text');
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
type Fraction={n:bigint;d:bigint};
function fraction(t:MediaTime):Fraction {
  if(!t||typeof t.ticks!=='bigint'||!Number.isSafeInteger(t.timebase?.numerator)||t.timebase.numerator<=0||!Number.isSafeInteger(t.timebase?.denominator)||t.timebase.denominator<=0)throw new Error('invalid media time');
  return {n:t.ticks*BigInt(t.timebase.numerator),d:BigInt(t.timebase.denominator)};
}
const cmp=(a:Fraction,b:Fraction)=>a.n*b.d-b.n*a.d;
function decimal(n:number):Fraction {
  if(!Number.isFinite(n)||n<=0||n>=86400)throw new Error('media duration must be between zero and 24 hours');
  // ffprobe durations have microsecond resolution. Keep the conversion explicit and bounded.
  return {n:BigInt(Math.round(n*1e6)),d:1000000n};
}
function safeNumber(n:bigint):number {if(n<0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('frame count out of bounds');return Number(n);}
export function buildPremiereSyncPlan(group:SyncGroup,sources:readonly PremiereSource[],options:PremiereOptions):PremiereSyncPlan {
  if(group.status!=='matched'||group.members.length<2)throw new Error('only fully matched groups can be exported');
  if(!options.name?.trim())throw new Error('sequence name required');xmlText(options.name);
  if(!Number.isSafeInteger(options.width)||options.width<=0||!Number.isSafeInteger(options.height)||options.height<=0)throw new Error('invalid sequence dimensions');
  if(options.rounding!==undefined&&!['reject','nearest'].includes(options.rounding))throw new Error('invalid rounding policy');
  const tb=frameTimebase(options.frameRate),rate={n:BigInt(tb.denominator),d:BigInt(tb.numerator)};
  const byId=new Map<string,MediaInfo>();for(const source of sources){if(byId.has(source.clipId))throw new Error('duplicate media clipId');byId.set(source.clipId,source.media);}
  const ids=new Set<string>();let referenceCount=0;const offsets:Fraction[]=[];
  for(const m of group.members){
    if(ids.has(m.clipId))throw new Error('duplicate group clipId');ids.add(m.clipId);
    const t=fraction(m.offset);offsets.push(t);
    if(m.clipId===group.referenceClipId){referenceCount++;if(t.n!==0n)throw new Error('reference must be at zero');continue;}
    const matches=group.candidates.filter(c=>c.clipId===m.clipId);
    if(matches.length!==1||matches[0].referenceClipId!==group.referenceClipId||matches[0].status!=='matched'||!matches[0].offset
      ||matches[0].strategy==='manual'||!matches[0].evidence.length||cmp(t,fraction(matches[0].offset))!==0n)throw new Error('invalid or inconsistent candidate evidence');
  }
  if(referenceCount!==1)throw new Error('reference clip missing');
  if(group.candidates.length!==group.members.length-1)throw new Error('candidate count mismatch');
  const origin=offsets.reduce((a,b)=>cmp(a,b)<0n?a:b);
  const warnings:PremiereWarning[]=[{code:'HOST_REVIEW_REQUIRED',message:'Generated exchange data only. Inspect imported tracks and sync in Premiere before editing.'},
    {code:'NO_DRIFT_CORRECTION',message:'A fixed offset does not validate clock drift across a long recording.'}];
  const clips=group.members.map((m,i):PremiereClip=>{
    const media=byId.get(m.clipId);if(!media)throw new Error(`missing media for ${m.clipId}`);
    if(typeof media.path!=='string'||!isAbsolute(media.path)||/^[a-z]+:\/\//i.test(media.path))throw new Error('absolute local media path required');xmlText(media.path);
    if(!media.video&&!media.audio.length)throw new Error('source has no usable media streams');
    if(media.video){
      const v=media.video,vt=frameTimebase(v.frameRate);
      if(BigInt(vt.numerator)*BigInt(tb.denominator)!==BigInt(tb.numerator)*BigInt(vt.denominator))throw new Error('source and sequence frame rate mismatch');
      if(v.vfrSuspected)throw new Error('VFR-suspected media requires explicit CFR conform before export');
      if(Math.abs(v.startSeconds-media.startSeconds)>1e-6)throw new Error('nonzero video start relative to container is unsupported');
      warnings.push({code:'CFR_METADATA_ONLY',clipId:m.clipId,message:'Average/nominal rates agree; full-file frame timestamp constancy has not been certified.'});
    }
    let channelCount=0;for(const a of media.audio){
      if(!Number.isSafeInteger(a.channels)||a.channels<=0||!Number.isSafeInteger(a.sampleRate)||a.sampleRate<=0)throw new Error('invalid audio metadata');
      if(a.sampleRate!==media.audio[0].sampleRate)throw new Error('mixed source audio sample rates unsupported');channelCount+=a.channels;
    }
    if(channelCount>32)throw new Error('more than 32 audio channels unsupported');
    const raw=offsets[i],n=(raw.n*origin.d-origin.n*raw.d)*rate.n,d=raw.d*origin.d*rate.d;
    const residual=n%d;
    if(residual!==0n&&options.rounding!=='nearest')throw new Error(`fractional frame offset for ${m.clipId}: explicit rounding policy required`);
    const frame=(n+d/2n)/d,roundingErrorSeconds=Number(frame*d-n)/Number(d)*Number(rate.d)/Number(rate.n);
    if(residual!==0n)warnings.push({code:'FRAME_ROUNDING',clipId:m.clipId,message:`Placement rounded to a sequence frame; residual ${roundingErrorSeconds} seconds.`});
    const duration=decimal(media.durationSeconds),dn=duration.n*rate.n,dd=duration.d*rate.d,durationFrames=safeNumber(dn/dd);
    if(durationFrames<1)throw new Error('media duration is less than one sequence frame');
    if(dn%dd!==0n)warnings.push({code:'DURATION_FLOORED',clipId:m.clipId,message:'Trailing fractional-frame duration is excluded; source file is unchanged.'});
    return {clipId:m.clipId,media:structuredClone(media),startFrame:safeNumber(frame),durationFrames,roundingErrorSeconds};
  });
  const durationFrames=Math.max(...clips.map(c=>c.startFrame+c.durationFrames));
  if(durationFrames*Number(rate.d)/Number(rate.n)>=86400)throw new Error('sequence must be shorter than 24 hours');
  return {schemaVersion:'1.0.0',mode:'add-new-sequence',approved:false,name:options.name,frameRate:structuredClone(options.frameRate),
    width:options.width,height:options.height,durationFrames,monitorClipId:clips.find(c=>c.clipId===group.referenceClipId&&c.media.audio.length)?.clipId??clips.find(c=>c.media.audio.length)?.clipId,clips,warnings};
}
