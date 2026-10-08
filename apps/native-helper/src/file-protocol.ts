/** Browser-safe protocol shared by UXP and the separately launched Node helper. */
export const FILE_PROTOCOL = 'pea-file-v1';
export const HELPER_VERSION = '0.2.0';
export const MAX_WIRE_CHARS = 262144;
export const MAX_SAMPLES = 262144;
export const MAX_CLIPS = 16;
export type FileOperation = 'ping' | 'probe' | 'sync';
export interface FileSession { protocol: typeof FILE_PROTOCOL; version: string; id: string; token: string }
export interface FileSource { clipId: string; mediaAssetId?: string; path: string; outSeconds: number }
export interface FileSyncInput {
  sources: FileSource[]; referenceClipId: string; mode: 'auto' | 'audio' | 'playback';
  sampleRate: number; startSeconds: number; durationSeconds: number;
}
export interface FileProgress { stage: string; completed: number; total: number }
export class FileProtocolError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'FileProtocolError'; }
}
export function encodeWire(value: unknown): string {
  const text = JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? { $peaBigInt: v.toString() } : v);
  if (typeof text !== 'string' || text.length > MAX_WIRE_CHARS) throw new FileProtocolError('WIRE_TOO_LARGE');
  return text;
}
export function decodeWire(text: string): unknown {
  if (typeof text !== 'string' || text.length > MAX_WIRE_CHARS) throw new FileProtocolError('WIRE_TOO_LARGE');
  return JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '$peaBigInt')) {
      const obj = v as Record<string, unknown>, n = obj.$peaBigInt;
      if (Object.keys(obj).length !== 1 || typeof n !== 'string' || !/^-?\d{1,40}$/.test(n)) throw new FileProtocolError('INVALID_BIGINT');
      return BigInt(n);
    }
    return v;
  });
}
export function validateSession(value: unknown): FileSession {
  const v = value as FileSession;
  if (!v || v.protocol !== FILE_PROTOCOL || v.version !== HELPER_VERSION || !/^[a-f0-9]{32}$/.test(v.id)
    || !/^[a-f0-9]{64}$/.test(v.token)) throw new FileProtocolError('INCOMPATIBLE_SESSION');
  return v;
}
export function validateSources(value: unknown): FileSource[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CLIPS) throw new FileProtocolError('INVALID_SOURCE_COUNT');
  const ids = new Set<string>();
  return value.map((v: FileSource) => {
    if (!v || typeof v.clipId !== 'string' || !v.clipId || v.clipId.length > 200 || ids.has(v.clipId)
      || typeof v.path !== 'string' || !v.path || v.path.length > 8192 || v.path.includes('\0')
      || !Number.isFinite(v.outSeconds) || v.outSeconds <= 0) throw new FileProtocolError('INVALID_SOURCE');
    ids.add(v.clipId);
    return { clipId: v.clipId, mediaAssetId: v.mediaAssetId, path: v.path, outSeconds: v.outSeconds };
  });
}
export function validateSyncInput(value: unknown): FileSyncInput {
  const v = value as FileSyncInput;
  if (!v || !Number.isSafeInteger(v.sampleRate) || v.sampleRate < 8000 || v.sampleRate > 48000
    || !Number.isFinite(v.startSeconds) || v.startSeconds < 0 || !Number.isFinite(v.durationSeconds) || v.durationSeconds <= 0) throw new FileProtocolError('INVALID_WINDOW');
  if (Math.ceil(v.durationSeconds * v.sampleRate) > MAX_SAMPLES) throw new FileProtocolError('WINDOW_TOO_LARGE');
  const sources = validateSources(v.sources);
  if (sources.length < 2 || !sources.some(s => s.clipId === v.referenceClipId)) throw new FileProtocolError('INVALID_REFERENCE');
  if (!['auto', 'audio', 'playback'].includes(v.mode)) throw new FileProtocolError('UNSUPPORTED_SYNC_MODE');
  return { ...v, sources };
}
