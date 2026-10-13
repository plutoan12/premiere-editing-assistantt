import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, chmod, readFile, writeFile, rename, rm, lstat, stat, realpath, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { syncClips } from '@pea/sync';
import { decodeAudioWindow } from './audio-window.js';
import { FILE_PROTOCOL, HELPER_VERSION, MAX_SAMPLES, MAX_WIRE_CHARS, FileProtocolError,
  decodeWire, encodeWire, validateSources, validateSyncInput } from './file-protocol.js';
import type { FileSession, FileSource, FileProgress } from './file-protocol.js';

export interface FileHelperOptions { sessionRoot: string; ffmpegPath?: string; ffprobePath?: string; pollMs?: number }
export interface FileHelper { directory: string; close(): Promise<void> }
export async function createFileHelper(options: FileHelperOptions): Promise<FileHelper> {
  const pollMs = options.pollMs ?? 150;
  if (!Number.isSafeInteger(pollMs) || pollMs < 5 || pollMs > 5000) throw new FileProtocolError('INVALID_POLL_INTERVAL');
  await mkdir(options.sessionRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(resolve(options.sessionRoot), 'session-'));
  await chmod(directory, 0o700);
  const session: FileSession = { protocol: FILE_PROTOCOL, version: HELPER_VERSION,
    id: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex') };
  await writeFile(join(directory, 'session.json'), encodeWire(session), { mode: 0o600, flag: 'wx' });
  let closed = false, timer: ReturnType<typeof setTimeout> | undefined;
  let active: { id: string; abort: AbortController; promise: Promise<void> } | undefined;
  const seen = new Set<string>();
  async function safeRead(name: string): Promise<unknown> {
    const path = join(directory, name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_WIRE_CHARS * 4) throw new FileProtocolError('INVALID_JOB_FILE');
    return decodeWire(await readFile(path, 'utf8'));
  }
  async function atomic(name: string, value: unknown): Promise<void> {
    const temp = join(directory, `${name}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temp, encodeWire(value), { mode: 0o600, flag: 'wx' });
    await rename(temp, join(directory, name));
  }
  async function versions(sources: FileSource[]): Promise<Record<string, string>> {
    const pairs: Array<[string, string]> = [];
    for (const source of sources) {
      if (!isAbsolute(source.path)) throw new FileProtocolError('ABSOLUTE_LOCAL_PATH_REQUIRED');
      const path = await realpath(source.path), rel = relative(directory, path);
      if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new FileProtocolError('SOURCE_IN_SESSION_FOLDER');
      const info = await stat(path);
      if (!info.isFile()) throw new FileProtocolError('REGULAR_MEDIA_FILE_REQUIRED');
      // This is a change detector, not a content hash or an authenticity claim.
      pairs.push([source.clipId, `stat-v1:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`]);
    }
    return Object.fromEntries(pairs);
  }
  async function execute(jobId: string, request: unknown, abort: AbortController): Promise<void> {
    const prefix = `job-${jobId}`, cacheDir = join(directory, `cache-${jobId}`);
    const progress = (value: FileProgress) => atomic(`${prefix}.status.json`, { sessionId: session.id, jobId, ...value });
    try {
      const r = request as { protocol?: string; sessionId?: string; token?: string; operation?: string; input?: unknown };
      const supplied = Buffer.from(typeof r?.token === 'string' ? r.token : ''), expected = Buffer.from(session.token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new FileProtocolError('UNAUTHORIZED');
      if (r.protocol !== FILE_PROTOCOL || r.sessionId !== session.id) throw new FileProtocolError('INCOMPATIBLE_SESSION');
      let result: unknown;
      if (r.operation === 'ping') result = { protocol: FILE_PROTOCOL, version: HELPER_VERSION, sessionId: session.id };
      else if (r.operation === 'probe') {
        const sources = validateSources((r.input as { sources?: unknown })?.sources);
        result = { sourceVersions: await versions(sources) };
      } else if (r.operation === 'sync') {
        const input = validateSyncInput(r.input), before = await versions(input.sources), pcmHashes: Record<string, string> = {};
        let completed = 0;
        const group = await syncClips(`file-${jobId}`, input.sources.map(s => ({
          clipId: s.clipId, mediaAssetId: s.mediaAssetId, hasAudio: true,
        })), { referenceClipId: input.referenceClipId, audioOnly: true, signal: abort.signal,
          audioProvider: { id: 'pea-file-helper', version: HELPER_VERSION, async read(clip, context) {
            const source = input.sources.find(s => s.clipId === clip.clipId)!;
            const duration = Math.min(input.durationSeconds, source.outSeconds - input.startSeconds);
            if (duration <= 0) throw new FileProtocolError('WINDOW_OUTSIDE_SOURCE');
            await progress({ stage: 'decoding', completed, total: input.sources.length });
            const artifact = await decodeAudioWindow(source.path, { cacheDir, sampleRate: input.sampleRate,
              startSeconds: input.startSeconds, durationSeconds: duration, maxSamples: MAX_SAMPLES,
              ffmpegPath: options.ffmpegPath, ffprobePath: options.ffprobePath, signal: context?.signal });
            const bytes = await readFile(artifact.path), samples = new Float32Array(bytes.length / 4);
            for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
            pcmHashes[clip.clipId] = artifact.sha256; completed++;
            await progress({ stage: 'matching', completed, total: input.sources.length });
            return { samples, sampleRate: artifact.sampleRate, startSample: artifact.startSample };
          } },
        });
        if (abort.signal.aborted) throw new FileProtocolError('CANCELLED');
        if (JSON.stringify(before) !== JSON.stringify(await versions(input.sources))) throw new FileProtocolError('SOURCE_CHANGED');
        // Do not send process stderr or local file paths back to the panel.
        group.candidates = group.candidates.map(c => c.reason === 'PROVIDER_ERROR' ? { ...c, evidence: ['DECODE_FAILED'] } : c);
        result = { group, sourceVersions: before, pcmHashes, version: HELPER_VERSION,
          policy: { sampleRate: input.sampleRate, startSeconds: input.startSeconds, durationSeconds: input.durationSeconds,
            mode: input.mode, alignment: 'audio-window-only', driftCorrection: false } };
      } else throw new FileProtocolError('UNSUPPORTED_OPERATION');
      if (abort.signal.aborted) throw new FileProtocolError('CANCELLED');
      await atomic(`${prefix}.result.json`, { sessionId: session.id, jobId, ok: true, result });
    } catch (error) {
      const code = abort.signal.aborted ? 'CANCELLED' : error instanceof FileProtocolError ? error.code : 'HELPER_OPERATION_FAILED';
      await atomic(`${prefix}.result.json`, { sessionId: session.id, jobId, ok: false, error: code });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await Promise.all(['ready', 'request.json', 'cancel'].map(s => rm(join(directory, `${prefix}.${s}`), { force: true })));
    }
  }
  async function tick(): Promise<void> {
    if (closed) return;
    try {
      const names = await readdir(directory);
      if (active && names.includes(`job-${active.id}.cancel`)) active.abort.abort();
      if (!active) {
        const ready = names.filter(n => /^job-[a-z0-9-]{8,100}\.ready$/.test(n)).sort();
        const name = ready.find(n => !seen.has(n));
        if (name) {
          if (seen.size >= 1000) { await rm(join(directory, name), { force: true }); return; }
          seen.add(name);
          const jobId = name.slice(4, -6), abort = new AbortController();
          if (names.includes(`job-${jobId}.cancel`)) abort.abort();
          const work = (async () => {
            let request: unknown;
            try { request = await safeRead(`job-${jobId}.request.json`); }
            catch { await atomic(`job-${jobId}.result.json`, {sessionId:session.id,jobId,ok:false,error:'INVALID_JOB_FILE'});return; }
            await execute(jobId, request, abort);
          })();
          active = { id: jobId, abort, promise: work };
          void work.catch(() => { /* Session I/O failure is surfaced by client timeout. */ }).finally(() => { active = undefined; });
        }
      }
    } finally { if (!closed) timer = setTimeout(() => { void tick().catch(() => {}); }, pollMs); }
  }
  timer = setTimeout(() => { void tick().catch(() => {}); }, pollMs);
  return { directory, async close() {
    closed = true; if (timer) clearTimeout(timer); active?.abort.abort();
    if (active) await active.promise.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  } };
}
