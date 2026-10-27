import { describe, expect, it } from "vitest";
import { newEntityId } from "./ids.js";
import {
  IllegalJobTransition,
  JOB_STATUSES,
  JobSchema,
  JobStatusSchema,
  canTransitionJob,
  createJob,
  createRetry,
  isTerminalJobStatus,
  transitionJob,
  type Job,
  type JobStatus,
} from "./jobs.js";

const clock = (iso: string) => () => new Date(iso);
const t0 = clock("2026-10-27T10:00:00.000Z");
const t1 = clock("2026-10-27T10:00:01.000Z");
const t2 = clock("2026-10-27T10:00:02.000Z");

function queued(): Job {
  return createJob({ projectId: newEntityId(), kind: "stt.transcribe" }, t0);
}

describe("JobStatus", () => {
  it("has exactly the five spec states; partial success is not a status", () => {
    expect([...JOB_STATUSES]).toEqual(["queued", "running", "completed", "failed", "cancelled"]);
    expect(JobStatusSchema.safeParse("partial").success).toBe(false);
    expect(JobStatusSchema.safeParse("partially_completed").success).toBe(false);
  });

  it("allows exactly the legal transitions and nothing else", () => {
    const legal = new Set(["queued>running", "queued>cancelled", "running>completed", "running>failed", "running>cancelled"]);
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        expect(canTransitionJob(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  it("treats completed, failed and cancelled as terminal with no outgoing transitions", () => {
    for (const s of ["completed", "failed", "cancelled"] as const satisfies readonly JobStatus[]) {
      expect(isTerminalJobStatus(s)).toBe(true);
      for (const to of JOB_STATUSES) expect(canTransitionJob(s, to)).toBe(false);
    }
    expect(isTerminalJobStatus("queued")).toBe(false);
    expect(isTerminalJobStatus("running")).toBe(false);
  });
});

describe("Job lifecycle", () => {
  it("starts queued with attempt 1 and no results", () => {
    const j = queued();
    expect(JobSchema.parse(j)).toEqual(j);
    expect(j.status).toBe("queued");
    expect(j.attempt).toBe(1);
    expect(j.results).toEqual([]);
    expect(j.retryOf).toBeUndefined();
  });

  it("walks queued -> running -> completed and records timestamps", () => {
    const running = transitionJob(queued(), "running", t1);
    expect(running.startedAt).toBe("2026-10-27T10:00:01.000Z");
    const done = transitionJob(running, "completed", t2, { results: [{ itemId: "clip-1", status: "succeeded" }] });
    expect(done.finishedAt).toBe("2026-10-27T10:00:02.000Z");
    expect(JobSchema.parse(done)).toEqual(done);
  });

  it("expresses partial success through per-item results on a completed job", () => {
    const running = transitionJob(queued(), "running", t1);
    const done = transitionJob(running, "completed", t2, {
      results: [
        { itemId: "clip-1", status: "succeeded" },
        { itemId: "clip-2", status: "failed", reason: "no audio track" },
        { itemId: "clip-3", status: "skipped", reason: "already transcribed" },
      ],
    });
    expect(done.status).toBe("completed");
    expect(done.results.map((r) => r.status)).toEqual(["succeeded", "failed", "skipped"]);
    expect(JobSchema.safeParse({ ...done, results: [{ itemId: "x", status: "failed" }] }).success).toBe(false); // reason required
  });

  it("requires an error on failed and forbids one on completed", () => {
    const running = transitionJob(queued(), "running", t1);
    expect(() => transitionJob(running, "failed", t2)).toThrow(/error/);
    const failed = transitionJob(running, "failed", t2, { error: { code: "PROVIDER_TIMEOUT", message: "stt timed out", retryable: true } });
    expect(failed.error?.code).toBe("PROVIDER_TIMEOUT");
    expect(JobSchema.safeParse({ ...failed, status: "completed", finishedAt: failed.finishedAt }).success).toBe(false);
  });

  it("can be cancelled from queued and from running, and never from a terminal state", () => {
    expect(transitionJob(queued(), "cancelled", t1).status).toBe("cancelled");
    const running = transitionJob(queued(), "running", t1);
    expect(transitionJob(running, "cancelled", t2).status).toBe("cancelled");
    const done = transitionJob(running, "completed", t2);
    expect(() => transitionJob(done, "cancelled", t2)).toThrow(IllegalJobTransition);
    expect(() => transitionJob(done, "running", t2)).toThrow(IllegalJobTransition);
    expect(() => transitionJob(queued(), "completed", t1)).toThrow(IllegalJobTransition);
  });

  it("does not mutate the input job", () => {
    const j = queued();
    const snapshot = structuredClone(j);
    transitionJob(j, "running", t1);
    expect(j).toEqual(snapshot);
  });
});

describe("createRetry", () => {
  it("creates a new queued job linked by retryOf with attempt + 1, leaving the original untouched", () => {
    const running = transitionJob(queued(), "running", t1);
    const failed = transitionJob(running, "failed", t2, { error: { code: "E", message: "boom", retryable: true } });
    const snapshot = structuredClone(failed);
    const retry = createRetry(failed, t2);
    expect(retry.id).not.toBe(failed.id);
    expect(retry.status).toBe("queued");
    expect(retry.attempt).toBe(2);
    expect(retry.retryOf).toBe(failed.id);
    expect(retry.results).toEqual([]);
    expect(retry.error).toBeUndefined();
    expect(retry.kind).toBe(failed.kind);
    expect(failed).toEqual(snapshot);
    expect(createRetry(retry.status === "queued" ? transitionJob(transitionJob(retry, "running", t2), "cancelled", t2) : retry, t2).attempt).toBe(3);
  });

  it("refuses to retry a job that is not failed or cancelled", () => {
    expect(() => createRetry(queued(), t1)).toThrow(/failed or cancelled/);
    const done = transitionJob(transitionJob(queued(), "running", t1), "completed", t2);
    expect(() => createRetry(done, t2)).toThrow(/failed or cancelled/);
  });
});
