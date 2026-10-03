import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { aborted } from './types.js';

/** Binary-safe companion to the existing transcription text runner. Never runs a shell. */
export function runBounded(executable: string, args: string[], signal?: AbortSignal, maxBytes = 8 * 1024 * 1024, timeoutMs = 120000): Promise<Buffer> {
  aborted(signal);
  if (!isAbsolute(executable) || executable.includes('\0') || args.some(a => typeof a !== 'string' || a.includes('\0'))) throw new Error('invalid native command');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output: Buffer[] = []; let count = 0, error: Error | undefined, done = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: Error) => {
      if (error || done) return; error = e; child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const abort = () => fail(Object.assign(new Error('media operation cancelled'), { name: 'AbortError' }));
    const timer = setTimeout(() => fail(Object.assign(new Error('media process deadline exceeded'), { name: 'TimeoutError' })), timeoutMs);
    const finish = (e?: Error) => {
      if (done) return; done = true; clearTimeout(timer); if (escalation) clearTimeout(escalation);
      signal?.removeEventListener('abort', abort); if (e) reject(e); else resolve(Buffer.concat(output));
    };
    child.stdout.on('data', (b: Buffer) => { if (error) return; count += b.length; if (count > maxBytes) fail(new Error('media output limit')); else output.push(b); });
    // Bound stderr too, but do not expose source paths or diagnostic dumps to the panel.
    child.stderr.on('data', (b: Buffer) => { count += b.length; if (count > maxBytes) fail(new Error('media output limit')); });
    child.once('error', () => finish(error ?? new Error('media executable unavailable')));
    child.once('close', code => finish(error ?? (code === 0 ? undefined : new Error(`media process failed (${code})`))));
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}
