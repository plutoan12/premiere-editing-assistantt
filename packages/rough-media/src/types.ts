export const MEDIA_PROTOCOL = 'pea-rough-media/1';
export const MAX_SECONDS = 120;
export const MAX_WINDOW_SAMPLES = 240000;
export interface Rate { numerator: number; denominator: number; }
export interface MediaDescriptor {
  protocol: typeof MEDIA_PROTOCOL;
  path: string;
  fileIdentity: string;
  providerId: string;
  frameRate: Rate;
  durationFrames: string;
  width: number;
  height: number;
  channels: number;
  sampleRate: 48000;
  sourceSampleRate: number;
  cfr: true;
}
export interface PcmMetadata { startSample: number; sampleCount: number; channels: number; sampleRate: number; fileIdentity: string; }
export interface WindowRequest { media: MediaDescriptor; startSample: number; sampleCount: number; }
export interface PcmResponse { meta: PcmMetadata; data: ArrayBuffer; }
export interface MediaProvider {
  probe(path: string, signal?: AbortSignal): Promise<MediaDescriptor>;
  readWindow(request: WindowRequest, signal?: AbortSignal): Promise<PcmResponse>;
}
export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error('media operation cancelled'), { name: 'AbortError' });
}
export function validateWindow(r: WindowRequest): void {
  if (!r || !r.media || !Number.isSafeInteger(r.startSample) || r.startSample < 0 || !Number.isSafeInteger(r.sampleCount) || r.sampleCount < 1 || r.sampleCount > MAX_WINDOW_SAMPLES) throw new Error('PCM window limit');
  const m = validateDescriptor(r.media);
  const duration = BigInt(m.durationFrames) * BigInt(m.frameRate.denominator) * 48000n / BigInt(m.frameRate.numerator);
  if (BigInt(r.startSample) + BigInt(r.sampleCount) > duration) throw new Error('PCM window outside media');
}
export function validateDescriptor(value: unknown): MediaDescriptor {
  const m = value as MediaDescriptor;
  if (!m || m.protocol !== MEDIA_PROTOCOL || typeof m.path !== 'string' || !m.path.startsWith('/') || /[\x00-\x1f]/.test(m.path) || typeof m.fileIdentity !== 'string' || !m.fileIdentity || typeof m.providerId !== 'string' || !m.providerId || m.cfr !== true) throw new Error('invalid media descriptor');
  for (const n of [m.frameRate?.numerator, m.frameRate?.denominator, m.width, m.height, m.channels, m.sourceSampleRate]) if (!Number.isSafeInteger(n) || n < 1) throw new Error('invalid media dimensions/rate');
  if (m.width > 16384 || m.height > 16384 || m.channels > 2 || m.sampleRate !== 48000 || !/^[1-9][0-9]{0,5}$/.test(m.durationFrames)) throw new Error('unsupported media profile');
  const fps = m.frameRate.numerator / m.frameRate.denominator;
  if (fps < 1 || fps > 120 || Number(m.durationFrames) / fps > MAX_SECONDS + 1e-6) throw new Error('media duration/rate limit');
  return m;
}
export function decodePcm(data: ArrayBuffer, meta: PcmMetadata): Float32Array[] {
  if (!meta || !Number.isSafeInteger(meta.channels) || meta.channels < 1 || meta.channels > 2 || meta.sampleRate !== 48000 || !Number.isSafeInteger(meta.sampleCount) || meta.sampleCount < 1 || meta.sampleCount > MAX_WINDOW_SAMPLES || !Number.isSafeInteger(meta.startSample) || meta.startSample < 0 || typeof meta.fileIdentity !== 'string') throw new Error('invalid PCM metadata');
  if (!(data instanceof ArrayBuffer) || data.byteLength !== meta.sampleCount * meta.channels * 4) throw new Error('PCM byte length mismatch');
  const view = new DataView(data);
  const channels = Array.from({ length: meta.channels }, () => new Float32Array(meta.sampleCount));
  for (let i = 0; i < meta.sampleCount; i++) for (let c = 0; c < meta.channels; c++) {
    const x = view.getFloat32((i * meta.channels + c) * 4, true);
    if (!Number.isFinite(x)) throw new Error('PCM samples must be finite');
    channels[c][i] = x;
  }
  return channels;
}
