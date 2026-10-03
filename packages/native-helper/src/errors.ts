export class HelperError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message); this.name = 'HelperError';
  }
}
export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Operation cancelled', 'AbortError');
}
export function publicError(error: unknown): {code: string; message: string; status: number} {
  if (error instanceof HelperError) return {code:error.code,message:error.message,status:error.status};
  if (error instanceof Error && error.name === 'AbortError') return {code:'CANCELLED',message:'Operation cancelled',status:409};
  return {code:'INTERNAL_ERROR',message:'The operation failed; retry or check the local installation.',status:500};
}
