import { MAX_AUDIO_WINDOW_SAMPLES, validateAudioWindow } from "./audio-provider.js";
import type { AudioSamples } from "./audio-provider.js";
import type { SyncConfidence, SyncReason } from "./types.js";
import { correlationProducts } from "./fft.js";
import { throwIfAborted } from "./validation.js";

export interface CorrelationOptions {
  maxOffsetSamples?: number;
  minOverlapSamples?: number;
  minScore?: number;
  minMargin?: number;
  peakExclusionSamples?: number;
  signal?: AbortSignal;
}
export interface CorrelationResult extends SyncConfidence {
  status: "matched" | "review-required";
  /** Positive means the take window starts later on the reference window's timeline. */
  offsetSamples: number | null;
  polarity: 1 | -1;
  reason?: SyncReason;
}
function settings(options: CorrelationOptions) {
  const config = { maxOffsetSamples: options.maxOffsetSamples ?? 120000, minOverlapSamples: options.minOverlapSamples ?? 64,
    minScore: options.minScore ?? 0.85, minMargin: options.minMargin ?? 0.08, peakExclusionSamples: options.peakExclusionSamples ?? 4 };
  for (const key of ["maxOffsetSamples", "minOverlapSamples", "peakExclusionSamples"] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 0 || config[key] > MAX_AUDIO_WINDOW_SAMPLES) throw new Error(`invalid ${key}`);
  }
  if (config.maxOffsetSamples > 0 && config.peakExclusionSamples >= config.maxOffsetSamples) throw new Error("peak exclusion must be smaller than the search radius");
  if (config.minOverlapSamples < 8) throw new Error("minOverlapSamples must be at least 8");
  for (const key of ["minScore", "minMargin"] as const) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 1) throw new Error(`invalid ${key}`);
  }
  return config;
}
function moments(samples: ArrayLike<number>) {
  const sum = new Float64Array(samples.length + 1), squares = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) { sum[i + 1] = sum[i] + samples[i]; squares[i + 1] = squares[i] + samples[i] ** 2; }
  return { sum, squares };
}
const empty = (reason: SyncReason): CorrelationResult => ({ status: "review-required", reason, offsetSamples: null,
  score: 0, secondBestScore: 0, margin: 0, overlapSamples: 0, polarity: 1 });

/** Bounded FFT search of EVERY configured lag, followed by direct peak refinement. */
export function correlateAudio(reference: AudioSamples, take: AudioSamples, options: CorrelationOptions = {}): CorrelationResult {
  throwIfAborted(options.signal);
  const config = settings(options);
  validateAudioWindow(reference); validateAudioWindow(take);
  if (reference.sampleRate !== take.sampleRate) throw new Error("sample rate mismatch; provider must explicitly resample");
  const x = reference.samples, y = take.samples;
  if (Math.min(x.length, y.length) < config.minOverlapSamples) return empty("insufficient-overlap");
  const low = Math.max(-config.maxOffsetSamples, config.minOverlapSamples - y.length);
  const high = Math.min(config.maxOffsetSamples, x.length - config.minOverlapSamples);
  if (low > high) return empty("insufficient-overlap");
  const mx = moments(x), my = moments(y), products = correlationProducts(x, y);
  throwIfAborted(options.signal);
  type Peak = { lag: number; score: number; polarity: 1 | -1; overlap: number };
  const peaks: Peak[] = [];
  function peakAt(lag: number, direct: boolean): Peak | undefined {
    const start = Math.max(0, lag), end = Math.min(x.length, y.length + lag), count = end - start;
    const ys = start - lag, ye = end - lag;
    const sx = mx.sum[end] - mx.sum[start], sy = my.sum[ye] - my.sum[ys];
    const vx = mx.squares[end] - mx.squares[start] - sx * sx / count;
    const vy = my.squares[ye] - my.squares[ys] - sy * sy / count;
    if (vx <= 1e-12 * count || vy <= 1e-12 * count) return undefined;
    let product = products[y.length - 1 + lag];
    if (direct) { product = 0; for (let i = start; i < end; i++) product += x[i] * y[i - lag]; }
    const signed = (product - sx * sy / count) / Math.sqrt(vx * vy);
    return { lag, score: Math.min(1, Math.abs(signed)), polarity: signed < 0 ? -1 : 1, overlap: count };
  }
  for (let lag = low; lag <= high; lag++) {
    const peak = peakAt(lag, false);
    if (peak) peaks.push(peak);
  }
  if (peaks.length === 0) return empty("silence");
  peaks.sort((a, b) => b.score - a.score || b.overlap - a.overlap || Math.abs(a.lag) - Math.abs(b.lag) || a.lag - b.lag);
  const best = peakAt(peaks[0].lag, true)!;
  const runner = peaks.find(peak => Math.abs(peak.lag - best.lag) > config.peakExclusionSamples);
  const secondBestScore = runner ? peakAt(runner.lag, true)!.score : 0;
  const margin = Math.max(0, best.score - secondBestScore);
  let reason: SyncReason | undefined;
  if (best.score < config.minScore) reason = "low-confidence";
  else if (margin <= Math.max(1e-9, config.minMargin)) reason = "ambiguous";
  else if (Math.abs(best.lag) === config.maxOffsetSamples
    && ((best.lag === high && high < x.length - config.minOverlapSamples)
      || (best.lag === low && low > config.minOverlapSamples - y.length))) reason = "search-boundary";
  throwIfAborted(options.signal);
  return { status: reason ? "review-required" : "matched", reason, offsetSamples: best.lag,
    score: best.score, secondBestScore, margin, overlapSamples: best.overlap, polarity: best.polarity };
}
