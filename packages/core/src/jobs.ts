/**
 * Job lifecycle: `queued -> running -> completed | failed | cancelled`.
 * Terminal states have no outgoing transitions. A retry never re-opens a Job;
 * `createRetry` returns a new queued Job that points back via `retryOf`.
 * Partial success is carried by optional per-item `results` on a completed Job.
 *
 * `attempt` counts from 0 for the first run (kept for compatibility with the
 * media organizer catalog); a retry is attempt + 1.
 */
import { z } from "zod";

export const JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

const ItemIdSchema = z.string().min(1);
export const JobItemResultSchema = z.discriminatedUnion("status", [
  z.object({ itemId: ItemIdSchema, status: z.literal("succeeded") }).strict(),
  z.object({ itemId: ItemIdSchema, status: z.literal("failed"), reason: z.string().min(1) }).strict(),
  z.object({ itemId: ItemIdSchema, status: z.literal("skipped"), reason: z.string().min(1) }).strict(),
]);
export type JobItemResult = z.infer<typeof JobItemResultSchema>;

export const JobSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    status: JobStatusSchema,
    attempt: z.number().int().nonnegative().default(0),
    error: z.string().optional(),
    /** Id of the failed or cancelled Job this one retries. */
    retryOf: z.string().min(1).optional(),
    createdAt: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
    /** Per-item outcomes; the way a completed Job reports partial success. */
    results: z.array(JobItemResultSchema).optional(),
  })
  .refine((j) => j.status !== "completed" || j.error === undefined, "a completed job must not carry an error")
  .refine((j) => j.status !== "queued" || (j.results === undefined || j.results.length === 0), "a queued job has no results yet");
export type Job = z.infer<typeof JobSchema>;

const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const canTransitionJob = (from: JobStatus, to: JobStatus): boolean => TRANSITIONS[from].includes(to);
export const isTerminalJobStatus = (status: JobStatus): boolean => TRANSITIONS[status].length === 0;

export class IllegalJobTransition extends Error {
  override readonly name = "IllegalJobTransition";
}

/** Returns a copy of `job` in state `to`; throws on an illegal transition. Never mutates `job`. */
export function transitionJob(job: Job, to: JobStatus, now?: () => Date): Job {
  if (!canTransitionJob(job.status, to)) {
    throw new IllegalJobTransition(`job ${job.id}: ${job.status} -> ${to} is not a legal transition`);
  }
  const next: Job = { ...job, status: to };
  if (now !== undefined) {
    const stamp = now().toISOString();
    if (to === "running") next.startedAt = stamp;
    if (isTerminalJobStatus(to)) next.finishedAt = stamp;
  }
  return next;
}

/** A retry is a brand-new queued Job; the failed or cancelled original stays untouched. */
export function createRetry(job: Job, id: string, now?: () => Date): Job {
  if (job.status !== "failed" && job.status !== "cancelled") {
    throw new IllegalJobTransition(`job ${job.id}: only a failed or cancelled job can be retried (status is ${job.status})`);
  }
  if (id.length === 0 || id === job.id) {
    throw new IllegalJobTransition(`job ${job.id}: a retry needs a new, distinct id`);
  }
  const retry: Job = { id, kind: job.kind, status: "queued", attempt: job.attempt + 1, retryOf: job.id };
  if (now !== undefined) retry.createdAt = now().toISOString();
  return retry;
}
