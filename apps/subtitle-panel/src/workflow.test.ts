import { expect, it } from "vitest";
import type { Transcript } from "@pea/core";
import { createHelperClient } from "@pea/helper-protocol";
import {
  createSubtitleDocument, currentTranscript, exportSubtitleDocument,
  serializeSubtitleDocument, updateSubtitleCue, type TranscriptProvider
} from "@pea/transcript";
import { startHelperServer } from "../../native-helper/src/server.js";
import { createHelperTranscriptProvider } from "./helper-provider.js";
import { SubtitleSession } from "./session.js";

it("reviews and persists a fixture transcript through real loopback HTTP without losing bigint time or applying an offset twice", async () => {
  // The provider below is an in-memory fixture. This exercises actual HTTP/JSON
  // transport and the review workflow, not a speech model, media decode, or Premiere.
  const fixture: Transcript = {
    id: "fixture-transcript",
    segments: [{
      id: "fixture-cue", mediaAssetId: "fixture-media", text: "원본 대사", speakerId: "speaker-1",
      range: {
        start: { ticks: 9007199254740993n, timebase: { numerator: 1, denominator: 254016000000 } },
        duration: { ticks: 508032000000n, timebase: { numerator: 1, denominator: 254016000000 } }
      }
    }]
  };
  const requests: Array<{ mediaAssetId: string; mediaPath: string }> = [];
  const fixtureProvider: TranscriptProvider = { kind: "whisper-cpp", transcribe: async input => {
    requests.push({ mediaAssetId: input.mediaAssetId, mediaPath: input.mediaPath });
    return fixture;
  } };
  const helper = await startHelperServer({ provider: fixtureProvider, allowInsecureDev: true });
  try {
    const client = createHelperClient({
      endpoint: helper.endpoint, token: helper.token,
      protocolVersion: helper.protocolVersion, helperVersion: helper.helperVersion
    }, { allowInsecureDev: true });
    const provider = createHelperTranscriptProvider(client, { pollIntervalMs: 5, timeoutMs: 5000 });
    const session = new SubtitleSession();
    const origin = { mediaAssetId: "fixture-media", label: "검토용 편집본", inputRevision: "fixture-input-1" };

    expect(await session.load(async signal => createSubtitleDocument({
      id: "sequence-document", source: provider.kind,
      origin: { ...origin, kind: "sequence", timelineStart: { ticks: 10500n, timebase: { numerator: 1, denominator: 1000 } } },
      transcript: await provider.transcribe({ mediaAssetId: "fixture-media", mediaPath: "/fixture/audio.wav", signal })
    }))).toBe(true);
    expect(requests).toEqual([{ mediaAssetId: "fixture-media", mediaPath: "/fixture/audio.wav" }]);
    const received = currentTranscript(session.active!);
    expect(received.segments[0].range.start.ticks).toBe(9007199254740993n);
    expect(received.segments[0].range.start.timebase).toEqual({ numerator: 1, denominator: 254016000000 });
    expect(received.segments[0].speakerId).toBe("speaker-1");

    session.addDocument(createSubtitleDocument({
      id: "source-document", source: provider.kind,
      origin: { ...origin, kind: "source", label: "검색용 원본" }, transcript: received
    }));
    expect(session.search("원본").map(match => [match.documentId, match.kind])).toEqual([
      ["sequence-document", "sequence"], ["source-document", "source"]
    ]);
    expect(exportSubtitleDocument(session.active!, "srt")).toBe("1\n09:50:59,180 --> 09:51:01,180\n원본 대사\n");

    session.selectDocument("sequence-document");
    session.editActive(doc => updateSubtitleCue(doc, { segmentId: "fixture-cue", text: "교정된 대사" }));
    expect(session.search("교정").map(match => match.documentId)).toEqual(["sequence-document"]);
    expect(session.search("원본").map(match => match.documentId)).toEqual(["source-document"]);
    const saved = serializeSubtitleDocument(session.active!);
    const persisted: unknown = JSON.parse(saved);
    expect(persisted).toMatchObject({ revisions: [
      { transcript: { segments: [{ text: "원본 대사", range: { start: { ticks: "9007199254740993" } } }] } },
      { transcript: { segments: [{ text: "교정된 대사", range: { start: { ticks: "9007199254740993" } } }] } }
    ] });

    const reopened = new SubtitleSession();
    reopened.openDocument(saved);
    expect(reopened.active!.revisions).toHaveLength(2);
    expect(reopened.active!.revisions[0].transcript.segments[0].text).toBe("원본 대사");
    expect(currentTranscript(reopened.active!).segments[0].range.start.ticks).toBe(9007199254740993n);
    expect(reopened.active!.origin.timelineStart).toEqual({ ticks: 10500n, timebase: { numerator: 1, denominator: 1000 } });
    const expected = "1\n09:51:09,680 --> 09:51:11,680\n교정된 대사\n";
    expect(exportSubtitleDocument(reopened.active!, "srt")).toBe(expected);
    expect(exportSubtitleDocument(reopened.active!, "srt")).toBe(expected);
    expect(serializeSubtitleDocument(reopened.active!)).toBe(saved);
  } finally {
    await helper.stop();
  }
});
