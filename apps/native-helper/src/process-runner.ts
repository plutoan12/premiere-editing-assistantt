import {spawn} from 'node:child_process';
import {abortError, HelperError, throwIfAborted} from './errors.js';

export interface ProcessResult {code: number; stdout: Buffer; stderr: Buffer}
export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes?: number;
}
function byteLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 16 * 1024 * 1024;
}
/** Reject only after close: cancellation must not leave a child running behind the caller. */
export async function runProcess(executable: string, args: readonly string[], options: RunOptions): Promise<ProcessResult> {
  throwIfAborted(options.signal);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2147483647) {
    throw new HelperError('INVALID_CONFIG', 'Invalid process timeout', 400);
  }
  const maxStderr = options.maxStderrBytes ?? 262144;
  if (!byteLimit(options.maxStdoutBytes) || !byteLimit(maxStderr)) throw new HelperError('INVALID_CONFIG', 'Invalid output limit', 400);
  if (!executable || executable.includes('\0') || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new HelperError('INVALID_CONFIG', 'Invalid process arguments', 400);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let outBytes = 0, errBytes = 0, failure: Error | undefined;
    const stop = (error: Error) => {failure ??= error; child.kill('SIGKILL');};
    const abort = () => stop(abortError());
    const timer = setTimeout(() => stop(new HelperError('PROCESS_TIMEOUT', 'Process timeout', 504)), options.timeoutMs);
    child.once('error', () => {failure ??= new HelperError('PROCESS_START_FAILED', 'Could not start the configured executable', 503);});
    child.stdout.on('data', (data: Buffer) => {
      if (failure) return;
      outBytes += data.length;
      if (outBytes > options.maxStdoutBytes) return stop(new HelperError('OUTPUT_LIMIT', 'Process stdout limit exceeded', 422));
      stdout.push(data);
    });
    child.stderr.on('data', (data: Buffer) => {
      if (failure) return;
      errBytes += data.length;
      if (errBytes > maxStderr) return stop(new HelperError('OUTPUT_LIMIT', 'Process stderr limit exceeded', 422));
      stderr.push(data);
    });
    child.once('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({code: code ?? -1, stdout: Buffer.concat(stdout, outBytes), stderr: Buffer.concat(stderr, errBytes)});
    });
    options.signal?.addEventListener('abort', abort, {once: true});
    if (options.signal?.aborted) abort();
  });
}
