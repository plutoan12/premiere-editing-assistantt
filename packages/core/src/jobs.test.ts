import { describe, expect, it } from "vitest";
import { IllegalJobTransition, JOB_STATUSES, JobSchema, canTransitionJob, createRetry, isTerminalJobStatus, transitionJob, type Job } from "./jobs.js";

const queued = (): Job => ({ id: "j1", kind: "media-ingest", status: "queued", attempt: 0 });

describe("job lifecycle", () => {
  it("allows queued to running", () => expect(canTransitionJob("queued", "running")).toBe(true));
  it("does not reopen completed jobs", () => expect(canTransitionJob("completed", "running")).toBe(false));

  it("allows exactly the legal transitions and nothing else", () => {
    const legal = new Set(["queued>running", "queued>cancelled", "running>completed", "running>failed", "running>cancelled"]);
    for (const from of JOB_STATUSES) for (const to of JOB_STATUSES) expect(canTransitionJob(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}>${to}`));
  });

  it("treats completed, failed and cancelled as terminal; failed never re-enters queued", () => {
    for (const s of ["completed", "failed", "cancelled"] as const) {
      expect(isTerminalJobStatus(s)).toBe(true);
      for (const to of JOB_STATUSES) expect(canTransitionJob(s, to)).toBe(false);
    }
    expect(canTransitionJob("failed", "queued")).toBe(false);
  });

  it("transitionJob returns a copy and rejects illegal moves", () => {
    const j = queued();
    const running = transitionJob(j, "running", () => new Date("2026-10-27T00:00:01.000Z"));
    expect(running.status).toBe("running");
    expect(running.startedAt).toBe("2026-10-27T00:00:01.000Z");
    expect(j.status).toBe("queued");
    const done = transitionJob(running, "completed", () => new Date("2026-10-27T00:00:02.000Z"));
    expect(done.finishedAt).toBe("2026-10-27T00:00:02.000Z");
    expect(() => transitionJob(done, "running")).toThrow(IllegalJobTransition);
    expect(() => transitionJob(queued(), "completed")).toThrow(IllegalJobTransition);
    expect(transitionJob(queued(), "cancelled").status).toBe("cancelled");
  });

  it("createRetry makes a new queued job linked by retryOf and leaves the original untouched", () => {
    const failed: Job = { ...transitionJob(queued(), "running"), status: "failed", error: "disk full" };
    const snapshot = structuredClone(failed);
    const retry = createRetry(failed, "j2");
    expect(retry).toEqual({ id: "j2", kind: "media-ingest", status: "queued", attempt: 1, retryOf: "j1" });
    expect(failed).toEqual(snapshot);
    expect(createRetry({ ...retry, status: "cancelled" }, "j3").attempt).toBe(2);
    expect(() => createRetry(queued(), "j9")).toThrow(/failed or cancelled/);
    expect(() => createRetry(failed, "j1")).toThrow(/distinct id/);
  });

  it("parses legacy catalog jobs and new per-item results", () => {
    expect(JobSchema.parse({ id: "a", kind: "k", status: "queued" }).attempt).toBe(0);
    const done = JobSchema.parse({
      id: "a",
      kind: "k",
      status: "completed",
      attempt: 0,
      results: [
        { itemId: "clip-1", status: "succeeded" },
        { itemId: "clip-2", status: "failed", reason: "no audio" },
        { itemId: "clip-3", status: "skipped", reason: "cached" },
      ],
    });
    expect(done.results?.map((r) => r.status)).toEqual(["succeeded", "failed", "skipped"]);
    expect(JobSchema.safeParse({ id: "a", kind: "k", status: "completed", results: [{ itemId: "x", status: "failed" }] }).success).toBe(false);
    expect(JobSchema.safeParse({ id: "a", kind: "k", status: "completed", error: "boom" }).success).toBe(false);
    expect(JobSchema.safeParse({ id: "a", kind: "k", status: "partial" }).success).toBe(false);
  });
});
