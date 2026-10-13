import type { FrameRate, MediaTime, Rational } from '@pea/core';
import { makeMember, SyncValidationError, validateEvidence } from './types.js';
import type { SyncCandidate, SyncEvidence, SyncGroup } from './types.js';
import { sameTimebase, validateTimebase } from './time-math.js';

const SUPPORTED = [[24,1],[25,1],[30,1],[48,1],[50,1],[60,1],
  [24000,1001],[30000,1001],[48000,1001],[60000,1001]] as const;
export function frameTimebase(rate: FrameRate): Rational {
  if(!rate || typeof rate.dropFrame !== 'boolean') throw new SyncValidationError('explicit frameRate and dropFrame required');
  validateTimebase(rate.rate);
  const normalized=SUPPORTED.find(([n,d])=>sameTimebase(rate.rate,{numerator:n,denominator:d}));
  if(!normalized) throw new SyncValidationError('unsupported timecode frame rate');
  if(rate.dropFrame && !(normalized[1]===1001 && (normalized[0]===30000 || normalized[0]===60000))) {
    throw new SyncValidationError('unsupported drop-frame rate');
  }
  return {numerator:normalized[1],denominator:normalized[0]};
}
/** Parse a label to counted frames; midnight rollover is an explicit caller decision. */
export function parseTimecode(label: string, rate: FrameRate, dayOffset=0): MediaTime {
  const timebase=frameTimebase(rate);
  if(!Number.isSafeInteger(dayOffset) || dayOffset<0) throw new SyncValidationError('invalid day offset');
  const parts=/^(\d{2}):(\d{2}):(\d{2})([:;])(\d{2})$/.exec(label);
  if(!parts) throw new SyncValidationError('invalid timecode label');
  const [h,m,s,f]=[Number(parts[1]),Number(parts[2]),Number(parts[3]),Number(parts[5])];
  const nominal=Math.round(timebase.denominator/timebase.numerator);
  if(h>23 || m>59 || s>59 || f>=nominal) throw new SyncValidationError('timecode component out of range');
  if((parts[4]===';')!==rate.dropFrame) throw new SyncValidationError('timecode separator disagrees with dropFrame');
  const drop=rate.dropFrame ? nominal/30*2 : 0;
  if(drop && m%10!==0 && s===0 && f<drop) throw new SyncValidationError('skipped drop-frame label');
  const minutes=h*60+m;
  const frames=((h*3600+m*60+s)*nominal+f)-drop*(minutes-Math.floor(minutes/10));
  const framesPerDay=nominal*86400-drop*(1440-144);
  return {ticks:BigInt(frames)+BigInt(dayOffset)*BigInt(framesPerDay),timebase};
}
export function compatibleTimecode(items: readonly SyncEvidence[]): boolean {
  if(items.length<2) return false;
  const first=items[0];
  if(!first.clockId?.trim() || !first.frameRate) return false;
  try {
    const base=frameTimebase(first.frameRate);
    return items.every(x=>typeof x.timecodeTicks==='bigint' && x.timecodeTicks>=0n
      && x.clockId===first.clockId && x.frameRate !== undefined
      && x.frameRate.dropFrame===first.frameRate!.dropFrame
      && sameTimebase(frameTimebase(x.frameRate),base));
  } catch (error) {
    if(error instanceof SyncValidationError) return false;
    throw error;
  }
}
export function matchTimecode(reference: SyncEvidence, item: SyncEvidence): SyncCandidate {
  const matched=compatibleTimecode([reference,item]);
  return {referenceClipId:reference.clipId,clipId:item.clipId,strategy:'timecode',
    status:matched?'matched':'review',
    offset:matched?{ticks:item.timecodeTicks!-reference.timecodeTicks!,timebase:frameTimebase(reference.frameRate!)}:undefined,
    confidence:{score:matched?1:0,calibrated:false},reason:matched?'TIMECODE_MATCH':'INCOMPATIBLE_TIMECODE',
    provenance:{provider:'@pea/sync',version:'timecode-v1'},
    evidence:matched?[`clock:${reference.clockId}`,`frames:${reference.timecodeTicks}:${item.timecodeTicks}`]:[]};
}
export function buildTimecodeSyncGroup(id: string, items: readonly SyncEvidence[], referenceClipId?: string): SyncGroup {
  validateEvidence(items);
  if(!id.trim()) throw new SyncValidationError('group id required');
  if(!compatibleTimecode(items)) throw new SyncValidationError('complete compatible timecode, frameRate and clockId required');
  const reference=referenceClipId?items.find(x=>x.clipId===referenceClipId):
    items.reduce((a,b)=>a.timecodeTicks!<=b.timecodeTicks!?a:b);
  if(!reference) throw new SyncValidationError('reference clip not found');
  const candidates=items.filter(x=>x!==reference).map(x=>matchTimecode(reference,x));
  return {schemaVersion:'1.0.0',id,referenceClipId:reference.clipId,strategy:'timecode',status:'matched',confidence:1,
    members:items.map(x=>makeMember(x,{ticks:x.timecodeTicks!-reference.timecodeTicks!,timebase:frameTimebase(reference.frameRate!)})),
    candidates};
}
