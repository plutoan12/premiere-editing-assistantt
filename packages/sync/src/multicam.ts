import type { MediaTime } from '@pea/core';
import type { SyncEvidence, SyncGroup } from './types.js';
import { SyncValidationError, validateEvidence } from './types.js';
import { buildTimecodeSyncGroup, compatibleTimecode, frameTimebase } from './timecode.js';
import { addTime, compareTime, validateMediaTime } from './time-math.js';
export interface MulticamEvidence extends SyncEvidence { duration: MediaTime }
export interface MulticamGrouping { groups: SyncGroup[]; unmatchedClipIds: string[] }
/** Connected temporal overlaps, partitioned by explicit shared TC clock and rate.
 * Audio-only cameras are aligned by syncClips, not guessed into clock sessions here.
 */
export function buildMulticamGroups(id:string,items:readonly MulticamEvidence[]):MulticamGrouping {
  validateEvidence(items,1);
  if(!id.trim()) throw new SyncValidationError('group id required');
  const buckets=new Map<string,MulticamEvidence[]>(),result:MulticamGrouping={groups:[],unmatchedClipIds:[]};
  for(const item of items) {
    validateMediaTime(item.duration);
    if(item.duration.ticks<=0n) throw new SyncValidationError('duration must be positive');
    if(!compatibleTimecode([item,item])) {result.unmatchedClipIds.push(item.clipId);continue;}
    const base=frameTimebase(item.frameRate!);
    const key=JSON.stringify([item.clockId,base.numerator,base.denominator,item.frameRate!.dropFrame]);
    const bucket=buckets.get(key)??[];bucket.push(item);buckets.set(key,bucket);
  }
  for(const [,bucket] of [...buckets.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0)) {
    const start=(x:MulticamEvidence):MediaTime=>({ticks:x.timecodeTicks!,timebase:frameTimebase(x.frameRate!)});
    const sorted=[...bucket].sort((a,b)=>compareTime(start(a),start(b))||(a.clipId<b.clipId?-1:1));
    let current:MulticamEvidence[]=[],end:MediaTime|undefined;
    const flush=()=>{
      if(current.length>1) result.groups.push(buildTimecodeSyncGroup(`${id}-${result.groups.length+1}`,current));
      else if(current.length) result.unmatchedClipIds.push(current[0].clipId);
    };
    for(const item of sorted) {
      const begin=start(item),itemEnd=addTime(begin,item.duration);
      if(end && compareTime(begin,end)>=0) {flush();current=[];end=undefined;}
      current.push(item);
      if(!end || compareTime(itemEnd,end)>0) end=itemEnd;
    }
    flush();
  }
  result.unmatchedClipIds.sort();return result;
}
