import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as subject from "./index.js";
import type { TranscriptProvider } from "./types.js";
const input = { mediaAssetId: "m", mediaPath: "/local/clip.mov" };
const transcript = { id: "t", segments: [] };

describe("existing-first transcription", () => {
  it("reuses even an empty existing transcript without paying for another pass", async () => {
    let calls = 0;
    const result = await subject.transcribePreferExisting(input, { kind: "premiere", transcribe: async () => transcript }, { kind: "whisper-cpp", transcribe: async () => { calls++; return transcript; } });
    assert.equal(result.source, "premiere"); assert.equal(result.transcript, transcript); assert.equal(calls, 0);
  });
  it("uses local fallback only for explicit unavailability", async () => {
    const result = await subject.transcribePreferExisting(input, { kind: "premiere", transcribe: async () => { throw new subject.TranscriptUnavailableError("no transcript"); } }, { kind: "whisper-cpp", transcribe: async () => transcript });
    assert.equal(result.source, "whisper-cpp");
  });
  it("does not hide corrupt JSON, host failures or permission errors", async () => {
    let calls = 0;
    const error = new SyntaxError("malformed transcript");
    await assert.rejects(subject.transcribePreferExisting(input, { kind: "premiere", transcribe: async () => { throw error; } }, { kind: "whisper-cpp", transcribe: async () => { calls++; return transcript; } }), e => e === error);
    assert.equal(calls, 0);
  });
  it("never starts a provider when already cancelled", async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    const provider: TranscriptProvider = { kind: "premiere", transcribe: async () => { calls++; return transcript; } };
    await assert.rejects(subject.transcribePreferExisting({ ...input, signal: controller.signal }, provider), { name: "AbortError" });
    assert.equal(calls, 0);
  });
  it("stops awaiting an uncooperative provider on cancellation", async () => {
    const controller = new AbortController();
    const result = subject.transcribePreferExisting({ ...input, signal: controller.signal }, { kind: "premiere", transcribe: () => new Promise(() => {}) });
    controller.abort(); await assert.rejects(result, { name: "AbortError" });
  });
  it("does not invent fallback when none was configured", async () => {
    await assert.rejects(subject.transcribePreferExisting(input, { kind: "premiere", transcribe: async () => { throw new subject.TranscriptUnavailableError("missing"); } }), subject.TranscriptUnavailableError);
  });
  it("never turns a rejection with undefined into success", async () => {
    let resolved = false;
    try { await subject.observeTranscriptTask(() => Promise.reject(undefined)); resolved = true; }
    catch (error) { assert.equal(error, undefined); }
    assert.equal(resolved, false);
  });
  it("limits individual host waits", async () => {
    await assert.rejects(subject.observeTranscriptTask(() => new Promise(() => {}), undefined, 10), { name: "TimeoutError" });
  });
});
