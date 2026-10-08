import { FILE_PROTOCOL, HELPER_VERSION, FileProtocolError, encodeWire, decodeWire, validateSession } from '@pea/native-helper/file-protocol';
import type { FileOperation, FileProgress } from '@pea/native-helper/file-protocol';
export interface UxpFile { isFile?: boolean; read(): Promise<unknown>; write(data: string): Promise<unknown>; delete(): Promise<unknown> }
export interface UxpFolder { getEntry(name: string): Promise<UxpFile>; createFile(name: string, options: { overwrite: boolean }): Promise<UxpFile> }
export interface FileRequestOptions { timeoutMs?: number; signal?: AbortSignal; onProgress?: (progress: FileProgress) => void }
export interface FileHelperClient { request(operation: FileOperation, input: unknown, options?: FileRequestOptions): Promise<unknown> }
export interface FileClientOptions { pollMs?: number; timeoutMs?: number }
let counter = 0;
function aborted(): Error { return Object.assign(new Error('CANCELLED'), { name: 'AbortError' }); }
export async function connectFileHelper(folder: UxpFolder, config: FileClientOptions = {}): Promise<FileHelperClient> {
  const pollMs = config.pollMs ?? 150, timeoutMs = config.timeoutMs ?? 120000;
  if (!Number.isFinite(pollMs) || pollMs < 5 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new FileProtocolError('INVALID_CLIENT_CONFIG');
  const session = validateSession(decodeWire(String(await (await folder.getEntry('session.json')).read())));
  async function readOptional(name: string): Promise<unknown | undefined> {
    let entry: UxpFile;
    try { entry = await folder.getEntry(name); } catch { return undefined; }
    if (entry.isFile === false) throw new FileProtocolError('INVALID_RESPONSE_FILE');
    return decodeWire(String(await entry.read()));
  }
  async function write(name: string, text: string): Promise<void> {
    const file = await folder.createFile(name, { overwrite: false }); await file.write(text);
  }
  const client: FileHelperClient = { async request(operation, input, options = {}) {
    if (options.signal?.aborted) throw aborted();
    const deadline = Math.min(timeoutMs, options.timeoutMs ?? timeoutMs);
    if (!Number.isFinite(deadline) || deadline < 1) throw new FileProtocolError('INVALID_TIMEOUT');
    const jobId = `${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    const prefix = `job-${jobId}`, started = Date.now();
    await write(`${prefix}.request.json`, encodeWire({ protocol: FILE_PROTOCOL, sessionId: session.id, token: session.token, operation, input }));
    await write(`${prefix}.ready`, 'ready');
    let terminal = false;
    try {
      while (true) {
        if (options.signal?.aborted || Date.now() - started > deadline) {
          try { await write(`${prefix}.cancel`, 'cancel'); } catch { /* Existing cancel marker is sufficient. */ }
          if (options.signal?.aborted) throw aborted();
          throw new FileProtocolError('HELPER_TIMEOUT');
        }
        const result = await readOptional(`${prefix}.result.json`) as { sessionId: string; jobId: string; ok: boolean; error?: string; result?: unknown } | undefined;
        if (result) {
          terminal = true;
          if (result.sessionId !== session.id || result.jobId !== jobId || typeof result.ok !== 'boolean') throw new FileProtocolError('INVALID_RESPONSE');
          if (!result.ok) { if (result.error === 'CANCELLED') throw aborted(); throw new FileProtocolError(result.error ?? 'HELPER_FAILED'); }
          return result.result;
        }
        if (options.onProgress) {
          const progress = await readOptional(`${prefix}.status.json`) as FileProgress & {sessionId:string;jobId:string} | undefined;
          if (progress?.sessionId === session.id && progress.jobId === jobId) options.onProgress({stage:progress.stage,completed:progress.completed,total:progress.total});
        }
        await new Promise<void>(resolve => setTimeout(resolve, pollMs));
      }
    } finally {
      // A pending request must survive cancellation long enough for the helper to see it.
      if (terminal) for (const suffix of ['result.json', 'status.json', 'ready', 'request.json', 'cancel']) {
        try { await (await folder.getEntry(`${prefix}.${suffix}`)).delete(); } catch { /* Helper may already own cleanup. */ }
      }
    }
  } };
  const ping = await client.request('ping', {}, {timeoutMs:Math.min(timeoutMs,5000)}) as {protocol?:string;version?:string;sessionId?:string};
  if (ping.protocol !== FILE_PROTOCOL || ping.version !== HELPER_VERSION || ping.sessionId !== session.id) throw new FileProtocolError('INCOMPATIBLE_HELPER');
  return client;
}
/** Defensive copy preserves exact bigint media time across the UI/helper boundary. */
export function copyWire<T>(value:T):T { return decodeWire(encodeWire(value)) as T; }
