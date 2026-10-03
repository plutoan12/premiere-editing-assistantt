import type { Transcript } from "@pea/core";
import type { TranscriptProvider, TranscriptSourceKind } from "./types.js";

export class TranscriptUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "TranscriptUnavailableError"; }
}

export function throwIfTranscriptAborted(signal?: AbortSignal): void {
  if (signal?.aborted) { const error = new Error("transcription cancelled"); error.name = "AbortError"; throw error; }
}

/** Stops waiting and removes listeners. It cannot stop work inside an uncooperative host API. */
export function observeTranscriptTask<T>(work: () => Promise<T>, signal?: AbortSignal, timeoutMs = 1800000): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) return Promise.reject(new Error("invalid transcript timeout"));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (succeeded: boolean, value: unknown) => {
      if (settled) return;
      settled = true; if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (succeeded) resolve(value as T); else reject(value);
    };
    const abort = () => { const error = new Error("transcription cancelled"); error.name = "AbortError"; finish(false, error); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { const error = new Error("transcript provider timed out"); error.name = "TimeoutError"; finish(false, error); }, timeoutMs);
    try { work().then(value => finish(true, value), error => finish(false, error)); } catch (error) { finish(false, error); }
  });
}

/** Falls back only on explicit absence. Corruption, cancellation and host errors are not absence. */
export async function transcribePreferExisting(
  input: Parameters<TranscriptProvider["transcribe"]>[0],
  existing: TranscriptProvider,
  fallback?: TranscriptProvider
): Promise<{ transcript: Transcript; source: TranscriptSourceKind }> {
  try {
    const transcript = await observeTranscriptTask(() => existing.transcribe(input), input.signal);
    return { transcript, source: existing.kind };
  } catch (error) {
    throwIfTranscriptAborted(input.signal);
    if (!(error instanceof TranscriptUnavailableError) || !fallback) throw error;
    return { transcript: await observeTranscriptTask(() => fallback.transcribe(input), input.signal), source: fallback.kind };
  }
}
