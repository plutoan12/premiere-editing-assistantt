import {runProcess,type ProcessResult,type RunOptions} from './process-runner.js';
import {LOCAL_MEDIA_FORMATS,resolveMediaPath,validateLocalPath} from './media-path.js';
import {HelperError,throwIfAborted} from './errors.js';
export interface MediaProbe {
  durationSeconds: number | null;
  startSeconds?: number;
  audioStreams: {index?: number; codec?: string; sampleRate?: number; channels?: number; startSeconds?: number}[];
  videoStreams: {index?: number; codec?: string}[];
}
export type Runner = (exe: string, args: readonly string[], options: RunOptions) => Promise<ProcessResult>;
export function buildProbeArgs(path: string): string[] {
  validateLocalPath(path);
  return ['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',LOCAL_MEDIA_FORMATS,
    '-show_format','-show_streams','-of','json','--',path];
}
function object(value: unknown): value is Record<string, unknown> {return !!value && typeof value === 'object' && !Array.isArray(value);}
function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
  const n = Number(value); return Number.isFinite(n) ? n : undefined;
}
export async function probeMedia(path: string, options: {ffprobePath?: string; runner?: Runner; signal?: AbortSignal; timeoutMs?: number} = {}): Promise<MediaProbe> {
  throwIfAborted(options.signal);
  const local = await resolveMediaPath(path);
  throwIfAborted(options.signal);
  const result = await (options.runner ?? runProcess)(options.ffprobePath ?? 'ffprobe', buildProbeArgs(local),
    {signal: options.signal, timeoutMs: options.timeoutMs ?? 10000, maxStdoutBytes: 2 * 1024 * 1024});
  if (result.code !== 0) throw new HelperError('MEDIA_PROBE_FAILED', 'ffprobe could not read this media format', 422);
  let raw: unknown;
  try {raw = JSON.parse(result.stdout.toString('utf8'));} catch {throw new HelperError('INVALID_METADATA', 'Invalid ffprobe JSON', 422);}
  if (!object(raw) || !Array.isArray(raw.streams) || !raw.streams.every(object)) throw new HelperError('INVALID_METADATA', 'Invalid ffprobe metadata', 422);
  const format = object(raw.format) ? raw.format : {};
  const duration = numeric(format.duration);
  const streams = raw.streams as Record<string, unknown>[];
  return {
    durationSeconds: duration !== undefined && duration >= 0 ? duration : null,
    startSeconds: numeric(format.start_time),
    audioStreams: streams.filter(s => s.codec_type === 'audio').map(s => ({
      index: numeric(s.index), codec: typeof s.codec_name === 'string' ? s.codec_name : undefined,
      sampleRate: numeric(s.sample_rate), channels: numeric(s.channels), startSeconds: numeric(s.start_time)
    })),
    videoStreams: streams.filter(s => s.codec_type === 'video').map(s => ({index: numeric(s.index), codec: typeof s.codec_name === 'string' ? s.codec_name : undefined}))
  };
}
