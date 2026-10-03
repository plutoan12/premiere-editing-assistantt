import type { FrameRate, MediaTime, SequencePlan, TimeRange } from '@pea/core';

/** Asset/source coordinates, NOT sequence time or an unadjusted container PTS. */
export interface PcmWindow {
  readonly clipId: string;
  readonly decoderId: string;
  readonly sourceStart: MediaTime;
  readonly sampleRate: number;
  /** Preserve separate channels. Do not average them before silence detection. */
  readonly channels: readonly Float32Array[];
}
export interface SilenceOptions {
  readonly thresholdDb?: number;
  readonly minSilenceMs?: number;
  readonly handleMs?: number;
  readonly windowMs?: number;
}
export interface SilenceCandidate {
  readonly id: string;
  readonly kind: 'silence';
  readonly clipId: string;
  readonly sourceRange: TimeRange;
  readonly evidence: {
    readonly decoderId: string;
    readonly thresholdDb: number;
    readonly windowSamples: number;
  };
}
export interface CandidateReview {
  readonly candidateId: string;
  readonly action: 'keep' | 'exclude';
}
export interface PlanInput {
  readonly id: string;
  readonly name: string;
  readonly clipId: string;
  readonly mediaDuration: MediaTime;
  readonly sourceRange: TimeRange;
  readonly frameRate: FrameRate;
  readonly candidates: readonly SilenceCandidate[];
  readonly reviews: readonly CandidateReview[];
  readonly protectedRanges?: readonly TimeRange[];
  readonly maxOutputFrames?: bigint;
}
export interface RoughCutResult {
  readonly plan: SequencePlan;
  /** Actual exclusions AFTER frame rounding and protecting kept/locked ranges. */
  readonly removedRanges: readonly TimeRange[];
  readonly pendingCandidateIds: readonly string[];
}
