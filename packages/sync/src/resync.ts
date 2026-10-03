import type { MediaTime, SequencePlan, TimeRange } from '@pea/core';
import { SyncValidationError } from './types.js';
import { addTime, compareTime, subtractTime, validateMediaTime } from './time-math.js';
export interface SourceTimedArtifact { id:string; clipId:string; sourceRange:TimeRange }
export interface ArtifactPlacement { artifactId:string; decisionId:string; range:TimeRange }
export interface ResyncResult {
  mapped:ArtifactPlacement[];
  unmapped:{artifactId:string;reason:'SOURCE_REMOVED'|'SOURCE_TRIMMED'}[];
  conflicted:{artifactId:string;placements:ArtifactPlacement[]}[];
}
function validateRange(range:TimeRange):void {
  validateMediaTime(range.start);validateMediaTime(range.duration);
  if(range.start.ticks<0n) throw new SyncValidationError('source range start must be non-negative');
  if(range.duration.ticks<=0n) throw new SyncValidationError('duration must be positive');
}
function uniqueId(id:string,seen:Set<string>):void {
  if(!id.trim()) throw new SyncValidationError('id required');
  if(seen.has(id)) throw new SyncValidationError(`duplicate id: ${id}`);
  seen.add(id);
}
const end=(range:TimeRange):MediaTime=>addTime(range.start,range.duration);
/** 1x source-anchored remapping. Never rewrites/truncates an artifact or chooses
 * arbitrarily between duplicated source segments. Speed ramps are outside this API.
 */
export function resyncArtifacts(artifacts:readonly SourceTimedArtifact[],revised:SequencePlan):ResyncResult {
  const ids=new Set<string>();
  for(const decision of revised.decisions) {
    uniqueId(decision.id,ids);validateRange(decision.sourceRange);validateMediaTime(decision.destination);
    if(!decision.clipId.trim()) throw new SyncValidationError('clipId required');
    if(decision.destination.ticks<0n) throw new SyncValidationError('destination must be non-negative');
    const speed=(decision as unknown as {speed?:unknown}).speed;
    if(speed!==undefined && speed!==1) throw new SyncValidationError('time-remapped decisions are unsupported');
  }
  ids.clear();
  const result:ResyncResult={mapped:[],unmapped:[],conflicted:[]};
  for(const artifact of artifacts) {
    uniqueId(artifact.id,ids);validateRange(artifact.sourceRange);
    if(!artifact.clipId.trim()) throw new SyncValidationError('clipId required');
    const possible=revised.decisions.filter(d=>d.clipId===artifact.clipId);
    const contained=possible.filter(d=>compareTime(d.sourceRange.start,artifact.sourceRange.start)<=0
      && compareTime(end(d.sourceRange),end(artifact.sourceRange))>=0);
    const partial=possible.filter(d=>compareTime(d.sourceRange.start,end(artifact.sourceRange))<0 && compareTime(end(d.sourceRange),artifact.sourceRange.start)>0 && !contained.includes(d));
    const placements=contained.map(d=>({artifactId:artifact.id,decisionId:d.id,
      range:{start:addTime(d.destination,subtractTime(artifact.sourceRange.start,d.sourceRange.start)),
        duration:{ticks:artifact.sourceRange.duration.ticks,timebase:{...artifact.sourceRange.duration.timebase}}}}));
    if(placements.length===1 && partial.length===0) result.mapped.push(placements[0]);
    else if(placements.length>1 || (placements.length===1 && partial.length>0)) result.conflicted.push({artifactId:artifact.id,placements});
    else result.unmapped.push({artifactId:artifact.id,reason:possible.length?'SOURCE_TRIMMED':'SOURCE_REMOVED'});
  }
  return result;
}
