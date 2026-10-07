import { describe, expect, it } from "vitest";
import type { MediaTime, Transcript } from "@pea/core";
import {
  createSubtitleDocument, currentTranscript, exportSubtitleDocument,
  mergeSubtitleCues, parseSubtitleDocument, searchSubtitleDocument,
  serializeSubtitleDocument, splitSubtitleCue, updateSubtitleCue,
  type SubtitleDocument, type SubtitleOrigin
} from "./document.js";

const ms = (ticks: bigint): MediaTime => ({ ticks, timebase: { numerator: 1, denominator: 1000 } });
const origin: SubtitleOrigin = { kind: "source", mediaAssetId: "asset", label: "인터뷰", inputRevision: "input-1" };
const transcript = (): Transcript => ({ id: "transcript", segments: [
  { id: "one", mediaAssetId: "asset", text: "안녕하세요", speakerId: "host", range: { start: ms(1000n), duration: ms(3000n) } },
  { id: "two", mediaAssetId: "asset", text: "두 번째 대사", speakerId: "host", range: { start: ms(5000n), duration: ms(2000n) } },
  { id: "three", mediaAssetId: "asset", text: "마지막", range: { start: ms(8000n), duration: ms(1000n) } }
] });
const document = (changes: Partial<Parameters<typeof createSubtitleDocument>[0]> = {}) => createSubtitleDocument({
  id: "document", origin, transcript: transcript(), source: "premiere", createdAt: "2026-10-07T00:00:00.000Z", ...changes
});

describe("subtitle document edits", () => {
  it("keeps the master, previous document and raw provider JSON detached after editing", () => {
    const input = transcript();
    const first = document({ transcript: input, rawSourceJSON: '{ "ticks": "unchanged", "text": "raw" }' });
    const edited = updateSubtitleCue(first, { segmentId: "one", text: "사용자 수정", speakerId: null });
    input.segments[0].text = "caller mutation";
    first.revisions[0].transcript.segments[0].text = "old document mutation";
    expect(edited.revisions[0].transcript.segments[0].text).toBe("안녕하세요");
    expect(currentTranscript(edited).segments[0]).toMatchObject({ text: "사용자 수정" });
    expect(currentTranscript(edited).segments[0].speakerId).toBeUndefined();
    expect(edited.revisions).toHaveLength(2);
    expect(edited.revisions[1].parentRevisionId).toBe(edited.revisions[0].id);
    expect(edited.currentRevisionId).toBe(edited.revisions[1].id);
    expect(edited.rawSourceJSON).toBe('{ "ticks": "unchanged", "text": "raw" }');
  });

  it("returns detached current and search results", () => {
    const doc = document();
    currentTranscript(doc).segments[0].text = "changed";
    searchSubtitleDocument(doc, "안녕")[0].range.start.ticks = 20n;
    expect(currentTranscript(doc).segments[0].text).toBe("안녕하세요");
    expect(currentTranscript(doc).segments[0].range.start.ticks).toBe(1000n);
  });

  it("updates text, explicit timing and speaker without changing unrelated cues", () => {
    const doc = document();
    const edited = updateSubtitleCue(doc, { segmentId: "one", text: "수정\n두 줄", speakerId: "guest", range: { start: ms(1500n), duration: ms(2000n) } });
    expect(exportSubtitleDocument(edited, "srt")).toContain("00:00:01,500 --> 00:00:03,500\n수정\n두 줄");
    expect(currentTranscript(edited).segments[0].speakerId).toBe("guest");
    expect(currentTranscript(edited).segments[1]).toEqual(transcript().segments[1]);
    expect(currentTranscript(doc).segments[0].text).toBe("안녕하세요");
  });

  it("splits only at the supplied absolute media time with the supplied texts", () => {
    const doc = document();
    const split = splitSubtitleCue(doc, { segmentId: "one", splitAt: { ticks: 5n, timebase: { numerator: 1, denominator: 2 } }, leftText: "안녕", rightText: "하세요" });
    const cues = currentTranscript(split).segments;
    expect(cues.map(cue => cue.text)).toEqual(["안녕", "하세요", "두 번째 대사", "마지막"]);
    expect(new Set(cues.map(cue => cue.id)).size).toBe(4);
    expect(cues[0].id).toBe("one");
    expect(cues[1].speakerId).toBe("host");
    expect(exportSubtitleDocument(split, "srt")).toContain("00:00:01,000 --> 00:00:02,500\n안녕\n\n2\n00:00:02,500 --> 00:00:04,000\n하세요");
    expect(currentTranscript(doc).segments).toHaveLength(3);
  });

  it.each([1000n, 4000n, 500n, 5000n])("rejects split boundary %s outside the strict cue interior without mutation", boundary => {
    const doc = document();
    const before = serializeSubtitleDocument(doc);
    expect(() => splitSubtitleCue(doc, { segmentId: "one", splitAt: ms(boundary), leftText: "a", rightText: "b" })).toThrow();
    expect(serializeSubtitleDocument(doc)).toBe(before);
  });

  it("merges adjacent matching speakers and spans the gap between cues", () => {
    const doc = document();
    const merged = mergeSubtitleCues(doc, { firstSegmentId: "one", secondSegmentId: "two" });
    expect(currentTranscript(merged).segments.map(cue => cue.id)).toEqual(["one", "three"]);
    expect(exportSubtitleDocument(merged, "srt")).toContain("00:00:01,000 --> 00:00:07,000\n안녕하세요\n두 번째 대사");
    expect(doc.revisions).toHaveLength(1);
  });

  it.each([["two", "one"], ["one", "three"], ["one", "one"], ["two", "three"], ["missing", "two"]])("rejects invalid merge %s -> %s", (firstSegmentId, secondSegmentId) => {
    const doc = document();
    expect(() => mergeSubtitleCues(doc, { firstSegmentId, secondSegmentId })).toThrow();
    expect(doc.revisions).toHaveLength(1);
  });

  it("rejects merging overlapping cues", () => {
    const input = transcript();
    input.segments[1].range.start = ms(3000n);
    expect(() => mergeSubtitleCues(document({ transcript: input }), { firstSegmentId: "one", secondSegmentId: "two" })).toThrow();
  });

  it("searches current corrected Korean text with NFC equivalence and treats a blank query as no search", () => {
    const doc = updateSubtitleCue(document(), { segmentId: "one", text: "한글 수정".normalize("NFD") });
    expect(searchSubtitleDocument(doc, "한글").map(cue => cue.id)).toEqual(["one"]);
    expect(searchSubtitleDocument(doc, "안녕하세요")).toEqual([]);
    expect(searchSubtitleDocument(doc, "   ")).toEqual([]);
  });

  it.each(["", " ", "one\n\ntwo", "one\n \ntwo", "one\r\n\r\ntwo", "one\n", "\none", "00:00:01.000 --> 00:00:02.000"])("rejects unusable or structurally unsafe cue text %j", text => {
    const doc = document();
    expect(() => updateSubtitleCue(doc, { segmentId: "one", text })).toThrow();
    expect(currentTranscript(doc).segments[0].text).toBe("안녕하세요");
  });

  it("rejects unknown segments and empty speaker IDs", () => {
    const doc = document();
    expect(() => updateSubtitleCue(doc, { segmentId: "missing", text: "x" })).toThrow();
    expect(() => updateSubtitleCue(doc, { segmentId: "one", speakerId: " " })).toThrow();
    expect(() => splitSubtitleCue(doc, { segmentId: "one", splitAt: ms(2000n), leftText: "", rightText: "b" })).toThrow();
  });
});

describe("subtitle document persistence and boundaries", () => {
  it("round-trips every revision and bigint beyond Number precision while retaining raw JSON verbatim", () => {
    const input = transcript();
    input.segments = [input.segments[0]];
    input.segments[0].range.start = ms(9007199254740993n);
    const edited = updateSubtitleCue(document({ transcript: input, rawSourceJSON: '{\n "ticks": "0001", "unknown": true\n}' }), { segmentId: "one", text: "교정" });
    const serialized = serializeSubtitleDocument(edited);
    expect(serialized).toContain('"9007199254740993"');
    const restored = parseSubtitleDocument(serialized);
    expect(restored).toEqual(edited);
    expect(currentTranscript(restored).segments[0].range.start.ticks).toBe(9007199254740993n);
    expect(restored.revisions[0].transcript.segments[0].text).toBe("안녕하세요");
  });

  it("applies a sequence offset only at export and leaves source times untouched", () => {
    const doc = document({ origin: { ...origin, kind: "sequence", timelineStart: ms(10000n) } });
    expect(exportSubtitleDocument(doc, "srt")).toContain("00:00:11,000 --> 00:00:14,000");
    expect(exportSubtitleDocument(doc, "vtt")).toContain("WEBVTT\n\n00:00:11.000 --> 00:00:14.000");
    expect(currentTranscript(doc).segments[0].range.start.ticks).toBe(1000n);
    expect(exportSubtitleDocument(document({ origin: { ...origin, timelineStart: ms(10000n) } }), "srt")).toContain("00:00:01,000 --> 00:00:04,000");
  });

  it("adds rational sequence offsets before the final millisecond quantization", () => {
    const input = transcript();
    input.segments = [{ ...input.segments[0], range: { start: { ticks: 10008n, timebase: { numerator: 1, denominator: 10000 } }, duration: ms(1000n) } }];
    const doc = document({ transcript: input, origin: { ...origin, kind: "sequence", timelineStart: { ticks: 8n, timebase: { numerator: 1, denominator: 10000 } } } });
    expect(exportSubtitleDocument(doc, "srt")).toContain("00:00:01,001 --> 00:00:02,001");
  });

  it("requires explicit sequence start, valid origin identities and a valid document ID", () => {
    expect(() => document({ origin: { ...origin, kind: "sequence" } })).toThrow();
    expect(() => document({ origin: { ...origin, kind: "sequence", timelineStart: ms(-1n) } })).toThrow();
    expect(() => document({ origin: { ...origin, inputRevision: "" } })).toThrow();
    expect(() => document({ origin: { ...origin, label: " " } })).toThrow();
    expect(() => document({ id: "" })).toThrow();
  });

  it.each([
    (input: Transcript) => { input.segments[1].id = "one"; },
    (input: Transcript) => { input.segments[1].mediaAssetId = "other"; },
    (input: Transcript) => { input.segments[0].text = ""; },
    (input: Transcript) => { input.segments[0].range.start.ticks = -1n; },
    (input: Transcript) => { input.segments[0].range.duration.ticks = 0n; },
    (input: Transcript) => { input.segments[0].range.duration.timebase.denominator = Number.MAX_SAFE_INTEGER + 1; },
    (input: Transcript) => { input.segments[0].range.duration.timebase.numerator = 0; }
  ])("rejects invalid canonical input at creation", change => {
    const input = transcript(); change(input);
    expect(() => document({ transcript: input })).toThrow();
  });

  it("rejects an origin that disagrees with every segment", () => {
    expect(() => document({ origin: { ...origin, mediaAssetId: "different" } })).toThrow();
  });

  it.each([
    (doc: any) => { doc.schemaVersion = "2.0"; },
    (doc: any) => { doc.schemaVersion = "invalid"; },
    (doc: any) => { doc.origin.kind = "other"; },
    (doc: any) => { doc.revisions[1].id = doc.revisions[0].id; },
    (doc: any) => { doc.revisions[1].parentRevisionId = "absent"; },
    (doc: any) => { doc.revisions[0].parentRevisionId = doc.revisions[1].id; },
    (doc: any) => { doc.revisions[1].transcriptId = "other"; },
    (doc: any) => { doc.revisions[1].transcript.id = "other"; doc.revisions[1].transcriptId = "other"; },
    (doc: any) => { doc.currentRevisionId = "absent"; },
    (doc: any) => { doc.currentRevisionId = doc.revisions[0].id; },
    (doc: any) => { doc.revisions[0].transcript.segments[0].range.start.ticks = 9007199254740992; },
    (doc: any) => { doc.revisions[0].transcript.segments[0].range.start.ticks = "1e3"; },
    (doc: any) => { doc.revisions[0].transcript.segments[0].range.start.ticks = "01"; },
    (doc: any) => { doc.revisions = []; },
    (doc: any) => { doc.rawSourceJSON = { unexpected: "object" }; }
  ])("rejects corrupted persisted document", corrupt => {
    const edited = updateSubtitleCue(document(), { segmentId: "one", text: "수정" });
    const wire: unknown = JSON.parse(serializeSubtitleDocument(edited));
    corrupt(wire);
    expect(() => parseSubtitleDocument(JSON.stringify(wire))).toThrow();
  });

  it("validates mutated public documents again before saving or exporting", () => {
    const corrupted = document();
    corrupted.revisions[0].transcript.segments[0].text = "unsafe\n\nblock";
    expect(() => serializeSubtitleDocument(corrupted)).toThrow();
    expect(() => exportSubtitleDocument(corrupted, "srt")).toThrow();
  });

  it("rejects invalid ranges atomically", () => {
    const doc = document();
    const before = serializeSubtitleDocument(doc);
    expect(() => updateSubtitleCue(doc, { segmentId: "one", range: { start: ms(0n), duration: ms(-1n) } })).toThrow();
    expect(serializeSubtitleDocument(doc)).toBe(before);
  });

  it("does not treat an unknown export format as another supported format", () => {
    expect(() => exportSubtitleDocument(document(), "ass" as "srt")).toThrow();
  });
});
