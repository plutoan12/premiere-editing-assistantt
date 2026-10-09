import { describe, expect, it } from "vitest";
import { AudioCache, runAudioJob, type AudioJobRequest, type AudioProvider, type CleanupOutput } from "./jobs.js";

const source = () => ({ media: { id: "m", uri: "file:///source.wav", readOnly: true as const, fingerprint: { algorithm: "sha256" as const, value: "abc" } }, range: { start: { ticks: 0n, timebase: { numerator: 1, denominator: 48000 } }, duration: { ticks: 48000n, timebase: { numerator: 1, denominator: 48000 } } }, sampleRate: 48000, channelCount: 2 });
const request = (): AudioJobRequest => ({ jobId: "j", artifactId: "a", artifactVersion: 1, attempt: 0, source: source(), operation: "cleanup", settings: { strength: 0.5 } });
const output = (): CleanupOutput => ({ uri: "file:///cleaned.wav", sampleRate: 48000, channelCount: 2, sampleCount: 48000n, residualLatencySamples: 0n });
const provider = (): AudioProvider => ({ id: "test-dsp", version: "1", cleanup: async () => output(), measureLoudness: async () => ({ integratedLufs: -20, truePeakDbtp: -4 }) });
const current = { isCurrent: () => true };

describe("audio jobs and artifact preservation", () => {
  it("promotes only a validated derivative with provenance", async () => {
    const result = await runAudioJob(request(), provider(), current);
    expect(result.job.status).toBe("completed");
    expect(result.history).toEqual(["queued", "running", "completed"]);
    expect(result.artifact?.descriptor).toMatchObject({ id: "a", status: "valid", kind: "audio.cleanup", uri: "file:///cleaned.wav" });
    expect(result.artifact?.source.media.fingerprint.value).toBe("abc");
    expect(result.artifact?.provider).toEqual({ id: "test-dsp", version: "1" });
  });
  it("makes a missing capability an explicit failure, not a fake success", async () => {
    const result = await runAudioJob(request(), { id: "meter-only", version: "1" }, current);
    expect(result.job.status).toBe("failed");
    expect(result.code).toBe("UNSUPPORTED_CAPABILITY");
    expect(result.artifact).toBeUndefined();
  });
  it.each([
    { uri: "file:///source.wav" }, { uri: "file:///tmp/../source.wav" }, { uri: "file:///SOURCE.wav" },
    { sampleRate: 44100 }, { channelCount: 1 }, { sampleCount: 47999n }, { residualLatencySamples: 1n },
  ])("rejects invalid cleanup output case %# and preserves current", async patch => {
    const previous = (await runAudioJob(request(), provider(), current)).artifact;
    const result = await runAudioJob({ ...request(), artifactId: "retry", attempt: 1 }, { ...provider(), cleanup: async () => ({ ...output(), ...patch }) }, { ...current, previous });
    expect(result.code).toBe("INVALID_RESULT");
    expect(result.job.status).toBe("failed");
    expect(result.artifact).toBe(previous);
  });
  it("preserves the old artifact after a provider rejection", async () => {
    const previous = (await runAudioJob(request(), provider(), current)).artifact;
    const result = await runAudioJob({ ...request(), artifactId: "retry", attempt: 1 }, { ...provider(), cleanup: async () => { throw new Error("decoder unavailable"); } }, { ...current, previous });
    expect(result.code).toBe("PROVIDER_FAILED");
    expect(result.job.error).toContain("decoder unavailable");
    expect(result.artifact).toBe(previous);
    expect(result.job.attempt).toBe(1);
  });
  it("cancels before execution and when a provider ignores AbortSignal", async () => {
    const before = new AbortController(); before.abort();
    expect((await runAudioJob(request(), provider(), { ...current, signal: before.signal })).history).toEqual(["queued", "cancelled"]);
    const controller = new AbortController();
    const pending = runAudioJob(request(), { ...provider(), cleanup: async () => { controller.abort(); return new Promise<CleanupOutput>(() => {}); } }, { ...current, signal: controller.signal });
    const result = await pending;
    expect(result.job.status).toBe("cancelled");
    expect(result.artifact).toBeUndefined();
  });
  it("rejects a result when the caller's source/selection revision changes", async () => {
    let latest = true;
    const cache = new AudioCache();
    const result = await runAudioJob(request(), { ...provider(), cleanup: async () => { latest = false; return output(); } }, { cache, isCurrent: () => latest });
    expect(result.code).toBe("STALE_RESULT");
    expect(result.artifact).toBeUndefined();
    const retry = await runAudioJob(request(), provider(), { ...current, cache });
    expect(retry.cacheHit).toBe(false);
  });
  it("takes a snapshot so a provider cannot mutate request metadata", async () => {
    const original = request();
    const result = await runAudioJob(original, { ...provider(), cleanup: async sourceCopy => { sourceCopy.media.id = "changed"; return output(); } }, current);
    expect(original.source.media.id).toBe("m");
    expect(result.artifact?.source.media.id).toBe("m");
  });
  it("rejects invalid source ranges before a provider runs", async () => {
    const input = request(); input.source.range.duration.ticks = -1n;
    const result = await runAudioJob(input, provider(), current);
    expect(result.code).toBe("INVALID_REQUEST");
    expect(result.history).toEqual(["queued", "running", "failed"]);
  });
  it("validates measured LUFS and true peak independently from sample-peak analysis", async () => {
    const input: AudioJobRequest = { ...request(), operation: "loudness", settings: {} };
    const good = await runAudioJob(input, provider(), current);
    expect(good.artifact?.payload).toEqual({ integratedLufs: -20, truePeakDbtp: -4 });
    const bad = await runAudioJob(input, { ...provider(), measureLoudness: async () => ({ integratedLufs: NaN, truePeakDbtp: -1 }) }, current);
    expect(bad.code).toBe("INVALID_RESULT");
  });
  it("preserves a known channel layout and rejects channel swaps", async () => {
    const input = request();
    Object.assign(input.source, { channelLayout: ["L", "R"] });
    const good = await runAudioJob(input, { ...provider(), cleanup: async () => ({ ...output(), channelLayout: ["L", "R"] }) }, current);
    expect(good.job.status).toBe("completed");
    const swapped = await runAudioJob(input, { ...provider(), cleanup: async () => ({ ...output(), channelLayout: ["R", "L"] }) }, current);
    expect(swapped.code).toBe("INVALID_RESULT");
    const omitted = await runAudioJob(input, provider(), current);
    expect(omitted.code).toBe("INVALID_RESULT");
  });
});

describe("validated audio cache", () => {
  it("reuses valid results but invalidates fingerprint, range, settings and provider version", async () => {
    const cache = new AudioCache();
    const first = await runAudioJob(request(), provider(), { ...current, cache });
    const hit = await runAudioJob(request(), provider(), { ...current, cache });
    expect(hit.cacheHit).toBe(true);
    expect(hit.artifact?.payload).toEqual(first.artifact?.payload);
    const revisions = [request(), request(), request()];
    revisions[0].source.media.fingerprint.value = "new";
    revisions[1].source.range.start.ticks = 48000n;
    revisions[2] = { ...request(), operation: "cleanup", settings: { strength: 0.2 } };
    for (const input of revisions) expect((await runAudioJob(input, provider(), { ...current, cache })).cacheHit).toBe(false);
    expect((await runAudioJob(request(), { ...provider(), version: "2" }, { ...current, cache })).cacheHit).toBe(false);
  });
  it("isolates cached snapshots from consumer mutation", async () => {
    const cache = new AudioCache();
    const first = await runAudioJob(request(), provider(), { ...current, cache });
    (first.artifact!.payload as CleanupOutput).uri = "file:///tampered.wav";
    const second = await runAudioJob(request(), provider(), { ...current, cache });
    expect((second.artifact!.payload as CleanupOutput).uri).toBe("file:///cleaned.wav");
  });
  it("invalidates cached cleanup when channel labels change at the same channel count", async () => {
    const cache = new AudioCache();
    const input = request(); input.source.channelLayout = ["L", "R"];
    const capability: AudioProvider = { ...provider(), cleanup: async value => ({ ...output(), channelLayout: value.channelLayout }) };
    await runAudioJob(input, capability, { ...current, cache });
    input.source.channelLayout = ["A", "B"];
    const changed = await runAudioJob(input, capability, { ...current, cache });
    expect(changed.cacheHit).toBe(false);
    expect((changed.artifact!.payload as CleanupOutput).channelLayout).toEqual(["A", "B"]);
  });
  it("does not promote a cached result when the request is stale", async () => {
    const cache = new AudioCache();
    await runAudioJob(request(), provider(), { ...current, cache });
    const result = await runAudioJob(request(), provider(), { cache, isCurrent: () => false });
    expect(result.code).toBe("STALE_RESULT");
    expect(result.artifact).toBeUndefined();
  });
});
