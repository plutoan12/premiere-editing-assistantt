import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { TranscriptUnavailableError } from "@pea/transcript";

const subject = await import("./source-controller.js").catch(() => ({})) as typeof import("./source-controller.js");

const rawJSON = JSON.stringify({
  language: "ko-kr",
  speakers: [{ id: "speaker-1", name: "화자 1" }],
  segments: [{ start: 1.25, duration: 1.5, language: "ko-kr", speaker: "speaker-1", words: [
    { start: 1.25, duration: 1.5, confidence: 0.9, eos: true, tags: [], text: "안녕하세요", type: "word" }
  ] }]
});

function fixture(projectId = "project:one", itemId = "item:one") {
  const project = { guid: { toString: () => projectId }, name: "Project" };
  const item = { name: "인터뷰.mov", getId: () => itemId };
  const clip = { isSequence: async () => false, getMediaFilePath: async () => "/media/인터뷰.mov" };
  let active: typeof project | null = project;
  let items: unknown[] = [item];
  const exported: unknown[] = [], transcribed: unknown[] = [];
  const api = {
    hasTranscript: async (_clip: unknown) => true,
    exportToJSON: async (value: unknown) => { exported.push(value); return rawJSON; },
    transcribeClipProjectItem: async (value: unknown) => { transcribed.push(value); return true; }
  };
  const ppro = {
    Project: { getActiveProject: async () => active },
    ProjectUtils: { getSelection: async (value: unknown) => {
      assert.equal(value, project);
      return { getItems: async () => items };
    } },
    ClipProjectItem: { cast: (value: unknown) => value === item ? clip : null },
    Transcript: api
  };
  return { project, item, clip, ppro, api, exported, transcribed,
    select: (value: unknown[]) => { items = value; },
    activate: (value: typeof project | null) => { active = value; }
  };
}

describe("selected Premiere source transcript", () => {
  it("returns the real adapter's canonical transcript, word metadata and pinned media identity", async () => {
    const f = fixture();
    const result = await subject.readSelectedPremiereTranscript(f.ppro);
    assert.equal(result.mediaPath, "/media/인터뷰.mov");
    assert.equal(result.label, "인터뷰.mov");
    assert.ok(result.projectKey);
    assert.equal(result.snapshot.transcript.segments[0].mediaAssetId, result.mediaAssetId);
    assert.equal(result.snapshot.transcript.segments[0].text, "안녕하세요");
    assert.equal(result.snapshot.transcript.segments[0].range.start.ticks, 1250000n);
    assert.equal(result.snapshot.speakers[0].label, "화자 1");
    assert.equal(Object.values(result.snapshot.wordTimings)[0][0].confidence, 0.9);
    assert.equal(result.snapshot.rawJSON, rawJSON);
    assert.deepEqual(f.exported, [f.clip]);
    assert.deepEqual(f.transcribed, []);
  });

  it("keeps asset identities stable and separates ambiguous project/item delimiter pairs", async () => {
    const first = await subject.readSelectedPremiereTranscript(fixture("project:a", "b").ppro);
    const same = fixture("project:a", "b"); same.item.name = "renamed.mov";
    assert.equal((await subject.readSelectedPremiereTranscript(same.ppro)).mediaAssetId, first.mediaAssetId);
    const other = await subject.readSelectedPremiereTranscript(fixture("project", "a:b").ppro);
    assert.notEqual(other.mediaAssetId, first.mediaAssetId);
    assert.notEqual(other.projectKey, first.projectKey);
  });

  it("rejects absent projects and ambiguous, non-clip or sequence selections before transcript calls", async () => {
    const empty = fixture(); empty.activate(null);
    await assert.rejects(() => subject.readSelectedPremiereTranscript(empty.ppro), /project/i);
    for (const select of [[], [{}, {}], [{}]]) {
      const f = fixture(); f.select(select);
      await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro), /select|clip/i);
      assert.equal(f.exported.length + f.transcribed.length, 0);
    }
    const sequence = fixture(); sequence.clip.isSequence = async () => true;
    await assert.rejects(() => subject.readSelectedPremiereTranscript(sequence.ppro), /sequence/i);
    assert.equal(sequence.exported.length + sequence.transcribed.length, 0);
  });

  it("rejects unstable identities and missing media paths instead of guessing from names", async () => {
    for (const id of ["", "   ", "[object Object]", "00000000-0000-0000-0000-000000000000", "{00000000-0000-0000-0000-000000000000}"]) {
      const f = fixture(id);
      await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro), /identity|project/i);
      assert.equal(f.exported.length, 0);
    }
    const noItemId = fixture("project", "");
    await assert.rejects(() => subject.readSelectedPremiereTranscript(noItemId.ppro), /identity|item/i);
    const noPath = fixture(); noPath.clip.getMediaFilePath = async () => "";
    await assert.rejects(() => subject.readSelectedPremiereTranscript(noPath.ppro), /path|media/i);
  });

  it("pins the original clip when selection changes during asynchronous metadata lookup", async () => {
    const f = fixture();
    f.clip.getMediaFilePath = async () => { f.select([{ getId: () => "other", name: "other.mov" }]); return "/media/first.mov"; };
    f.api.hasTranscript = async () => false;
    const result = await subject.readSelectedPremiereTranscript(f.ppro, { allowTranscription: true });
    assert.equal(result.mediaPath, "/media/first.mov");
    assert.deepEqual(f.transcribed, [f.clip]);
    assert.deepEqual(f.exported, [f.clip]);
  });

  it("does not start host transcription without explicit opt-in", async () => {
    const f = fixture(); f.api.hasTranscript = async () => false;
    await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro), TranscriptUnavailableError);
    assert.equal(f.transcribed.length, 0);
  });

  it("supports older export-only transcript APIs and retains their receiver binding", async () => {
    const f = fixture();
    const api = {
      json: rawJSON,
      exportToJSON: async function (this: { json: string }, value: unknown) {
        assert.equal(value, f.clip);
        return this.json;
      }
    };
    const result = await subject.readSelectedPremiereTranscript({ ...f.ppro, Transcript: api });
    assert.equal(result.snapshot.rawJSON, rawJSON);
    await assert.rejects(() => subject.readSelectedPremiereTranscript({ ...f.ppro, Transcript: undefined }), TranscriptUnavailableError);
  });

  it("does not read the host when already cancelled", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    f.ppro.Project.getActiveProject = async () => { throw new Error("host must not be called"); };
    await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro, { signal: controller.signal }), { name: "AbortError" });
  });

  it("rejects a project switch during metadata lookup before any transcript operation", async () => {
    const f = fixture();
    f.clip.getMediaFilePath = async () => { f.activate({ guid: { toString: () => "other-project" }, name: "Other" }); return "/media/first.mov"; };
    await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro, { allowTranscription: true }), /project.*chang|stale/i);
    assert.equal(f.exported.length + f.transcribed.length, 0);
  });

  it("rechecks the project between transcript availability and opted-in transcription", async () => {
    const f = fixture();
    f.api.hasTranscript = async () => { f.activate({ guid: { toString: () => "other-project" }, name: "Other" }); return false; };
    await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro, { allowTranscription: true }), /project.*chang|stale/i);
    assert.equal(f.transcribed.length, 0);
  });

  it("rejects stale results if the project changes during export", async () => {
    const f = fixture();
    f.api.exportToJSON = async value => { f.exported.push(value); f.activate(null); return rawJSON; };
    await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro), /project.*chang|stale/i);
  });

  it.each(["availability", "transcription", "export"])("rejects a source relink during %s in the same project", async phase => {
    const f = fixture();
    let mediaPath = "/media/original.mov";
    f.clip.getMediaFilePath = async () => mediaPath;
    f.api.hasTranscript = async () => {
      if (phase === "availability") mediaPath = "/media/replacement.mov";
      return phase !== "transcription";
    };
    f.api.transcribeClipProjectItem = async value => {
      f.transcribed.push(value);
      mediaPath = "/media/replacement.mov";
      return true;
    };
    f.api.exportToJSON = async value => {
      f.exported.push(value);
      if (phase === "export") mediaPath = "/media/replacement.mov";
      return rawJSON;
    };
    await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro, { allowTranscription: true }), /source|media|relink|stale/i);
    assert.equal(f.exported.length, phase === "export" ? 1 : 0);
    assert.equal(f.transcribed.length, phase === "transcription" ? 1 : 0);
  });

  it("rejects corrupt exports without requesting a replacement transcription", async () => {
    const f = fixture(); f.api.exportToJSON = async () => "not json";
    await assert.rejects(() => subject.readSelectedPremiereTranscript(f.ppro, { allowTranscription: true }), SyntaxError);
    assert.equal(f.transcribed.length, 0);
  });

  it("cancels during selection lookup and never starts transcript work after it completes", async () => {
    const f = fixture(), controller = new AbortController();
    let release!: (value: { getItems: () => Promise<unknown[]> }) => void;
    f.ppro.ProjectUtils.getSelection = () => new Promise(resolve => { release = resolve; });
    const pending = subject.readSelectedPremiereTranscript(f.ppro, { signal: controller.signal });
    while (!release) await Promise.resolve();
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    release({ getItems: async () => [f.item] });
    await Promise.resolve();
    assert.equal(f.exported.length + f.transcribed.length, 0);
  });
});
