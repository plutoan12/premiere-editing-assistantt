import type { MediaTime } from "@pea/core";
import { type PcmInput, validatePcm } from "./pcm.js";
import { positiveInteger, sampleTime } from "./time.js";

export interface BeatOptions { hopSamples?: number; minBpm?: number; maxBpm?: number; relativeThreshold?: number; minimumAmplitude?: number }
export interface BeatAnalysis { schemaVersion: "1.0.0"; mediaAssetId: string; status: "ok" | "silence" | "insufficient" | "irregular"; onsets: MediaTime[]; bpm: number | null; periodicity: number | null; resolutionSamples: number }

/** Conservative energy-onset detector. Periodicity is a heuristic, not probability. */
export function detectBeats(input: PcmInput, options: BeatOptions = {}): BeatAnalysis {
  const length = validatePcm(input);
  const hop = options.hopSamples ?? Math.max(1, Math.round(input.sampleRate / 100));
  const minBpm = options.minBpm ?? 40, maxBpm = options.maxBpm ?? 240;
  const relative = options.relativeThreshold ?? 0.25, floor = options.minimumAmplitude ?? 0.001;
  positiveInteger(hop, "hop samples");
  if (![minBpm, maxBpm, relative, floor].every(Number.isFinite) || minBpm <= 0 || maxBpm < minBpm || relative <= 0 || relative > 1 || floor <= 0) throw new Error("invalid beat detector configuration");
  const energy: number[] = [];
  let peak = 0;
  for (let start = 0; start < length; start += hop) {
    const end = Math.min(length, start + hop);
    let sum = 0;
    for (const channel of input.channels) for (let i = start; i < end; i++) sum += channel[i] * channel[i];
    const rms = Math.sqrt(sum / ((end - start) * input.channels.length));
    peak = Math.max(peak, rms);
    energy.push(rms);
  }
  const base = { schemaVersion: "1.0.0" as const, mediaAssetId: input.mediaAssetId, resolutionSamples: hop };
  if (peak < floor) return { ...base, status: "silence", onsets: [], bpm: null, periodicity: null };
  const threshold = Math.max(floor, peak * relative);
  const positions: number[] = [];
  for (let i = 0; i < energy.length; i++) {
    if (energy[i] >= threshold && (i === 0 || energy[i - 1] < threshold)) positions.push(i * hop);
  }
  const onsets = positions.map(p => sampleTime(input.startSample + BigInt(p), input.sampleRate));
  if (positions.length < 4) return { ...base, status: "insufficient", onsets, bpm: null, periodicity: null };
  const intervals = positions.slice(1).map((p, i) => p - positions[i]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const deviation = intervals.reduce((worst, i) => Math.max(worst, Math.abs(i - median) / median), 0);
  const bpm = 60 * input.sampleRate / median;
  const periodicity = Math.max(0, 1 - deviation);
  if (deviation > 0.2 || bpm < minBpm || bpm > maxBpm) return { ...base, status: "irregular", onsets, bpm: null, periodicity };
  return { ...base, status: "ok", onsets, bpm, periodicity };
}
