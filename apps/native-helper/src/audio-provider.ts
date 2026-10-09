import type {ProviderContext} from '@pea/core';
import type {AudioSampleProvider,AudioSampleWindow,SyncEvidence} from '@pea/sync';
import {MAX_ANALYSIS_SAMPLES} from '@pea/sync';
import {runProcess} from './process-runner.js';
import {probeMedia,type Runner} from './ffmpeg.js';
import {LOCAL_MEDIA_FORMATS,resolveMediaPath,validateLocalPath} from './media-path.js';
import {HelperError,throwIfAborted} from './errors.js';

export interface AudioWindowRequest {startSample: bigint; maxSamples: number; signal?: AbortSignal}
export function validateWindowRequest(rate: number, request: AudioWindowRequest): void {
  if (!Number.isSafeInteger(rate) || rate < 1 || rate > 384000) throw new HelperError('INVALID_WINDOW', 'Invalid sample rate', 400);
  if (!Number.isSafeInteger(request.maxSamples) || request.maxSamples < 1 || request.maxSamples > MAX_ANALYSIS_SAMPLES) {
    throw new HelperError('INVALID_WINDOW', 'Invalid max sample count', 400);
  }
  if (typeof request.startSample !== 'bigint' || request.startSample < 0n || request.startSample > BigInt(Number.MAX_SAFE_INTEGER) - BigInt(request.maxSamples)) {
    throw new HelperError('INVALID_WINDOW', 'Invalid start sample', 400);
  }
}
export function buildAudioArgs(path: string, sampleRate: number, startSample: bigint, maxSamples: number): string[] {
  validateLocalPath(path);
  validateWindowRequest(sampleRate, {startSample,maxSamples});
  // Count samples AFTER a reproducible resample/downmix from decoded origin. Input -ss resets filter state.
  const filter = `aresample=${sampleRate}:async=0,aformat=sample_fmts=flt:channel_layouts=mono,atrim=start_sample=${startSample}:end_sample=${startSample + BigInt(maxSamples)},asetpts=PTS-STARTPTS`;
  return ['-v','error','-nostdin','-protocol_whitelist','file,pipe','-format_whitelist',LOCAL_MEDIA_FORMATS,
    '-threads','1','-i',path,'-map','0:a:0','-vn','-sn','-dn','-af',filter,
    '-ac','1','-ar',String(sampleRate),'-c:a','pcm_f32le','-f','f32le','pipe:1'];
}
export class FfmpegAudioSampleProvider implements AudioSampleProvider {
  readonly id = 'ffmpeg-local';
  readonly version = '2';
  constructor(private readonly options: {
    resolvePath: (clip: SyncEvidence) => string; runner?: Runner; ffmpegPath?: string; ffprobePath?: string;
    sampleRate?: number; timeoutMs?: number;
  }) {}
  async read(clip: SyncEvidence, ctx?: ProviderContext): Promise<AudioSampleWindow> {
    return this.readWindow(clip, {startSample: 0n, maxSamples: MAX_ANALYSIS_SAMPLES, signal: ctx?.signal});
  }
  async readWindow(clip: SyncEvidence, request: AudioWindowRequest): Promise<AudioSampleWindow> {
    throwIfAborted(request.signal);
    const sampleRate = this.options.sampleRate ?? 8000;
    validateWindowRequest(sampleRate, request);
    const path = await resolveMediaPath(this.options.resolvePath(clip));
    const meta = await probeMedia(path, {ffprobePath: this.options.ffprobePath, runner: this.options.runner, signal: request.signal});
    if (!meta.audioStreams.length) throw new HelperError('NO_AUDIO', 'This media has no audio stream', 422);
    const origin = (meta.audioStreams[0].startSeconds ?? meta.startSeconds ?? 0) - (meta.startSeconds ?? 0);
    if (Math.abs(origin) > 1e-9) throw new HelperError('AUDIO_ORIGIN_UNSUPPORTED', 'Nonzero audio stream origin needs explicit timeline mapping', 422);
    throwIfAborted(request.signal);
    const result = await (this.options.runner ?? runProcess)(this.options.ffmpegPath ?? 'ffmpeg',
      buildAudioArgs(path, sampleRate, request.startSample, request.maxSamples),
      {signal: request.signal, timeoutMs: this.options.timeoutMs ?? 30000, maxStdoutBytes: request.maxSamples * 4});
    throwIfAborted(request.signal);
    if (result.code !== 0) throw new HelperError('MEDIA_DECODE_FAILED', 'FFmpeg could not decode the audio window', 422);
    if (!result.stdout.length) throw new HelperError('EMPTY_AUDIO', 'The audio window is empty or beyond the end of the file', 422);
    if (result.stdout.length % 4 || result.stdout.length / 4 > request.maxSamples) throw new HelperError('INVALID_PCM', 'Invalid PCM output size', 422);
    const samples = new Float32Array(result.stdout.length / 4);
    for (let i = 0; i < samples.length; i++) {
      const value = result.stdout.readFloatLE(i * 4);
      if (!Number.isFinite(value) || Math.abs(value) > 1) throw new HelperError('INVALID_PCM', 'Invalid normalized PCM', 422);
      samples[i] = value;
    }
    return {samples, sampleRate, startSample: request.startSample};
  }
}
