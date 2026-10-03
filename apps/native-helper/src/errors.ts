/** Codes/messages are safe for the local protocol; raw tool stderr stays internal. */
export class HelperError extends Error {
  constructor(readonly code: string, message: string, readonly status = 500) {
    super(message);
    this.name = 'HelperError';
  }
}
export function abortError(): Error {
  return Object.assign(new Error('Operation cancelled'), {name: 'AbortError', code: 'CANCELLED'});
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
export function publicError(error: unknown): {code: string; message: string; status: number} {
  if (error instanceof HelperError) return {code: error.code, message: error.message, status: error.status};
  if (error instanceof Error && error.name === 'AbortError') return {code: 'CANCELLED', message: 'Operation cancelled', status: 409};
  return {code: 'HELPER_ERROR', message: 'The local operation failed', status: 500};
}
