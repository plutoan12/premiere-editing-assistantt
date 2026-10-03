import type { SyncEvidence, SyncGroup } from "./types.js";
import { buildTimecodeSyncGroup, hasValidTimecode } from "./timecode.js";
import { rationalKey, requireId, validateItems } from "./validation.js";
export interface MulticamResult { groups: SyncGroup[]; unmatchedClipIds: string[] }
/** Partition by compatible clocks, then connected half-open time intervals. */
export function buildMulticamGroups(id: string, items: readonly SyncEvidence[]): MulticamResult {
  requireId(id,"group ID");validateItems(items);
  const buckets = new Map<string,SyncEvidence[]>(), unmatched = new Set<string>();
  for(const item of items) {
    if(!hasValidTimecode(item)||typeof item.durationTicks!=="bigint"||item.durationTicks<=0n) {unmatched.add(item.clipId);continue;}
    const key=JSON.stringify([rationalKey(item.timebase!),rationalKey(item.frameRate!.rate),item.frameRate!.dropFrame,item.timecodeDomain??null]);
    const bucket=buckets.get(key)??[];bucket.push(item);buckets.set(key,bucket);
  }
  const groups:SyncGroup[]=[];
  for(const bucket of buckets.values()) {
    const sorted=[...bucket].sort((a,b)=>a.timecodeTicks!<b.timecodeTicks!?-1:a.timecodeTicks!>b.timecodeTicks!?1:0);
    let cluster:SyncEvidence[]=[],end=0n;
    const flush=()=>{
      if(cluster.length>=2) groups.push(buildTimecodeSyncGroup(`${id}:${groups.length+1}`,cluster));
      else if(cluster.length) unmatched.add(cluster[0].clipId);
    };
    for(const item of sorted) {
      if(cluster.length && item.timecodeTicks!>=end) {flush();cluster=[];}
      const itemEnd=item.timecodeTicks!+item.durationTicks!;
      if(!cluster.length||itemEnd>end) end=itemEnd;
      cluster.push(item);
    }
    flush();
  }
  return {groups,unmatchedClipIds:items.filter(item=>unmatched.has(item.clipId)).map(item=>item.clipId)};
}
