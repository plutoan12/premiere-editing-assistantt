import { describe, it, expect } from "vitest";
import { createSubtitleDocument, currentTranscript, updateSubtitleCue, type SubtitleDocument } from "@pea/transcript";
import { SubtitleSession, parseSubtitleTime, formatSubtitleTime, subtitleRange, cueEnd } from "./session.js";

const origin = { kind: "source" as const, mediaAssetId: "asset", label: "인터뷰.mov", inputRevision: "snapshot-1" };
const srt = "1\n00:00:00,100 --> 00:00:01,900\n반가워요\n";
function doc(id = "doc", text = "반가워요"): SubtitleDocument {
  return createSubtitleDocument({ id, origin, source: "srt", transcript: { id: `tr-${id}`, segments: [
    { id: "cue", mediaAssetId: "asset", text, range: { start: { ticks: 1n, timebase: { numerator: 1, denominator: 10 } }, duration: { ticks: 18n, timebase: { numerator: 1, denominator: 10 } } } }
  ] } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("subtitle review workspace", () => {
  it("imports source and sequence with equal searchable status without moving source times", () => {
    const session = new SubtitleSession();
    session.importSubtitle({ id: "source", origin, text: srt, format: "srt" });
    session.importSubtitle({ id: "sequence", origin: { ...origin, kind: "sequence", label: "편집본", timelineStart: parseSubtitleTime("10.5") }, text: srt, format: "srt" });
    expect(session.documents).toHaveLength(2);
    expect(session.search("반가").map(match => [match.documentId, match.kind])).toEqual([["source", "source"], ["sequence", "sequence"]]);
    expect(session.search("반가")[1].segment.range.start.ticks).toBe(100n);
  });
  it("keeps a valid document when an import, load or edit is invalid", () => {
    const session = new SubtitleSession();
    session.addDocument(doc());
    expect(() => session.importSubtitle({ id: "bad", origin, text: "invalid", format: "srt" })).toThrow();
    expect(() => session.openDocument("{}" )).toThrow();
    expect(() => session.editActive(value => updateSubtitleCue(value, { segmentId: "cue", text: "" }))).toThrow();
    expect(session.documents).toHaveLength(1);
    expect(currentTranscript(session.active!).segments[0].text).toBe("반가워요");
  });
  it("refuses an identity collision and cross-document edit without overwriting", () => {
    const session = new SubtitleSession();
    session.addDocument(doc());
    expect(() => session.addDocument(doc("doc", "overwrite"))).toThrow(/already|duplicate/i);
    expect(() => session.editActive(() => doc("different"))).toThrow(/identity/i);
    expect(() => session.selectDocument("missing")).toThrow();
    expect(session.active!.id).toBe("doc");
  });
  it("returns detached state and applies edits to the selected document only", () => {
    const session = new SubtitleSession();
    const input = doc();
    session.addDocument(input);
    input.origin.label = "mutation";
    session.addDocument(doc("second", "다른 대사"));
    session.selectDocument("doc");
    session.editActive(value => updateSubtitleCue(value, { segmentId: "cue", text: "안녕하세요" }));
    session.active!.origin.label = "outside mutation";
    session.documents[0].revisions[0].transcript.segments[0].text = "corruption";
    expect(session.active!.origin.label).toBe("인터뷰.mov");
    expect(session.active!.revisions).toHaveLength(2);
    expect(session.active!.revisions[0].transcript.segments[0].text).toBe("반가워요");
    expect(session.search("안녕").map(match => match.documentId)).toEqual(["doc"]);
    expect(session.search("다른").map(match => match.documentId)).toEqual(["second"]);
  });
  it("commits only the newest operation, even if an older provider ignores cancellation", async () => {
    const session = new SubtitleSession();
    const first = deferred<SubtitleDocument>();
    let signal!: AbortSignal;
    const old = session.load(value => { signal = value; return first.promise; });
    expect(session.busy).toBe(true);
    expect(await session.load(async () => doc("new"))).toBe(true);
    expect(signal.aborted).toBe(true);
    first.resolve(doc("stale"));
    expect(await old).toBe(false);
    expect(session.documents.map(value => value.id)).toEqual(["new"]);
    expect(session.busy).toBe(false);
  });
  it("cancels without clearing existing work and ignores a late rejection", async () => {
    const session = new SubtitleSession();
    session.addDocument(doc());
    const pending = deferred<SubtitleDocument>();
    const task = session.load(() => pending.promise);
    session.cancelPending();
    pending.reject(new Error("late host failure"));
    expect(await task).toBe(false);
    expect(session.busy).toBe(false);
    expect(session.active!.id).toBe("doc");
    await expect(session.load(async () => { throw new Error("current failure"); })).rejects.toThrow("current failure");
    expect(session.active!.id).toBe("doc");
    expect(session.busy).toBe(false);
  });
});

describe("exact editable subtitle time", () => {
  it.each(["0", "1.001", "9007199254740993.125", "0.000000001", "1001/30000"])("round trips %s without floating-point loss", input => {
    const time = parseSubtitleTime(input);
    expect(parseSubtitleTime(formatSubtitleTime(time))).toEqual(time);
  });
  it.each(["-1", "NaN", "1e3", "1.1234567890", "1/0", "1/9007199254740992", "", "1.2foo"])("rejects invalid time %s", input => {
    expect(() => parseSubtitleTime(input)).toThrow();
  });
  it("subtracts endpoints exactly and adds them back without rounding", () => {
    const range = subtitleRange("1001/30000", "1001/15000");
    expect(range.duration).toEqual(parseSubtitleTime("1001/30000"));
    expect(cueEnd({ range })).toEqual(parseSubtitleTime("1001/15000"));
    expect(() => subtitleRange("1", "1")).toThrow();
    expect(() => subtitleRange("2", "1")).toThrow();
  });
});
