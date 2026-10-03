import type { TimeRange } from '@pea/core';
import type { PlanInput, RoughCutResult } from './types.js';
import { bounds, compare, fraction, mediaRange, mediaTime, positiveInteger, quantize, requireText, subtract, union, validateRational } from './time-math.js';
import type { Interval } from './time-math.js';

/** Pure proposal builder. It neither edits a project nor constitutes apply approval. */
export function buildRoughCutPlan(input: PlanInput): RoughCutResult {
  requireText(input.id, 'id'); requireText(input.name, 'name'); requireText(input.clipId, 'clipId');
  if (!input.frameRate || typeof input.frameRate.dropFrame !== 'boolean') throw new Error('frameRate.dropFrame must be boolean');
  validateRational(input.frameRate.rate, 'frameRate.rate');
  const quantum = { numerator: input.frameRate.rate.denominator, denominator: input.frameRate.rate.numerator };
  const [sourceStart, sourceEnd] = bounds(input.sourceRange, 'sourceRange');
  const duration = fraction(input.mediaDuration, 'mediaDuration');
  if (duration[0] <= 0n || compare(sourceEnd,duration)>0) throw new Error('sourceRange exceeds mediaDuration');
  const selected: Interval = [quantize(sourceStart,quantum,'exact','sourceRange.start'),quantize(sourceEnd,quantum,'exact','sourceRange.end')];
  if (!Array.isArray(input.candidates) || !Array.isArray(input.reviews)) throw new Error('candidates and reviews must be arrays');
  if (input.protectedRanges !== undefined && !Array.isArray(input.protectedRanges)) throw new Error('protectedRanges must be an array');
  if (input.maxOutputFrames !== undefined && (typeof input.maxOutputFrames !== 'bigint' || input.maxOutputFrames <= 0n)) throw new Error('maxOutputFrames must be a positive bigint');
  const mapRange = (range: TimeRange, label: string, inward: boolean): Interval => {
    const [start,end] = bounds(range,label);
    if (compare(start,sourceStart)<0 || compare(end,sourceEnd)>0) throw new Error(`${label} is outside selection`);
    return [quantize(start,quantum,inward?'ceil':'floor',`${label}.start`),quantize(end,quantum,inward?'floor':'ceil',`${label}.end`)];
  };
  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    if (!candidate) throw new Error('candidate is required');
    requireText(candidate.id, 'candidate.id');
    if (ids.has(candidate.id)) throw new Error(`duplicate candidate ID: ${candidate.id}`);
    ids.add(candidate.id);
    if (candidate.clipId !== input.clipId) throw new Error('candidate clipId does not match selected clipId');
    if (candidate.kind !== 'silence') throw new Error('Only silence candidates are supported in this increment');
    if (!candidate.evidence) throw new Error('candidate evidence is required');
    requireText(candidate.evidence.decoderId, 'candidate.evidence.decoderId');
    positiveInteger(candidate.evidence.windowSamples,'candidate.evidence.windowSamples');
    if (!Number.isFinite(candidate.evidence.thresholdDb) || candidate.evidence.thresholdDb>0 || candidate.evidence.thresholdDb< -160) throw new Error('candidate.evidence.thresholdDb is invalid');
    mapRange(candidate.sourceRange,'candidate.sourceRange',true);
  }
  const decisions = new Map<string,'keep'|'exclude'>();
  for (const review of input.reviews) {
    if (!review || !ids.has(review.candidateId)) throw new Error('unknown candidate review ID');
    if (decisions.has(review.candidateId)) throw new Error('duplicate review for candidate');
    if (review.action !== 'keep' && review.action !== 'exclude') throw new Error('review.action must be keep or exclude');
    decisions.set(review.candidateId,review.action);
  }
  const excludes: Interval[] = [];
  const protects: Interval[] = (input.protectedRanges ?? []).map(r=>mapRange(r,'protectedRange',false));
  const pendingCandidateIds: string[] = [];
  for (const candidate of input.candidates) {
    const decision = decisions.get(candidate.id);
    if (decision === 'exclude') excludes.push(mapRange(candidate.sourceRange,'candidate.sourceRange',true));
    else {
      protects.push(mapRange(candidate.sourceRange,'candidate.sourceRange',false));
      if (decision === undefined) pendingCandidateIds.push(candidate.id);
    }
  }
  const removed = subtract(union(excludes),union(protects));
  const kept = subtract([selected],removed);
  if (kept.length === 0) throw new Error('Refusing an empty rough sequence');
  let destination = 0n;
  const planDecisions = kept.map((interval,index)=> {
    const decision = { id:`${input.id}/keep/${index}`, clipId:input.clipId, sourceRange:mediaRange(interval,quantum), destination:mediaTime(destination,quantum) };
    destination += interval[1]-interval[0];
    return decision;
  });
  if (input.maxOutputFrames !== undefined && destination > input.maxOutputFrames) throw new Error('Rough sequence exceeds maxOutputFrames; review additional candidates');
  return { plan: {id:input.id,name:input.name,decisions:planDecisions}, removedRanges:removed.map(r=>mediaRange(r,quantum)), pendingCandidateIds };
}
