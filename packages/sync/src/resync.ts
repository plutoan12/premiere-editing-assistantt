import type { MediaTime, Rational } from "./types.js";
import type { TimeRange } from "@pea/core";
import { requireId, requireSameTimebase, sameRational, validRational, validateTime } from "./validation.js";
export interface SourceAnchoredArtifact { id:string; clipId:string; sourceRange:TimeRange }
export interface ResyncSegment {
  id:string;
  clipId:string;
  sourceRange:TimeRange;
  sequenceStart:MediaTime;
  /** Only exact 1x mapping is accepted in v1. Other rates are review-required. */
  playbackRate?:Rational;
}
export interface MappedArtifact { artifactId:string; segmentId:string; sequenceRange:TimeRange; coverage:"full"|"partial" }
export interface ResyncResult {
  mapped:MappedArtifact[];
  unmapped:{artifactId:string;reason:"deleted-source"|"source-range-not-covered"|"unsupported-playback-rate"}[];
  conflicted:{artifactId:string;candidates:MappedArtifact[]}[];
}
function validateRange(range:TimeRange):void {
  validateTime(range?.start,"source start");validateTime(range?.duration,"source duration");
  requireSameTimebase(range.start.timebase,range.duration.timebase);
  if(range.start.ticks<0n||range.duration.ticks<=0n) throw new Error("source range must be non-negative with positive duration");
}
function unique(items:readonly {id:string;clipId:string}[],label:string):void {
  const ids=new Set<string>();for(const item of items){
    requireId(item.id,`${label} ID`);requireId(item.clipId);
    if(ids.has(item.id)) throw new Error(`duplicate ${label} ID: ${item.id}`);ids.add(item.id);
  }
}
export function resyncArtifacts(artifacts:readonly SourceAnchoredArtifact[],segments:readonly ResyncSegment[]):ResyncResult {
  unique(artifacts,"artifact");unique(segments,"segment");
  for(const artifact of artifacts) validateRange(artifact.sourceRange);
  for(const segment of segments){
    validateRange(segment.sourceRange);validateTime(segment.sequenceStart,"sequence start");
    requireSameTimebase(segment.sourceRange.start.timebase,segment.sequenceStart.timebase);
    if(segment.sequenceStart.ticks<0n) throw new Error("sequence start must be non-negative");
    if(segment.playbackRate!==undefined&&!validRational(segment.playbackRate)) throw new Error("invalid playback rate");
  }
  const result:ResyncResult={mapped:[],unmapped:[],conflicted:[]};
  for(const artifact of artifacts) {
    const matches=segments.filter(segment=>segment.clipId===artifact.clipId);
    if(!matches.length){result.unmapped.push({artifactId:artifact.id,reason:"deleted-source"});continue;}
    const candidates:MappedArtifact[]=[];let unsupported=false;
    for(const segment of matches) {
      requireSameTimebase(artifact.sourceRange.start.timebase,segment.sourceRange.start.timebase);
      const start=artifact.sourceRange.start.ticks,end=start+artifact.sourceRange.duration.ticks;
      const segmentStart=segment.sourceRange.start.ticks,segmentEnd=segmentStart+segment.sourceRange.duration.ticks;
      const intersectionStart=start>segmentStart?start:segmentStart;
      const intersectionEnd=end<segmentEnd?end:segmentEnd;
      if(intersectionStart>=intersectionEnd) continue;
      if(segment.playbackRate&&!sameRational(segment.playbackRate,{numerator:1,denominator:1})){unsupported=true;continue;}
      candidates.push({artifactId:artifact.id,segmentId:segment.id,coverage:intersectionStart===start&&intersectionEnd===end?"full":"partial",sequenceRange:{
        start:{ticks:segment.sequenceStart.ticks+intersectionStart-segmentStart,timebase:{...segment.sequenceStart.timebase}},
        duration:{ticks:intersectionEnd-intersectionStart,timebase:{...segment.sequenceStart.timebase}}}});
    }
    // A retimed duplicate is also unresolved: do not silently choose the 1x copy.
    if(unsupported){result.unmapped.push({artifactId:artifact.id,reason:"unsupported-playback-rate"});continue;}
    if(candidates.length===1 && candidates[0].coverage==="full") result.mapped.push(candidates[0]);
    else if(candidates.length>1) result.conflicted.push({artifactId:artifact.id,candidates});
    else result.unmapped.push({artifactId:artifact.id,reason:"source-range-not-covered"});
  }
  return result;
}
