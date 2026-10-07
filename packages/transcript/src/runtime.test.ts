import { afterEach, expect, it, vi } from "vitest";
import { createSubtitleDocument, currentTranscript, splitSubtitleCue, updateSubtitleCue } from "./document.js";
import { createRevision } from "./revisions.js";

afterEach(() => vi.unstubAllGlobals());

it("creates detached revision history without the browser structuredClone global", () => {
  vi.stubGlobal("structuredClone", undefined);
  const ms = (ticks: bigint) => ({ ticks, timebase: { numerator: 1, denominator: 1000 } });
  const transcript = { id: "tr", segments: [{ id: "cue", mediaAssetId: "media", text: "안녕", range: { start: ms(0n), duration: ms(1000n) } }] };
  const revision = createRevision({ id: "r1", transcript, source: "premiere" });
  const doc = createSubtitleDocument({ id: "doc", origin: { kind: "source", mediaAssetId: "media", label: "대사", inputRevision: "snapshot" }, transcript, source: "premiere" });
  const edited = updateSubtitleCue(doc, { segmentId: "cue", text: "안녕하세요", range: { start: ms(0n), duration: ms(2000n) } });
  const split = splitSubtitleCue(edited, { segmentId: "cue", splitAt: ms(1000n), leftText: "안녕", rightText: "하세요" });
  transcript.segments[0].text = "외부 변경";
  expect(revision.transcript.segments[0].text).toBe("안녕");
  expect(split.revisions[0].transcript.segments[0].text).toBe("안녕");
  expect(currentTranscript(split).segments.map(cue => cue.text)).toEqual(["안녕", "하세요"]);
});
