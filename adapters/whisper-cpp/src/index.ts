import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Transcript } from "@pea/core";
import { throwIfTranscriptAborted } from "@pea/transcript";
import type { TranscriptProvider } from "@pea/transcript";

function namedError(name: string, message: string): Error { const error = new Error(message); error.name = name; return error; }
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${name}`);
  return value;
}
function localPath(path: string): void {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) throw new Error("an absolute local path is required");
}

/** No shell, bounded logs/deadline, cancellation waits for process closure before temp cleanup. */
export function runNativeProcess(executable: string, args: string[], options: { signal?: AbortSignal; timeoutMs: number; maxOutputBytes?: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    localPath(executable); positive(options.timeoutMs, "process timeout");
    if (options.timeoutMs > 2147483647) throw new Error("process timeout is too large");
    const maxBytes = positive(options.maxOutputBytes ?? 1048576, "process output limit");
    if (args.some(a => typeof a !== "string" || a.includes("\0"))) throw new Error("invalid process argument");
    throwIfTranscriptAborted(options.signal);
    const grouped = process.platform !== "win32";
    const child = spawn(executable, args, { shell: false, windowsHide: true, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, failure: Error | undefined, settled = false, escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. The close/error event still completes the promise. */ }
    };
    const stop = (error: Error) => {
      if (failure || settled) return;
      failure = error; kill("SIGTERM"); escalation = setTimeout(() => kill("SIGKILL"), 500);
    };
    const abort = () => stop(namedError("AbortError", "native transcription cancelled"));
    const timer = setTimeout(() => stop(namedError("TimeoutError", "native process timed out")), options.timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); if (escalation) clearTimeout(escalation); options.signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > maxBytes) stop(namedError("OutputLimitError", "native process output exceeded limit")); else target.push(chunk);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", () => finish(failure ?? namedError("NativeProcessError", "native executable could not start")));
    child.once("close", (code, signal) => finish(failure ?? (code === 0 ? undefined : namedError("NativeProcessError", `native process exited with ${code ?? signal}`))));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

/** whisper-cli JSON offsets are already milliseconds. No diarization/word alignment is inferred. */
export function parseWhisperCppJSON(json: string, mediaAssetId: string): Transcript {
  if (typeof mediaAssetId !== "string" || !mediaAssetId.trim()) throw new Error("media asset identity is required");
  const root: unknown = JSON.parse(json);
  if (!root || typeof root !== "object" || !Array.isArray((root as { transcription?: unknown }).transcription)) throw new Error("invalid whisper.cpp JSON");
  const segments = (root as { transcription: unknown[] }).transcription.map((value, i) => {
    if (!value || typeof value !== "object") throw new Error("invalid whisper.cpp segment");
    const s = value as { offsets?: { from?: unknown; to?: unknown }; text?: unknown };
    const from = s.offsets?.from, to = s.offsets?.to;
    if (typeof from !== "number" || typeof to !== "number" || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || typeof s.text !== "string") throw new Error("invalid whisper.cpp offsets or text");
    const mt = (ticks: bigint) => ({ ticks, timebase: { numerator: 1, denominator: 1000 } });
    return { id: `whisper-cpp:${mediaAssetId}:segment:${i + 1}`, mediaAssetId, range: { start: mt(BigInt(from)), duration: mt(BigInt(to) - BigInt(from)) }, text: s.text };
  });
  return { id: `whisper-cpp:${mediaAssetId}`, segments };
}

export interface WhisperCppOptions {
  ffmpegPath: string;
  whisperPath: string;
  modelPath: string;
  language?: string;
  tempRoot?: string;
  timeoutMs?: number;
  maxJSONBytes?: number;
  maxAudioBytes?: number;
}

export function createWhisperCppProvider(options: WhisperCppOptions): TranscriptProvider {
  const language = options.language ?? "auto", timeout = positive(options.timeoutMs ?? 1800000, "transcription timeout");
  const maxJSON = positive(options.maxJSONBytes ?? 16 * 1024 * 1024, "JSON limit");
  const maxAudio = positive(options.maxAudioBytes ?? 512 * 1024 * 1024, "audio limit");
  if (timeout > 2147483647 || !/^(?:auto|[a-z]{2,3})$/.test(language)) throw new Error("invalid whisper.cpp configuration");
  [options.ffmpegPath, options.whisperPath, options.modelPath, options.tempRoot ?? tmpdir()].forEach(localPath);
  const file = async (path: string, executable = false) => {
    localPath(path); const resolved = await realpath(path);
    if (!(await stat(resolved)).isFile()) throw new Error("local input must be a regular file");
    await access(resolved, executable ? constants.X_OK : constants.R_OK); return resolved;
  };
  return { kind: "whisper-cpp", async transcribe(input) {
    throwIfTranscriptAborted(input.signal);
    if (!input.mediaAssetId?.trim()) throw new Error("media asset identity is required");
    const deadline = performance.now() + timeout;
    const [media, ffmpeg, whisper, model] = await Promise.all([file(input.mediaPath), file(options.ffmpegPath, true), file(options.whisperPath, true), file(options.modelPath)]);
    const tempRoot = await realpath(options.tempRoot ?? tmpdir());
    if (!(await stat(tempRoot)).isDirectory()) throw new Error("temporary root must be a directory");
    throwIfTranscriptAborted(input.signal);
    const work = await mkdtemp(join(tempRoot, "pea-transcript-"));
    const run = (exe: string, args: string[]) => {
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) throw namedError("TimeoutError", "transcription deadline elapsed");
      return runNativeProcess(exe, args, { signal: input.signal, timeoutMs: remaining });
    };
    try {
      const wav = join(work, "audio.wav"), output = join(work, "transcript");
      // First audio stream only. No remote protocols, source overwrites, translation, or auto-download.
      await run(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-i", media, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", wav]);
      const audioInfo = await lstat(wav);
      if (!audioInfo.isFile() || audioInfo.size < 1 || audioInfo.size > maxAudio) throw new Error("decoded audio size exceeds configured limit");
      await run(whisper, ["-m", model, "-f", wav, "-l", language, "-oj", "-of", output, "-np"]);
      throwIfTranscriptAborted(input.signal);
      const path = `${output}.json`, info = await lstat(path);
      if (!info.isFile() || info.size < 1 || info.size > maxJSON) throw new Error("whisper.cpp JSON size is invalid");
      const json = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
      throwIfTranscriptAborted(input.signal);
      return parseWhisperCppJSON(json, input.mediaAssetId);
    } finally { await rm(work, { recursive: true, force: true, maxRetries: 2 }); }
  } };
}
