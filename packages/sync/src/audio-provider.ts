export const MAX_AUDIO_WINDOW_SAMPLES = 262144;
export interface AudioSamples {
  /** Mono normalized PCM in [-1, 1]. No mutation or resampling occurs in the engine. */
  samples: ArrayLike<number>;
  sampleRate: number;
  /** Position of samples[0] in the original clip, at this sample rate. */
  startSample: number;
}
export interface AudioSampleRequest { maxSamples: number; signal?: AbortSignal }
export interface AudioSampleProvider {
  getSamples(clipId: string, request: AudioSampleRequest): Promise<AudioSamples>;
}
export function validateAudioWindow(window: AudioSamples): void {
  if (!window || !Number.isSafeInteger(window.sampleRate) || window.sampleRate <= 0) throw new Error("invalid sample rate");
  if (!Number.isSafeInteger(window.startSample) || window.startSample < 0) throw new Error("invalid window startSample");
  if (!window.samples || !Number.isSafeInteger(window.samples.length) || window.samples.length < 0
    || window.samples.length > MAX_AUDIO_WINDOW_SAMPLES) throw new Error("audio window exceeds sample limit");
  if (!Number.isSafeInteger(window.startSample + window.samples.length)) throw new Error("audio window end exceeds safe integer limit");
  for (let i = 0; i < window.samples.length; i++) {
    const value = window.samples[i];
    if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error("audio samples must be finite normalized mono PCM");
  }
}

/** Decoder adapters may reuse buffers; keep the reference stable across later reads. */
export function snapshotAudioWindow(window: AudioSamples): AudioSamples {
  validateAudioWindow(window);
  return { samples: Float64Array.from(window.samples), sampleRate: window.sampleRate, startSample: window.startSample };
}
