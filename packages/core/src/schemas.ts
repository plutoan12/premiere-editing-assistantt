/**
 * JSON Schema bundles generated from the Zod definitions. The files under
 * `schemas/v1/` are produced by `pnpm schemas:generate` and a test fails when
 * they drift from these definitions.
 */
import { z } from "zod";
import { AnalysisTagSchema, ProvenanceSchema } from "./analysis.js";
import { ArtifactProvenanceSchema, ArtifactSchema } from "./artifacts.js";
import { MediaTimeSchema, RationalSchema, TimeRangeSchema } from "./common.js";
import { AudioDecisionSchema, DeliveryVariantSchema, EditDecisionSchema, GraphicDecisionSchema, SequencePlanSchema } from "./edit.js";
import { JobErrorSchema, JobItemResultSchema, JobSchema } from "./jobs.js";
import { ClipReferenceSchema, MediaAssetSchema, MediaFingerprintSchema } from "./media.js";
import { ProjectSchema } from "./project.js";
import { SyncGroupSchema, SyncMemberSchema } from "./sync.js";
import { SpeakerSchema, TranscriptSchema, TranscriptSegmentSchema } from "./transcript.js";
import { CORE_SCHEMA_VERSION } from "./version.js";

const SCHEMA_BASE_URI = "https://schemas.premiere-editing-assistant.dev/v1/";

interface Bundle {
  readonly title: string;
  readonly root: z.ZodType;
  readonly defs: Readonly<Record<string, z.ZodType>>;
}

const BUNDLES: Readonly<Record<string, Bundle>> = {
  project: { title: "Project", root: ProjectSchema, defs: { Rational: RationalSchema } },
  media: {
    title: "MediaAsset",
    root: MediaAssetSchema,
    defs: { MediaFingerprint: MediaFingerprintSchema, ClipReference: ClipReferenceSchema, MediaTime: MediaTimeSchema, TimeRange: TimeRangeSchema },
  },
  sync: { title: "SyncGroup", root: SyncGroupSchema, defs: { SyncMember: SyncMemberSchema } },
  transcript: { title: "Transcript", root: TranscriptSchema, defs: { Speaker: SpeakerSchema, TranscriptSegment: TranscriptSegmentSchema } },
  analysis: { title: "AnalysisTag", root: AnalysisTagSchema, defs: { Provenance: ProvenanceSchema } },
  edit: {
    title: "SequencePlan",
    root: SequencePlanSchema,
    defs: { EditDecision: EditDecisionSchema, GraphicDecision: GraphicDecisionSchema, AudioDecision: AudioDecisionSchema, DeliveryVariant: DeliveryVariantSchema },
  },
  job: { title: "Job", root: JobSchema, defs: { JobItemResult: JobItemResultSchema, JobError: JobErrorSchema } },
  artifact: { title: "Artifact", root: ArtifactSchema, defs: { ArtifactProvenance: ArtifactProvenanceSchema } },
};

function toJson(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json["$schema"];
  return json;
}

/** One JSON Schema document per bundle name (`project`, `media`, ...). */
export function buildJsonSchemas(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, bundle] of Object.entries(BUNDLES)) {
    const $defs: Record<string, unknown> = {};
    for (const [defName, def] of Object.entries(bundle.defs)) $defs[defName] = toJson(def);
    out[name] = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `${SCHEMA_BASE_URI}${name}.schema.json`,
      title: bundle.title,
      description: `Core contract ${bundle.title}, schema version ${CORE_SCHEMA_VERSION}. Generated from Zod; do not edit by hand.`,
      ...toJson(bundle.root),
      $defs,
    };
  }
  return out;
}
