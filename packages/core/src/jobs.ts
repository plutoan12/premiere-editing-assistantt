/**
 * Job lifecycle: `queued -> running -> completed | failed | cancelled`.
 * Terminal states have no outgoing transitions; a retry is a new Job.
 * Partial success is carried by per-item results on a completed Job.
 */
import { z } from "zod";
import { IsoDateTimeSchema, PositiveIntegerSchema, SchemaVersionSchema } from "./common.js";
import { EntityIdSchema, newEntityId, type EntityId } from "./ids.js";
import { CORE_SCHEMA_VERSION } from "./version.js";

export const JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

const ItemIdSchema = z.string().min(1);

export const JobItemResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ itemId: ItemIdSchema, status: z.literal("succeeded") }),
  z.strictObject({ itemId: ItemIdSchema, status: z.literal("failed"), reason: z.string().min(1) }),
  z.strictObject({ itemId: ItemIdSchema, status: z.literal("skipped"), reason: z.string().min(1) }),
]);

export type JobItemResult = z.infer<typeof JobItemResultSchema>;

export const JobErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export type JobError = z.infer<typeof JobErrorSchema>;

export const JobSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: EntityIdSchema,
    projectId: EntityIdSchema,
    /** Engine-owned job kind, e.g. "stt.transcribe", "sync.waveform". */
    kind: z.string().min(1),
    status: JobStatusSchema,
    attempt: PositiveIntegerSchema,
    retryOf: EntityIdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    finishedAt: IsoDateTimeSchema.optional(),
    results: z.array(JobItemResultSchema),
    error: JobErrorSchema.optional(),
  })
  .refine((j) => {
    switch (j.status) {
      case "queued":
        return j.startedAt === undefined && j.finishedAt === undefined && j.error === undefined && j.results.length === 0;
      case "running":
        return j.startedAt !== undefined && j.finishedAt === undefined && j.error === undefined;
      case "completed":
        return j.startedAt !== undefined && j.finishedAt !== undefined && j.error === undefined;
      case "failed":
        return j.finishedAt !== undefined && j.error !== undefined;
      case "cancelled":
        return j.finishedAt !== undefined && j.error === undefined;
    }
  }, "job fields are inconsistent with its status");

export type Job = z.infer<typeof JobSchema>;

export class IllegalJobTransition extends Error {
  override readonly name = "IllegalJobTransition";
}

export interface CreateJobInput {
  readonly projectId: EntityId;
  readonly kind: string;
}

export function createJob(input: CreateJobInput, now: () => Date = () => new Date()): Job {
  return JobSchema.parse({
    schemaVersion: CORE_SCHEMA_VERSION,
    id: newEntityId(),
    projectId: input.projectId,
    kind: input.kind,
    status: "queued",
    attempt: 1,
    createdAt: now().toISOString(),
    results: [],
  });
}

export interface TransitionExtras {
  readonly results?: readonly JobItemResult[];
  readonly error?: JobError;
}

/** Returns a new Job in state `to`; never mutates `job`. */
export function transitionJob(job: Job, to: JobStatus, now: () => Date = () => new Date(), extras: TransitionExtras = {}): Job {
  if (!canTransitionJob(job.status, to)) {
    throw new IllegalJobTransition(`job ${job.id}: ${job.status} -> ${to} is not a legal transition`);
  }
  const stamp = now().toISOString();
  const draft: Record<string, unknown> = { ...job, status: to };
  if (extras.results !== undefined) draft["results"] = [...extras.results];
  switch (to) {
    case "running":
      draft["startedAt"] = stamp;
      break;
    case "completed":
      if (extras.error !== undefined) {
        throw new IllegalJobTransition(`job ${job.id}: a completed job must not carry an error`);
      }
      draft["finishedAt"] = stamp;
      break;
    case "failed":
      if (extras.error === undefined) {
        throw new IllegalJobTransition(`job ${job.id}: transition to failed requires an error`);
      }
      draft["finishedAt"] = stamp;
      draft["error"] = extras.error;
      break;
    case "cancelled":
      draft["finishedAt"] = stamp;
      break;
    case "queued":
      break;
  }
  return JobSchema.parse(draft);
}

/** A retry is a brand-new queued Job that points back at the one it retries. */
export function createRetry(job: Job, now: () => Date = () => new Date()): Job {
  if (job.status !== "failed" && job.status !== "cancelled") {
    throw new IllegalJobTransition(`job ${job.id}: only a failed or cancelled job can be retried (status is ${job.status})`);
  }
  return JobSchema.parse({
    schemaVersion: CORE_SCHEMA_VERSION,
    id: newEntityId(),
    projectId: job.projectId,
    kind: job.kind,
    status: "queued",
    attempt: job.attempt + 1,
    retryOf: job.id,
    createdAt: now().toISOString(),
    results: [],
  });
}
