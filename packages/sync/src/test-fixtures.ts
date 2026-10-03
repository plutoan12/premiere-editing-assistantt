import type { AudioSampleProvider, AudioSamples, SyncEvidence } from "./index.js";

export function tc(clipId: string, ticks: bigint, extra: Partial<SyncEvidence> = {}): SyncEvidence {
  return { clipId, timecodeTicks: ticks, timebase: { numerator: 1, denominator: 24 },
    frameRate: { rate: { numerator: 24, denominator: 1 }, dropFrame: false }, ...extra };
}
export function noise(length: number, seed = 123): Float64Array {
  let state = seed;
  return Float64Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 4294967296 - 0.5) * 1.6;
  });
}
export function audio(samples: ArrayLike<number>, startSample = 0, sampleRate = 8000): AudioSamples {
  return { samples: Float64Array.from(samples), startSample, sampleRate };
}
export function provider(windows: Record<string, AudioSamples>) {
  const calls: string[] = [];
  const value: AudioSampleProvider = { async getSamples(clipId, request) {
    calls.push(clipId);
    if (request.signal?.aborted) throw request.signal.reason;
    const window = windows[clipId];
    if (!window) throw new Error(`missing audio: ${clipId}`);
    return window;
  } };
  return { value, calls };
}
