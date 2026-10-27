/**
 * Contract smoke test: every later engine models its inputs and outputs
 * exclusively through the public exports of @pea/core.
 */
import { describe, expect, it } from "vitest";
import {
  CORE_SCHEMA_VERSION,
  FPS_23_976,
  createCandidateArtifact,
  createJob,
  createProject,
  mediaTime,
  newEntityId,
  parseCoreDocument,
  promoteArtifact,
  rational,
  transitionJob,
  validateArtifact,
  validateSequencePlan,
  validateSyncGroup,
  validateTranscript,
  type MediaAsset,
  type Provenance,
  type SequencePlan,
  type SyncGroup,
  type Transcript,
} from "@pea/core";

describe("@pea/core public contract", () => {
  it("models a project end to end through public exports only", () => {
    const now = () => new Date("2026-10-27T12:00:00.000Z");
    const project = createProject({ name: "Interview EP01", frameRate: FPS_23_976 }, now);

    const camera: MediaAsset = parseCoreDocument("mediaAsset", {
      schemaVersion: CORE_SCHEMA_VERSION,
      id: newEntityId(),
      projectId: project.id,
      sourcePath: "/Volumes/Media/A001_C001.mov",
      source: { immutable: true, fingerprint: { algorithm: "sha256", value: "1".repeat(64), sizeBytes: 4_000_000_000, strategy: "sampled" } },
      duration: mediaTime(24_024, FPS_23_976),
      video: { frameRate: FPS_23_976, width: 3840, height: 2160 },
      audio: { sampleRate: 48000, channels: 2 },
    });
    const recorder: MediaAsset = parseCoreDocument("mediaAsset", {
      ...camera,
      id: newEntityId(),
      sourcePath: "/Volumes/Media/ZOOM0001.wav",
      duration: mediaTime(48_096_048, rational(48000, 1)),
      video: undefined,
    });

    const provenance: Provenance = {
      producer: { module: "@pea/sync", version: "0.1.0" },
      createdAt: now().toISOString(),
      inputFingerprints: [camera.source.fingerprint.value, recorder.source.fingerprint.value],
      configHash: "2".repeat(64),
    };

    const sync: SyncGroup = parseCoreDocument("syncGroup", {
      schemaVersion: CORE_SCHEMA_VERSION,
      id: newEntityId(),
      projectId: project.id,
      referenceMediaAssetId: camera.id,
      members: [
        { mediaAssetId: camera.id, offset: mediaTime(0, FPS_23_976), method: "timecode" },
        { mediaAssetId: recorder.id, offset: mediaTime(-12_000, rational(48000, 1)), method: "waveform", confidence: 0.97 },
      ],
    });
    expect(validateSyncGroup(sync, [camera, recorder])).toEqual(sync);

    const speaker = { id: newEntityId(), label: "Host" };
    const transcript: Transcript = parseCoreDocument("transcript", {
      schemaVersion: CORE_SCHEMA_VERSION,
      id: newEntityId(),
      mediaAssetId: recorder.id,
      language: "ko-KR",
      speakers: [speaker],
      segments: [{ id: newEntityId(), range: { start: mediaTime(0, rational(1000, 1)), end: mediaTime(2_300, rational(1000, 1)) }, text: "시작하겠습니다", speakerId: speaker.id }],
      provenance: { ...provenance, provider: { name: "stt", model: "large-v3" } },
    });
    expect(validateTranscript(transcript, recorder)).toEqual(transcript);

    const plan: SequencePlan = parseCoreDocument("sequencePlan", {
      schemaVersion: CORE_SCHEMA_VERSION,
      id: newEntityId(),
      projectId: project.id,
      name: "Rough cut",
      frameRate: FPS_23_976,
      timebase: FPS_23_976,
      sourcePolicy: "reference-only",
      decisions: [
        {
          id: newEntityId(),
          kind: "insert",
          clip: { id: newEntityId(), mediaAssetId: camera.id, sourceRange: { start: mediaTime(0, FPS_23_976), end: mediaTime(240, FPS_23_976) } },
          destination: { trackKind: "video", trackIndex: 0, position: mediaTime(0, FPS_23_976) },
          enabled: true,
        },
      ],
      provenance,
    });
    expect(validateSequencePlan(plan, [camera, recorder])).toEqual(plan);

    const job = createJob({ projectId: project.id, kind: "rough-cut.generate" }, now);
    const finished = transitionJob(transitionJob(job, "running", now), "completed", now, { results: [{ itemId: plan.id, status: "succeeded" }] });
    expect(parseCoreDocument("job", finished).status).toBe("completed");

    const candidate = createCandidateArtifact({ projectId: project.id, kind: "sequence-plan", uri: `artifacts/${plan.id}.json`, provenance: { ...provenance, inputFingerprints: provenance.inputFingerprints!, configHash: provenance.configHash! }, jobId: finished.id }, now);
    const { current } = promoteArtifact(validateArtifact(candidate, { ok: true }));
    expect(parseCoreDocument("artifact", current).status).toBe("current");
  });

  it("does not expose floating-point canonical time or vendor types", async () => {
    const core = await import("@pea/core");
    expect(Object.keys(core).some((k) => /seconds/i.test(k))).toBe(false);
    expect(Object.keys(core).some((k) => /premiere|openai|anthropic|deepgram|whisper/i.test(k))).toBe(false);
  });
});
