import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep, extname } from 'node:path';
import { runBounded } from './process.js';
import { MEDIA_PROTOCOL, MAX_SECONDS, aborted, validateDescriptor, validateWindow, type MediaDescriptor, type MediaProvider } from './types.js';

export function parseProbe(root: any, frames: any[], path: string, fileIdentity: string): MediaDescriptor {
  const streams = root?.streams;
  if (!Array.isArray(streams) || !Array.isArray(frames)) throw new Error('invalid media probe');
  const vs = streams.filter(s => s.codec_type === 'video'), as = streams.filter(s => s.codec_type === 'audio');
  if (vs.length !== 1 || as.length !== 1) throw new Error('one video and one audio stream required');
  const v = vs[0], a = as[0];
  if (![1, 2].includes(a.channels) || !Number.isFinite(Number(a.sample_rate))) throw new Error('mono/stereo audio required');
  if (Math.abs(Number(v.start_time ?? NaN)) > 1e-7 || Math.abs(Number(a.start_time ?? NaN)) > 1e-7 || !Number.isFinite(Number(v.start_time)) || !Number.isFinite(Number(a.start_time))) throw new Error('nonzero/unknown audio-video origin unsupported');
  if (v.field_order !== 'progressive' && !frames.every(f => f.interlaced_frame === 0)) throw new Error('interlaced/unknown media unsupported');
  if (v.sample_aspect_ratio !== '1:1' && v.sample_aspect_ratio !== undefined) throw new Error('non-square pixel media unsupported');
  if ((v.side_data_list ?? []).some((s: any) => s.rotation !== undefined && Number(s.rotation) !== 0) || Number(v.tags?.rotate ?? 0) !== 0) throw new Error('rotated media unsupported');
  const parts = String(v.r_frame_rate).split('/').map(Number), tb = String(v.time_base).split('/').map(Number);
  if (parts.length !== 2 || tb.length !== 2 || [...parts, ...tb].some(x => !Number.isSafeInteger(x) || x <= 0)) throw new Error('invalid frame clock');
  const [numerator, denominator] = parts, step = denominator / numerator / (tb[0] / tb[1]);
  const pts = frames.map(f => Number(f.best_effort_timestamp)).sort((x, y) => x - y);
  if (!pts.length || pts.some(x => !Number.isSafeInteger(x)) || pts[0] !== 0 || pts.some((p, i) => Math.abs(p - i * step) > 1.01)) throw new Error('full timestamp scan is not CFR');
  const seconds = pts.length * denominator / numerator;
  if (seconds > MAX_SECONDS || !Number.isFinite(Number(root.format?.duration)) || Math.abs(Number(root.format.duration) - seconds) > .05 || !Number.isFinite(Number(a.duration)) || Math.abs(Number(a.duration) - seconds) > .05) throw new Error('media duration limit/mismatch');
  return validateDescriptor({ protocol: MEDIA_PROTOCOL, path, fileIdentity, providerId: 'ffmpeg-cfr-v1', frameRate: { numerator, denominator }, durationFrames: String(pts.length), width: v.width, height: v.height, channels: a.channels, sampleRate: 48000, sourceSampleRate: Number(a.sample_rate), cfr: true });
}
export interface FFmpegOptions { ffmpegPath: string; ffprobePath: string; allowedRoots: readonly string[]; }
export function createFFmpegMediaProvider(options: FFmpegOptions): MediaProvider {
  if (!options.allowedRoots.length) throw new Error('at least one allowed media root is required');
  async function identity(path: string, signal?: AbortSignal): Promise<{ path: string; id: string }> {
    aborted(signal);
    if (!isAbsolute(path) || /[\x00-\x1f]/.test(path) || !['.mov', '.mp4'].includes(extname(path).toLowerCase())) throw new Error('local MOV/MP4 source required');
    const actual = await realpath(path), roots = await Promise.all(options.allowedRoots.map(p => realpath(p)));
    if (!roots.some(root => { const rel = relative(root, actual); return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); })) throw new Error('source outside allowed media root');
    const s = await stat(actual, { bigint: true });
    if (!s.isFile() || s.size <= 0n || s.size > 2n * 1024n ** 3n) throw new Error('source file size limit');
    return { path: actual, id: `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}` };
  }
  const json = async (args: string[], signal?: AbortSignal) => JSON.parse((await runBounded(options.ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file,pipe', ...args, '-of', 'json'], signal)).toString('utf8'));
  return {
    async probe(path, signal) {
      const source = await identity(path, signal);
      const root = await json(['-show_streams', '-show_format', source.path], signal);
      if (!Number.isFinite(Number(root.format?.duration)) || Number(root.format.duration) > MAX_SECONDS) throw new Error('media duration limit');
      const scan = await json(['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp,interlaced_frame', source.path], signal);
      const media = parseProbe(root, scan.frames, source.path, source.id);
      // Audio timestamps must be continuous too: decoding gaps is not evidence of silence.
      const audio = await json(['-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,nb_samples', source.path], signal);
      let cursor = 0;
      if (!Array.isArray(audio.frames) || !audio.frames.length) throw new Error('missing audio frames');
      for (const frame of audio.frames) {
        const p = Number(frame.best_effort_timestamp_time), n = Number(frame.nb_samples);
        if (!Number.isFinite(p) || !Number.isSafeInteger(n) || n < 1 || Math.abs(p - cursor / media.sourceSampleRate) > 2 / media.sourceSampleRate) throw new Error('audio timestamp gap unsupported');
        cursor += n;
      }
      if ((await identity(path, signal)).id !== source.id) throw new Error('media changed during probe');
      return media;
    },
    async readWindow(request, signal) {
      validateWindow(request); const m = request.media;
      const source = await identity(m.path, signal);
      if (source.id !== m.fileIdentity) throw new Error('media changed since analysis');
      const bytes = request.sampleCount * m.channels * 4;
      const data = await runBounded(options.ffmpegPath, ['-nostdin', '-hide_banner', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', source.path, '-map', '0:a:0', '-vn', '-af', `aresample=48000,atrim=start_sample=${request.startSample}:end_sample=${request.startSample + request.sampleCount}`, '-ac', String(m.channels), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], signal, bytes + 65536);
      if (data.length !== bytes) throw new Error('decoded PCM length mismatch');
      if ((await identity(m.path, signal)).id !== m.fileIdentity) throw new Error('media changed during decode');
      return { meta: { startSample: request.startSample, sampleCount: request.sampleCount, channels: m.channels, sampleRate: 48000, fileIdentity: source.id }, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
    },
  };
}
