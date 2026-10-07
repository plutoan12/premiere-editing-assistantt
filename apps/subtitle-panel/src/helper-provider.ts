import type { MediaTime, Transcript } from "@pea/core";
import type { createHelperClient } from "@pea/helper-protocol";
import { observeTranscriptTask, throwIfTranscriptAborted, type TranscriptProvider } from "@pea/transcript";

type HelperClient = Pick<ReturnType<typeof createHelperClient>, "submitTranscription" | "getJob" | "cancelJob">;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid helper object");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("invalid helper identity or message");
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("invalid helper positive integer");
  return value;
}

function mediaTime(value: unknown, duration = false): MediaTime {
  const time = object(value), base = object(time.timebase);
  // JSON numbers may already have lost precision before this boundary sees them.
  if (typeof time.ticks !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(time.ticks)) throw new Error("helper ticks must be non-negative decimal strings");
  const ticks = BigInt(time.ticks);
  if (duration && ticks === 0n) throw new Error("helper segment duration must be positive");
  return { ticks, timebase: { numerator: positiveInteger(base.numerator), denominator: positiveInteger(base.denominator) } };
}

export function deserializeHelperTranscript(value: unknown, expectedMediaAssetId: string): Transcript {
  text(expectedMediaAssetId);
  const source = object(value), id = text(source.id), ids = new Set<string>();
  if (!Array.isArray(source.segments)) throw new Error("invalid helper transcript segments");
  return { id, segments: source.segments.map(value => {
    const segment = object(value), segmentId = text(segment.id), range = object(segment.range);
    if (ids.has(segmentId)) throw new Error("duplicate helper segment identity");
    ids.add(segmentId);
    if (segment.mediaAssetId !== expectedMediaAssetId) throw new Error("helper segment media asset mismatch");
    if (typeof segment.text !== "string") throw new Error("invalid helper segment text");
    return {
      id: segmentId, mediaAssetId: expectedMediaAssetId, text: segment.text,
      range: { start: mediaTime(range.start), duration: mediaTime(range.duration, true) },
      ...(segment.speakerId === undefined ? {} : { speakerId: text(segment.speakerId) })
    };
  }) };
}

function jobIdentity(value: unknown): string {
  const id = text(value);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid helper job identity");
  return id;
}

function abortError(): Error {
  const error = new Error("helper transcription cancelled"); error.name = "AbortError"; return error;
}

function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  throwIfTranscriptAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** UXP-safe client boundary. Native processing stays in the separately running helper. */
export function createHelperTranscriptProvider(client: HelperClient, options: { pollIntervalMs?: number; timeoutMs?: number } = {}): TranscriptProvider {
  const pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 250);
  const timeoutMs = positiveInteger(options.timeoutMs ?? 1800000);
  if (pollIntervalMs > 2147483647 || timeoutMs > 2147483647) throw new Error("helper timer exceeds supported duration");

  return { kind: "whisper-cpp", async transcribe(input) {
    throwIfTranscriptAborted(input.signal);
    text(input.mediaAssetId); text(input.mediaPath);
    const controller = new AbortController();
    let stopped = false, terminal = false, cancellationSent = false;
    let jobId: string | undefined;
    const cancelKnownJob = () => {
      if (!jobId || cancellationSent || terminal) return;
      cancellationSent = true;
      // Cancellation is best effort and must not delay or replace the original failure.
      try { void client.cancelJob(jobId).catch(() => undefined); } catch { /* Synchronous transport failure. */ }
    };
    const checkActive = () => {
      if (stopped || input.signal?.aborted) { cancelKnownJob(); throw abortError(); }
    };

    const work = async () => {
      const submission = object(await client.submitTranscription({ mediaAssetId: input.mediaAssetId, mediaPath: input.mediaPath }));
      jobId = jobIdentity(submission.jobId);
      // A submission can be accepted after its caller has stopped waiting. Keep this
      // continuation alive so its newly known job is cancelled instead of orphaned.
      checkActive();
      while (true) {
        const value: unknown = await client.getJob(jobId);
        checkActive();
        const job = object(value);
        if (jobIdentity(job.id) !== jobId) throw new Error("helper job identity mismatch");
        if (typeof job.progress !== "number" || !Number.isFinite(job.progress) || job.progress < 0 || job.progress > 1) throw new Error("invalid helper job progress");
        switch (job.status) {
          case "completed": {
            terminal = true;
            const result = deserializeHelperTranscript(object(job.result).transcript, input.mediaAssetId);
            checkActive();
            return result;
          }
          case "failed":
            terminal = true;
            throw new Error(text(object(job.error).message));
          case "cancelled":
            terminal = true;
            throw abortError();
          case "queued":
          case "running":
            await waitForPoll(pollIntervalMs, controller.signal);
            checkActive();
            break;
          default:
            throw new Error("invalid helper job status");
        }
      }
    };
    try {
      return await observeTranscriptTask(work, input.signal, timeoutMs);
    } catch (error) {
      stopped = true;
      controller.abort();
      cancelKnownJob();
      throw error;
    } finally {
      stopped = true;
      controller.abort();
    }
  } };
}
