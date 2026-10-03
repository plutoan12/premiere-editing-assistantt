import type { FrameRate, MediaTime, Rational } from "@pea/core";
export type { FrameRate, MediaTime, Rational };
export type SyncStrategy = "timecode" | "audio" | "manual";
export type SyncReason = "missing-timecode" | "incompatible-timecode" | "no-audio-provider"
  | "silence" | "insufficient-overlap" | "low-confidence" | "ambiguous"
  | "search-boundary" | "provider-error" | "invalid-audio";
export interface SyncEvidence {
  clipId: string;
  sourceId?: string;
  cameraId?: string;
  role?: "camera" | "recorder" | "playback";
  timecodeTicks?: bigint;
  /** Seconds per tick. Required together with frameRate for timecode matching. */
  timebase?: Rational;
  frameRate?: FrameRate;
  /** Caller-supplied date/clock/session identity; never infer a midnight rollover. */
  timecodeDomain?: string;
  durationTicks?: bigint;
  audioFingerprint?: string;
}
export interface SyncConfidence {
  /** Heuristic normalized correlation score, NOT a probability of correctness. */
  score: number;
  secondBestScore: number;
  margin: number;
  overlapSamples: number;
}
export interface SyncProvenance {
  clipId: string;
  method: "timecode" | "audio-correlation" | "audio-reference";
  referenceClipId?: string;
  timecodeTicks?: bigint;
  timebase: Rational;
  frameRate?: FrameRate;
  timecodeDomain?: string;
  windowStartSample?: number;
  referenceWindowStartSample?: number;
  lagSamples?: number;
  confidence?: SyncConfidence;
}
export interface SyncMember {
  clipId: string;
  sourceId?: string;
  cameraId?: string;
  role?: SyncEvidence["role"];
  /** Convenience alias; the exact unit is also carried by offset.timebase. */
  offsetTicks: bigint;
  offset: MediaTime;
}
export interface SyncGroup {
  id: string;
  strategy: "timecode" | "audio";
  confidence: number;
  referenceClipId: string;
  timebase: Rational;
  members: SyncMember[];
  provenance: SyncProvenance[];
}
export interface SyncCandidate {
  clipId: string;
  referenceClipId: string;
  status: "matched" | "review-required";
  offset?: MediaTime;
  confidence?: SyncConfidence;
  reason?: SyncReason;
  detail?: string;
}
export type SyncResult = {
  status: "synced";
  group: SyncGroup;
  candidates: SyncCandidate[];
  reasons: SyncReason[];
} | {
  status: "review-required";
  group?: undefined;
  candidates: SyncCandidate[];
  reasons: SyncReason[];
};
