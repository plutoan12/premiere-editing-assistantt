import type { FrameRate, MediaTime, Provenance } from '@pea/core';

export type SyncStrategy = 'timecode' | 'audio' | 'manual';
export type SyncReason = 'TIMECODE_MATCH' | 'AUDIO_MATCH' | 'MISSING_EVIDENCE'
  | 'INCOMPATIBLE_TIMECODE' | 'SILENCE' | 'INSUFFICIENT_OVERLAP'
  | 'LOW_CORRELATION' | 'AMBIGUOUS_PEAK' | 'SAMPLE_RATE_MISMATCH' | 'PROVIDER_ERROR';
export interface SyncEvidence {
  clipId: string;
  mediaAssetId?: string;
  sourceId?: string;
  /** Unwrapped physical frame count at clip-local time zero (NOT a HHMMSSFF integer). */
  timecodeTicks?: bigint;
  frameRate?: FrameRate;
  /** Explicit shared clock/jam-session AND recording-day identity. Never infer from filenames. */
  clockId?: string;
  hasAudio?: boolean;
  /** Cache identity only. A fingerprint is never accepted as an alignment measurement. */
  audioFingerprint?: string;
}
export interface SyncConfidence {
  score: number;
  secondBestScore?: number;
  margin?: number;
  /** A deterministic similarity score, not a calibrated probability of correct sync. */
  calibrated: false;
}
export interface SyncCandidate {
  referenceClipId: string;
  clipId: string;
  strategy: SyncStrategy;
  status: 'matched' | 'review';
  offset?: MediaTime;
  confidence: SyncConfidence;
  reason: SyncReason;
  provenance: Provenance;
  evidence: string[];
}
export interface SyncMember {
  clipId: string;
  mediaAssetId?: string;
  sourceId?: string;
  /** Placement relative to reference clip zero. Negative values are valid. */
  offset: MediaTime;
  /** Compatibility alias; interpret ONLY with offset.timebase. */
  offsetTicks: bigint;
}
export interface SyncGroup {
  schemaVersion: '1.0.0';
  id: string;
  referenceClipId: string;
  strategy: SyncStrategy | 'mixed';
  status: 'matched' | 'partial' | 'review';
  confidence: number;
  members: SyncMember[];
  candidates: SyncCandidate[];
}
export class SyncValidationError extends Error {
  override name = 'SyncValidationError';
}
export function validateEvidence(items: readonly SyncEvidence[], minimum = 2): void {
  if (items.length < minimum) throw new SyncValidationError(`at least ${minimum} clips required`);
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item.clipId !== 'string' || !item.clipId.trim()) throw new SyncValidationError('clipId required');
    if (seen.has(item.clipId)) throw new SyncValidationError(`duplicate clipId: ${item.clipId}`);
    seen.add(item.clipId);
    if (item.timecodeTicks !== undefined && (typeof item.timecodeTicks !== 'bigint' || item.timecodeTicks < 0n)) {
      throw new SyncValidationError('timecodeTicks must be a non-negative bigint');
    }
  }
}
export function makeMember(item: SyncEvidence, offset: MediaTime): SyncMember {
  return { clipId: item.clipId, mediaAssetId: item.mediaAssetId, sourceId: item.sourceId,
    offset: { ticks: offset.ticks, timebase: { ...offset.timebase } }, offsetTicks: offset.ticks };
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Sync cancelled', 'AbortError');
}
