import { spawn } from 'node:child_process';
import { aborted, HelperError } from './errors.js';
export interface ProcessOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Trusted read-only regular-file descriptor owned by the media service. */
  inputFd?: number;
}
/** Never invoke a shell. Resolve only after the child exits and its pipes close. */
export async function runProcess(executable: string, args: readonly string[], options: ProcessOptions): Promise<Buffer> {
  aborted(options.signal);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 120000
    || !Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1 || options.maxOutputBytes > 8*1024*1024) {
    throw new HelperError('INVALID_LIMIT','Invalid process limits');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {shell:false,windowsHide:true,
      stdio: options.inputFd === undefined ? ['ignore','pipe','pipe'] : ['ignore','pipe','pipe',options.inputFd]});
    const chunks: Buffer[] = []; let bytes = 0;
    let failure: Error | undefined, killTimer: NodeJS.Timeout | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error; child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250);
      killTimer.unref();
    };
    const cancel = () => stop(new DOMException('Operation cancelled','AbortError'));
    const timer = setTimeout(() => stop(new HelperError('PROCESS_TIMEOUT','Media process timed out',504)), options.timeoutMs);
    options.signal?.addEventListener('abort',cancel,{once:true});
    if (options.signal?.aborted) cancel();
    child.stdout!.on('data',(chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes) stop(new HelperError('OUTPUT_LIMIT','Process output exceeds the permitted limit',413));
      else chunks.push(chunk);
    });
    // Drain stderr without accumulating it or returning potentially private paths/tags.
    child.stderr!.on('data',()=>{});
    child.once('error',(error: NodeJS.ErrnoException) => {
      failure ??= new HelperError(error.code === 'ENOENT' ? 'EXECUTABLE_MISSING' : 'PROCESS_FAILED',
        error.code === 'ENOENT' ? 'Required executable was not found' : 'Media process could not run',503);
    });
    child.once('close',(code) => {
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort',cancel);
      if (failure) reject(failure);
      else if (code !== 0) reject(new HelperError('PROCESS_FAILED','Media process returned an error',422));
      else resolve(Buffer.concat(chunks,bytes));
    });
  });
}
