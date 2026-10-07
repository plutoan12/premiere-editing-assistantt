import { afterEach, describe, expect, it, vi } from "vitest";
import type { createHelperClient, HelperJob } from "@pea/helper-protocol";
import { createHelperTranscriptProvider, deserializeHelperTranscript } from "./helper-provider.js";

type Client = Pick<ReturnType<typeof createHelperClient>, "submitTranscription" | "getJob" | "cancelJob">;
const input = { mediaAssetId: "asset-1", mediaPath: "/source/clip.mov" };
function wire() {
  return { id: "transcript-1", segments: [{ id: "segment-1", mediaAssetId: "asset-1", text: "안녕하세요", speakerId: "speaker-1", range: {
    start: { ticks: "9007199254740993", timebase: { numerator: 1, denominator: 254016000000 } },
    duration: { ticks: "254016000000", timebase: { numerator: 1, denominator: 254016000000 } }
  } }] };
}
function completed(): HelperJob {
  return { id: "job-1", status: "completed", progress: 1, result: { transcript: wire() } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function clientWith(getJob: Client["getJob"] = async () => completed()) {
  const requests: { mediaAssetId: string; mediaPath: string }[] = [], polls: string[] = [], cancelled: string[] = [];
  const client: Client = {
    submitTranscription: async value => { requests.push(value); return { jobId: "job-1" }; },
    getJob: async id => { polls.push(id); return getJob(id); },
    cancelJob: async id => { cancelled.push(id); return { cancelled: true }; }
  };
  return { client, requests, polls, cancelled };
}
afterEach(() => { vi.useRealTimers(); });

describe("helper wire transcript", () => {
  it("preserves integer ticks beyond Number precision and source metadata", () => {
    const decoded = deserializeHelperTranscript(wire(), "asset-1");
    expect(decoded.segments[0].range.start.ticks).toBe(9007199254740993n);
    expect(decoded.segments[0].range.duration.ticks).toBe(254016000000n);
    expect(decoded.segments[0].range.start.timebase).toEqual({ numerator: 1, denominator: 254016000000 });
    expect(decoded.segments[0].text).toBe("안녕하세요");
    expect(decoded.segments[0].speakerId).toBe("speaker-1");
  });
  it.each([
    ["number ticks", (w: any) => { w.segments[0].range.start.ticks = 9007199254740992; }],
    ["negative start", (w: any) => { w.segments[0].range.start.ticks = "-1"; }],
    ["exponent ticks", (w: any) => { w.segments[0].range.start.ticks = "1e3"; }],
    ["zero duration", (w: any) => { w.segments[0].range.duration.ticks = "0"; }],
    ["negative duration", (w: any) => { w.segments[0].range.duration.ticks = "-1"; }],
    ["unsafe timebase", (w: any) => { w.segments[0].range.start.timebase.numerator = 9007199254740992; }],
    ["zero timebase", (w: any) => { w.segments[0].range.duration.timebase.denominator = 0; }],
    ["fractional timebase", (w: any) => { w.segments[0].range.start.timebase.denominator = 1.5; }],
    ["wrong asset", (w: any) => { w.segments[0].mediaAssetId = "other"; }],
    ["duplicate segment", (w: any) => { w.segments.push(w.segments[0]); }],
    ["blank transcript id", (w: any) => { w.id = " "; }],
    ["missing text", (w: any) => { delete w.segments[0].text; }]
  ])("rejects %s", (_name, mutate) => {
    const value = wire(); mutate(value);
    expect(() => deserializeHelperTranscript(value, "asset-1")).toThrow();
  });
});

describe("helper transcript provider", () => {
  it("submits once, polls pending work and returns only the matching completed transcript", async () => {
    vi.useFakeTimers(); let count = 0;
    const h = clientWith(async () => ++count === 1 ? { id: "job-1", status: "running", progress: 0.1 } : completed());
    const provider = createHelperTranscriptProvider(h.client, { pollIntervalMs: 10 });
    const result = provider.transcribe(input);
    await vi.advanceTimersByTimeAsync(10);
    expect((await result).segments[0].range.start.ticks).toBe(9007199254740993n);
    expect(provider.kind).toBe("whisper-cpp");
    expect(h.requests).toEqual([input]); expect(h.polls).toEqual(["job-1", "job-1"]);
    expect(h.cancelled).toEqual([]);
  });
  it.each([
    ["mismatched job", { ...completed(), id: "other" }],
    ["invalid status", { ...completed(), status: "finished" }],
    ["missing result", { id: "job-1", status: "completed", progress: 1 }],
    ["invalid progress", { ...completed(), progress: NaN }]
  ])("rejects %s without retry", async (_name, job) => {
    const h = clientWith(async () => job as HelperJob);
    await expect(createHelperTranscriptProvider(h.client).transcribe(input)).rejects.toThrow();
    expect(h.requests).toHaveLength(1); expect(h.polls).toHaveLength(1);
  });
  it("reports remote failure without resubmitting", async () => {
    const h = clientWith(async () => ({ id: "job-1", status: "failed", progress: 1, error: { code: "DecodeError", message: "audio has no stream" } }));
    await expect(createHelperTranscriptProvider(h.client).transcribe(input)).rejects.toThrow("audio has no stream");
    expect(h.requests).toHaveLength(1); expect(h.polls).toHaveLength(1);
  });
  it("reports a remotely cancelled job as cancellation", async () => {
    const h = clientWith(async () => ({ id: "job-1", status: "cancelled", progress: 1 }));
    await expect(createHelperTranscriptProvider(h.client).transcribe(input)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("never submits after an already aborted signal", async () => {
    const h = clientWith(), controller = new AbortController(); controller.abort();
    await expect(createHelperTranscriptProvider(h.client).transcribe({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(h.requests).toEqual([]);
  });
  it("cancels a known job immediately while waiting between polls", async () => {
    vi.useFakeTimers();
    const h = clientWith(async () => ({ id: "job-1", status: "running", progress: 0.1 }));
    const controller = new AbortController();
    const result = createHelperTranscriptProvider(h.client, { pollIntervalMs: 1000 }).transcribe({ ...input, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await assertion;
    expect(h.cancelled).toEqual(["job-1"]);
    await vi.advanceTimersByTimeAsync(1000); expect(h.polls).toHaveLength(1);
  });
  it("cancels a late accepted submission after caller cancellation without polling it", async () => {
    const h = clientWith(), submit = deferred<{ jobId: string }>(), controller = new AbortController();
    h.client.submitTranscription = () => submit.promise;
    const result = createHelperTranscriptProvider(h.client).transcribe({ ...input, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await assertion;
    submit.resolve({ jobId: "job-1" }); await Promise.resolve(); await Promise.resolve();
    expect(h.cancelled).toEqual(["job-1"]); expect(h.polls).toEqual([]);
  });
  it("times out the entire operation and cancels a submission accepted afterward", async () => {
    vi.useFakeTimers();
    const h = clientWith(), submit = deferred<{ jobId: string }>(); h.client.submitTranscription = () => submit.promise;
    const result = createHelperTranscriptProvider(h.client, { timeoutMs: 20 }).transcribe(input);
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(20); await assertion;
    submit.resolve({ jobId: "job-1" }); await vi.advanceTimersByTimeAsync(0);
    expect(h.cancelled).toEqual(["job-1"]); expect(h.polls).toEqual([]);
  });
  it("rejects late completion after timeout and does not wait for cancellation acknowledgement", async () => {
    vi.useFakeTimers(); const pending = deferred<HelperJob>();
    const h = clientWith(() => pending.promise);
    h.client.cancelJob = async id => { h.cancelled.push(id); return new Promise(() => {}); };
    const result = createHelperTranscriptProvider(h.client, { timeoutMs: 20 }).transcribe(input);
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(20); await assertion;
    expect(h.cancelled).toEqual(["job-1"]);
    pending.resolve(completed()); await vi.advanceTimersByTimeAsync(0);
    expect(h.cancelled).toHaveLength(1); expect(h.polls).toHaveLength(1);
  });
  it("does not retry transport errors", async () => {
    const h = clientWith(async () => { throw new Error("connection lost"); });
    await expect(createHelperTranscriptProvider(h.client).transcribe(input)).rejects.toThrow("connection lost");
    expect(h.requests).toHaveLength(1); expect(h.polls).toHaveLength(1);
  });
});
