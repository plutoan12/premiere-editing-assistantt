import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { TranscriptUnavailableError } from "@pea/transcript";
const subject = await import("./index.js").catch(() => ({})) as typeof import("./index.js");
const speaker = "631fbbc0-9c02-47c4-bb8c-732c020fa24f";
function fixture(language = "en-us") {
  return { language, speakers: [{ id: speaker, name: "Speaker 1" }], segments: [{ start: 1.25, duration: 1.5, language, speaker, words: [
    { start: 1.25, duration: 0.5, confidence: 0.9, eos: false, tags: [], text: "Hello", type: "word" },
    { start: 1.75, duration: 0, confidence: 1, eos: false, tags: [], text: ",", type: "punctuation" },
    { start: 1.75, duration: 1, confidence: 0.8, eos: true, tags: [], text: "world", type: "word" }
  ] }] };
}
const clip = { isSequence: async () => false };
const input = { mediaAssetId: "m", mediaPath: "/local/clip.mov" };
const readFixture = () => Promise.resolve(JSON.stringify(fixture()));

describe("Adobe transcript JSON", () => {
  it("keeps source seconds, speakers, word confidence and raw JSON", () => {
    const json = JSON.stringify(fixture()); const result = subject.parsePremiereTranscript(json, "m");
    const segment = result.transcript.segments[0];
    assert.equal(segment.range.start.ticks, 1250000n);
    assert.equal(segment.range.duration.ticks, 1500000n);
    assert.equal(segment.text, "Hello, world"); assert.equal(segment.speakerId, speaker);
    assert.equal(result.wordTimings[segment.id][0].confidence, 0.9);
    assert.equal(result.rawJSON, json); assert.equal(result.speakers[0].label, "Speaker 1");
  });
  it("does not insert Western spaces into Japanese words", () => {
    const f = fixture("ja-jp"); f.segments[0].words[0].text = "私"; f.segments[0].words[1].text = "は"; f.segments[0].words[2].text = "学生。";
    assert.equal(subject.parsePremiereTranscript(JSON.stringify(f), "m").transcript.segments[0].text, "私は学生。");
  });
  it("rejects speaker references that cannot be traced", () => {
    const f = fixture(); f.segments[0].speaker = "missing";
    assert.throws(() => subject.parsePremiereTranscript(JSON.stringify(f), "m"), /speaker/i);
  });
  it("rejects words outside the parent segment", () => {
    const f = fixture(); f.segments[0].words[0].start = 0;
    assert.throws(() => subject.parsePremiereTranscript(JSON.stringify(f), "m"), /range|segment/i);
  });
  it("rejects negative times and nonnumeric values instead of coercing them", () => {
    const f = fixture(); f.segments[0].start = -1;
    assert.throws(() => subject.parsePremiereTranscript(JSON.stringify(f), "m"));
    (f.segments[0] as unknown as { start: unknown }).start = "1";
    assert.throws(() => subject.parsePremiereTranscript(JSON.stringify(f), "m"));
  });
});

describe("Premiere host boundary", () => {
  it("exports existing transcripts without calling native transcription", async () => {
    let called = false;
    const adapter = subject.createPremiereTranscriptAdapter({ api: { exportToJSON: readFixture, hasTranscript: () => true, transcribeClipProjectItem: async () => { called = true; return true; } }, resolveClip: async () => clip });
    assert.equal((await adapter.transcribe(input)).segments[0].text, "Hello, world"); assert.equal(called, false);
  });
  it("works with exportToJSON when the newer hasTranscript API is absent", async () => {
    const adapter = subject.createPremiereTranscriptAdapter({ api: { exportToJSON: readFixture }, resolveClip: async () => clip });
    assert.equal((await adapter.transcribe(input)).segments.length, 1);
  });
  it("reports absence without silently starting a host transcription", async () => {
    let called = false;
    const adapter = subject.createPremiereTranscriptAdapter({ api: { exportToJSON: readFixture, hasTranscript: () => false, transcribeClipProjectItem: async () => { called = true; return true; } }, resolveClip: async () => clip });
    await assert.rejects(adapter.transcribe(input), TranscriptUnavailableError); assert.equal(called, false);
  });
  it("transcribes only with explicit permission and awaits completion before export", async () => {
    const events: string[] = [];
    const adapter = subject.createPremiereTranscriptAdapter({ api: { hasTranscript: () => false, transcribeClipProjectItem: async () => { events.push("transcribe"); return true; }, exportToJSON: async () => { events.push("export"); return readFixture(); } }, resolveClip: async () => clip, allowTranscription: true });
    await adapter.transcribe(input); assert.deepEqual(events, ["transcribe", "export"]);
  });
  it("rejects sequences before using clip transcript APIs", async () => {
    let calls = 0;
    const adapter = subject.createPremiereTranscriptAdapter({ api: { exportToJSON: async () => { calls++; return readFixture(); } }, resolveClip: async () => ({ isSequence: async () => true }) });
    await assert.rejects(adapter.transcribe(input), /sequence/i); assert.equal(calls, 0);
  });
  it("does not convert export errors into missing transcripts", async () => {
    const error = new Error("host read failed");
    const adapter = subject.createPremiereTranscriptAdapter({ api: { exportToJSON: async () => { throw error; } }, resolveClip: async () => clip });
    await assert.rejects(adapter.transcribe(input), e => e === error);
  });
  it("rejects cancellation and does not start a later export after host completion", async () => {
    const controller = new AbortController(); let finish!: (ok: boolean) => void, exports = 0;
    let begin!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const adapter = subject.createPremiereTranscriptAdapter({ api: { hasTranscript: () => false, transcribeClipProjectItem: () => new Promise<boolean>(r => { finish = r; begin(); }), exportToJSON: async () => { exports++; return readFixture(); } }, resolveClip: async () => clip, allowTranscription: true });
    const result = adapter.transcribe({ ...input, signal: controller.signal });
    await started; controller.abort(); finish(true); await assert.rejects(result, { name: "AbortError" }); assert.equal(exports, 0);
  });
});
