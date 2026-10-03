import { detectSilenceCandidates, type SilenceOptions } from '@pea/rough-cut';
import { aborted, decodePcm, validateDescriptor, MAX_WINDOW_SAMPLES, type MediaProvider } from '@pea/rough-media/wire';
/** Five-second PCM windows become a 100 Hz all-channel silence mask; long PCM never accumulates in UXP. */
export async function analyzeMedia(provider: MediaProvider, path: string, clipId: string, input: { signal?: AbortSignal; onProgress?: (value: number) => void; options?: SilenceOptions } = {}) {
  aborted(input.signal); const media = validateDescriptor(await provider.probe(path, input.signal));
  if (!clipId || media.path !== path) throw new Error('source identity/path mismatch');
  const options = input.options ?? {}, db = options.thresholdDb ?? -42;
  if (!Number.isFinite(db) || db > 0 || db < -120 || (options.windowMs !== undefined && options.windowMs !== 10)) throw new Error('unsupported analysis threshold/window');
  const total = Number(BigInt(media.durationFrames) * BigInt(media.frameRate.denominator) * 48000n / BigInt(media.frameRate.numerator));
  const mask = new Float32Array(Math.ceil(total / 480)), power = Math.pow(10, db / 10);
  for (let startSample = 0; startSample < total; startSample += MAX_WINDOW_SAMPLES) {
    aborted(input.signal); const sampleCount = Math.min(MAX_WINDOW_SAMPLES, total - startSample);
    const w = await provider.readWindow({ media, startSample, sampleCount }, input.signal), m = w.meta;
    if (m.startSample !== startSample || m.sampleCount !== sampleCount || m.channels !== media.channels || m.fileIdentity !== media.fileIdentity) throw new Error('PCM metadata mismatch');
    const channels = decodePcm(w.data, m);
    for (let first = 0; first < sampleCount; first += 480) {
      let quiet = first + 480 <= sampleCount;
      for (const channel of channels) { let sum = 0; for (let i = first; i < Math.min(first + 480, sampleCount); i++) sum += channel[i] * channel[i]; if (sum / 480 > power) quiet = false; }
      mask[(startSample + first) / 480] = quiet ? 0 : 2;
    }
    input.onProgress?.((startSample + sampleCount) / total); aborted(input.signal);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const checked = validateDescriptor(await provider.probe(path, input.signal)); aborted(input.signal);
  if (JSON.stringify(checked) !== JSON.stringify(media)) throw new Error('source file changed during analysis');
  const candidates = detectSilenceCandidates({ clipId, decoderId: media.providerId + ':all-channel-10ms-mask', sourceStart: { ticks: 0n, timebase: { numerator: 1, denominator: 100 } }, sampleRate: 100, channels: [mask] }, { ...options, thresholdDb: 0, windowMs: 10 });
  return { media, candidates };
}
