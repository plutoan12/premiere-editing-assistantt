import { expect, it } from "vitest";
import { createSubtitleDocument, serializeSubtitleDocument } from "@pea/transcript";
import { prepareCaptionApplication } from "./prepare.js";

const target = { projectPath: "/tests/Subtitle acceptance.prproj", sequenceId: "sequence-1", sequenceName: "Subtitle acceptance", available: true };
function input(options: { kind?: "source" | "sequence"; overlap?: boolean; empty?: boolean } = {}) {
  const ms = (ticks: bigint) => ({ ticks, timebase: { numerator: 1, denominator: 1000 } });
  const doc = createSubtitleDocument({
    id: "document", source: "srt",
    origin: { kind: options.kind ?? "sequence", mediaAssetId: "asset", label: "검증 자막", inputRevision: "snapshot", timelineStart: ms(10500n) },
    transcript: { id: "transcript", segments: options.empty ? [] : [
      { id: "one", mediaAssetId: "asset", text: "안녕하세요.", range: { start: ms(1000n), duration: ms(2000n) } },
      { id: "two", mediaAssetId: "asset", text: "두 번째 자막입니다.", range: { start: ms(options.overlap ? 2500n : 4000n), duration: ms(1500n) } }
    ] }
  });
  return { documentJSON: serializeSubtitleDocument(doc), target, requestId: "apply:once-1" };
}

it("prepares exact offset captions at zero placement while pinning the reviewed target", () => {
  const request = input();
  const prepared = prepareCaptionApplication(request);
  expect(prepared.expectedProjectPath).toBe("/tests/Subtitle acceptance.prproj");
  expect(prepared.expectedSequenceId).toBe("sequence-1");
  expect(prepared.revisionId).toBe("document:revision:1");
  expect(prepared.cueCount).toBe(2);
  expect(prepared.srt).toBe("1\n00:00:11,500 --> 00:00:13,500\n안녕하세요.\n\n2\n00:00:14,500 --> 00:00:16,000\n두 번째 자막입니다.\n");
  expect(prepareCaptionApplication(request).srt).toBe(prepared.srt);
  expect(JSON.parse(request.documentJSON).revisions[0].transcript.segments[0].range.start.ticks).toBe("1000");
});

it("requires explicit sequence placement instead of placing source clocks onto an arbitrary active sequence", () => {
  expect(() => prepareCaptionApplication(input({ kind: "source" }))).toThrow(/편집본|sequence/);
});

it.each([
  { ...target, available: false }, { ...target, projectPath: "" },
  { ...target, sequenceId: "" }, { ...target, sequenceName: "" }
])("rejects an unsupported or unpinned host target before file creation", invalid => {
  expect(() => prepareCaptionApplication({ ...input(), target: invalid })).toThrow();
});

it.each(["", "x\nattack", "../../other", "x".repeat(161)])("rejects unsafe application identity %s", requestId => {
  expect(() => prepareCaptionApplication({ ...input(), requestId })).toThrow();
});

it("rejects empty or overlapping captions rather than asking Premiere to silently repair them", () => {
  expect(() => prepareCaptionApplication(input({ empty: true }))).toThrow(/자막|caption|empty/);
  expect(() => prepareCaptionApplication(input({ overlap: true }))).toThrow(/겹|overlap/);
});
