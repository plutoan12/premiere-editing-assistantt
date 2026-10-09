import { ArtifactSchema, JobSchema, MediaAssetSchema, TimeRangeSchema, canTransitionJob, promoteArtifact, type Artifact, type Job, type JobStatus, type MediaAsset, type TimeRange } from "@pea/core";
import { z } from "zod";
import { LoudnessMeasurementSchema, type LoudnessMeasurement } from "./loudness.js";
import { positiveInteger, timeToSamples, validateRange } from "./time.js";

export interface AudioSource { media: MediaAsset; range: TimeRange; sampleRate: number; channelCount: number; channelLayout?: string[] }
interface RequestBase { jobId: string; artifactId: string; artifactVersion: number; attempt: number; source: AudioSource }
export type AudioJobRequest = RequestBase & (
  | { operation: "cleanup"; settings: { strength: number } }
  | { operation: "loudness"; settings: Record<string, never> }
);
export interface CleanupOutput { uri: string; sampleRate: number; channelCount: number; channelLayout?: string[]; sampleCount: bigint; residualLatencySamples: bigint }
export interface CandidateContext { artifactId: string; artifactVersion: number }
export interface AudioProvider {
  id: string; version: string;
  cleanup?(source: AudioSource, settings: { strength: number }, signal: AbortSignal, candidate: CandidateContext): Promise<CleanupOutput>;
  measureLoudness?(source: AudioSource, signal: AbortSignal): Promise<LoudnessMeasurement>;
}
export interface AudioArtifact {
  schemaVersion: "1.0.0"; engineVersion: "1.0.0"; descriptor: Artifact; cacheKey: string;
  source: AudioSource; provider: { id: string; version: string }; operation: "cleanup" | "loudness";
  payload: CleanupOutput | LoudnessMeasurement;
}
export type AudioJobCode = "INVALID_REQUEST" | "UNSUPPORTED_CAPABILITY" | "INVALID_RESULT" | "PROVIDER_FAILED" | "CANCELLED" | "STALE_RESULT";
export interface AudioJobResult { job: Job; history: JobStatus[]; artifact?: AudioArtifact; code?: AudioJobCode; cacheHit: boolean }
export interface AudioJobOptions { signal?: AbortSignal; previous?: AudioArtifact; cache?: AudioCache; isCurrent: () => boolean }

/** In-memory snapshots only; a persistent adapter must additionally check derivative existence. */
export class AudioCache {
  private readonly entries = new Map<string, unknown>();
  get(key: string): unknown { const value = this.entries.get(key); return value === undefined ? undefined : structuredClone(value); }
  set(key: string, value: unknown): void { this.entries.set(key, structuredClone(value)); }
  delete(key: string): void { this.entries.delete(key); }
}

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const channelLayoutSchema = z.array(z.string().min(1)).min(1);
const sourceSchema = z.object({ media: MediaAssetSchema, range: TimeRangeSchema, sampleRate: positive, channelCount: positive, channelLayout: channelLayoutSchema.optional() }).strict();
const baseSchema = z.object({ jobId: z.string().min(1), artifactId: z.string().min(1), artifactVersion: positive, attempt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), source: sourceSchema });
const requestSchema = z.discriminatedUnion("operation", [
  baseSchema.extend({ operation: z.literal("cleanup"), settings: z.object({ strength: z.number().finite().min(0).max(1) }).strict() }).strict(),
  baseSchema.extend({ operation: z.literal("loudness"), settings: z.object({}).strict() }).strict(),
]);
const cleanupSchema = z.object({ uri: z.string().min(1), sampleRate: positive, channelCount: positive, channelLayout: channelLayoutSchema.optional(), sampleCount: z.bigint().positive(), residualLatencySamples: z.literal(0n) }).strict();

function validateLayout(layout: string[] | undefined, count: number): void {
  if (layout && (layout.length !== count || new Set(layout).size !== layout.length)) throw new Error("channel layout must contain one unique label per channel");
}

/** Conservative local-file alias check; deliberately not a filesystem/symlink resolver. */
function localUriIdentity(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost") || url.search || url.hash) throw new Error("expected an absolute local file URI without query or fragment");
  const parts: string[] = [];
  for (const part of decodeURIComponent(url.pathname).replace(/\\/g, "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length || parts.some(part => part.includes("\0"))) throw new Error("invalid media file URI");
  return parts.join("/").normalize("NFC").toLowerCase();
}

function validateRequest(request: AudioJobRequest): AudioJobRequest {
  const parsed = requestSchema.parse(request);
  validateRange(parsed.source.range);
  timeToSamples(parsed.source.range.start, parsed.source.sampleRate);
  timeToSamples(parsed.source.range.duration, parsed.source.sampleRate);
  localUriIdentity(parsed.source.media.uri);
  validateLayout(parsed.source.channelLayout, parsed.source.channelCount);
  if (parsed.source.media.frameRate) {
    positiveInteger(parsed.source.media.frameRate.rate.numerator, "frame-rate numerator");
    positiveInteger(parsed.source.media.frameRate.rate.denominator, "frame-rate denominator");
  }
  return parsed;
}

function cacheKey(request: AudioJobRequest, provider: { id: string; version: string }): string {
  const time = (value: TimeRange["start"]) => [value.ticks.toString(), value.timebase.numerator, value.timebase.denominator];
  const { media, range, sampleRate, channelCount, channelLayout } = request.source;
  return JSON.stringify(["audio", "1.0.0", "1.0.0", request.operation, media.id, media.uri, media.fingerprint.algorithm, media.fingerprint.value, media.frameRate ?? null, time(range.start), time(range.duration), sampleRate, channelCount, channelLayout ?? null, request.operation === "cleanup" ? request.settings.strength : null, provider.id, provider.version]);
}

function validateOutput(output: unknown, request: AudioJobRequest): CleanupOutput | LoudnessMeasurement {
  if (request.operation === "loudness") return LoudnessMeasurementSchema.parse(output);
  const parsed = cleanupSchema.parse(output);
  validateLayout(parsed.channelLayout, parsed.channelCount);
  if (request.source.channelLayout && JSON.stringify(parsed.channelLayout) !== JSON.stringify(request.source.channelLayout)) throw new Error("cleanup output channel layout differs from the source");
  if (localUriIdentity(parsed.uri) === localUriIdentity(request.source.media.uri)) throw new Error("cleanup output must not alias source media");
  if (parsed.sampleRate !== request.source.sampleRate || parsed.channelCount !== request.source.channelCount || parsed.sampleCount !== timeToSamples(request.source.range.duration, request.source.sampleRate)) throw new Error("cleanup output format or duration differs from the requested source range");
  return parsed;
}

class Cancelled extends Error {}
async function interruptible<T>(operation: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  outer?.addEventListener("abort", forward, { once: true });
  let rejectOnAbort: () => void = () => {};
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(new Cancelled("audio job cancelled"));
      controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    if (outer?.aborted) controller.abort();
    const work = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Cancelled("audio job cancelled");
      return operation(controller.signal);
    });
    return await Promise.race([work, aborted]);
  } finally {
    outer?.removeEventListener("abort", forward);
    controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}

/** Each job is one media/capability unit; callers can retain other units on partial failure. */
export async function runAudioJob(input: AudioJobRequest, provider: AudioProvider | undefined, options: AudioJobOptions): Promise<AudioJobResult> {
  const job: Job = { id: input.jobId, kind: `audio.${input.operation}`, status: "queued", attempt: input.attempt };
  const history: JobStatus[] = ["queued"];
  const previous = options.previous;
  const move = (status: JobStatus) => {
    if (!canTransitionJob(job.status, status)) throw new Error(`invalid audio job transition ${job.status} -> ${status}`);
    job.status = status; history.push(status);
  };
  const fail = (code: AudioJobCode, message: string): AudioJobResult => {
    move(code === "CANCELLED" ? "cancelled" : "failed");
    job.error = message;
    return { job, history, artifact: previous, cacheHit: false, code };
  };
  if (options.signal?.aborted) return fail("CANCELLED", "audio job cancelled before execution");
  move("running");
  let request: AudioJobRequest;
  try {
    request = validateRequest(structuredClone(input));
    JobSchema.parse(job);
    if (previous) {
      ArtifactSchema.parse(previous.descriptor);
      if (previous.schemaVersion !== "1.0.0" || previous.descriptor.status !== "valid" || previous.descriptor.id === request.artifactId) throw new Error("retry requires a valid previous artifact and a new candidate id");
    }
  } catch (error) { return fail("INVALID_REQUEST", message(error)); }
  if (!provider || typeof provider.id !== "string" || !provider.id || typeof provider.version !== "string" || !provider.version || (request.operation === "cleanup" ? typeof provider.cleanup !== "function" : typeof provider.measureLoudness !== "function")) return fail("UNSUPPORTED_CAPABILITY", `no ${request.operation} capability is configured`);
  const identity = { id: provider.id, version: provider.version };
  const key = cacheKey(request, identity);
  let payload: CleanupOutput | LoudnessMeasurement | undefined;
  let cacheHit = false;
  try {
    if (options.isCurrent() !== true) return fail("STALE_RESULT", "source or selection revision is no longer current");
    const cached = options.cache?.get(key);
    if (cached !== undefined) {
      try { payload = validateOutput(cached, request); cacheHit = true; }
      catch { options.cache?.delete(key); }
    }
    if (!payload) {
      const source = structuredClone(request.source);
      let output: unknown;
      if (request.operation === "cleanup") {
        const cleanup = provider.cleanup!.bind(provider);
        const settings = { ...request.settings };
        output = await interruptible(signal => cleanup(source, settings, signal, { artifactId: request.artifactId, artifactVersion: request.artifactVersion }), options.signal);
      } else {
        const measure = provider.measureLoudness!.bind(provider);
        output = await interruptible(signal => measure(source, signal), options.signal);
      }
      try {
        payload = validateOutput(output, request);
        if (request.operation === "cleanup" && previous?.descriptor.uri && localUriIdentity((payload as CleanupOutput).uri) === localUriIdentity(previous.descriptor.uri)) throw new Error("new cleanup output must not replace the previous valid derivative");
      } catch (error) { return fail("INVALID_RESULT", message(error)); }
    }
    if (options.signal?.aborted) return fail("CANCELLED", "audio job cancelled before promotion");
    if (options.isCurrent() !== true) return fail("STALE_RESULT", "source or selection changed before promotion");
    const descriptor: Artifact = { id: request.artifactId, kind: `audio.${request.operation}`, version: request.artifactVersion, status: "valid", ...(request.operation === "cleanup" ? { uri: (payload as CleanupOutput).uri } : {}) };
    ArtifactSchema.parse(descriptor);
    const artifact: AudioArtifact = { schemaVersion: "1.0.0", engineVersion: "1.0.0", descriptor, cacheKey: key, source: structuredClone(request.source), provider: identity, operation: request.operation, payload: structuredClone(payload) };
    if (promoteArtifact(descriptor, previous?.descriptor) !== descriptor) throw new Error("candidate artifact was not valid for promotion");
    options.cache?.set(key, payload);
    move("completed");
    return { job, history, artifact, cacheHit };
  } catch (error) {
    return fail(error instanceof Cancelled || options.signal?.aborted ? "CANCELLED" : "PROVIDER_FAILED", message(error));
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
