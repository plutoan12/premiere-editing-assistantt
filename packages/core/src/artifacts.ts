/**
 * Artifact lifecycle: `candidate -> validated -> current -> superseded`,
 * plus `rejected`. Promotion is atomic and only ever moves a validated
 * candidate; nothing produced by a failed or rejected run can touch `current`.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { HexDigestSchema, ProvenanceSchema } from "./analysis.js";
import { IsoDateTimeSchema, SchemaVersionSchema } from "./common.js";
import { EntityIdSchema, newEntityId, type EntityId } from "./ids.js";
import { CORE_SCHEMA_VERSION } from "./version.js";

export const ARTIFACT_STATUSES = ["candidate", "validated", "current", "superseded", "rejected"] as const;
export const ArtifactStatusSchema = z.enum(ARTIFACT_STATUSES);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

/** Artifact provenance makes the cache inputs mandatory. */
export const ArtifactProvenanceSchema = ProvenanceSchema.extend({
  inputFingerprints: z.array(HexDigestSchema).min(1),
  configHash: HexDigestSchema,
});

export type ArtifactProvenance = z.infer<typeof ArtifactProvenanceSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over exactly the provenance inputs that determine the output; `createdAt` is excluded. */
export function deriveCacheKey(provenance: ArtifactProvenance): string {
  const material = canonicalJson({
    producer: provenance.producer,
    provider: provenance.provider ?? null,
    prompt: provenance.prompt ?? null,
    inputFingerprints: provenance.inputFingerprints,
    configHash: provenance.configHash,
  });
  return createHash("sha256").update(material).digest("hex");
}

function cacheKeyMatches(a: { cacheKey: string; provenance: unknown }): boolean {
  const parsed = ArtifactProvenanceSchema.safeParse(a.provenance);
  return parsed.success && deriveCacheKey(parsed.data) === a.cacheKey;
}

export const ArtifactSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: EntityIdSchema,
    projectId: EntityIdSchema,
    /** Engine-owned artifact kind, e.g. "transcript", "sync-group", "sequence-plan". */
    kind: z.string().min(1),
    status: ArtifactStatusSchema,
    cacheKey: z.string().regex(/^[0-9a-f]{64}$/),
    provenance: ArtifactProvenanceSchema,
    jobId: EntityIdSchema.optional(),
    /** Storage location relative to the artifact store root. */
    uri: z.string().min(1),
    contentHash: HexDigestSchema.optional(),
    createdAt: IsoDateTimeSchema,
    supersededBy: EntityIdSchema.optional(),
    rejection: z.string().min(1).optional(),
  })
  .refine(cacheKeyMatches, "cacheKey must be derived from the artifact provenance")
  .refine((a) => (a.supersededBy === undefined) === (a.status !== "superseded"), "supersededBy is set exactly when status is superseded")
  .refine((a) => (a.rejection === undefined) === (a.status !== "rejected"), "rejection is set exactly when status is rejected");

export type Artifact = z.infer<typeof ArtifactSchema>;

export class ArtifactLifecycleError extends Error {
  override readonly name = "ArtifactLifecycleError";
}

export interface CreateCandidateInput {
  readonly projectId: EntityId;
  readonly kind: string;
  readonly uri: string;
  readonly provenance: ArtifactProvenance;
  readonly jobId?: EntityId;
  readonly contentHash?: string;
}

export function createCandidateArtifact(input: CreateCandidateInput, now: () => Date = () => new Date()): Artifact {
  return ArtifactSchema.parse({
    schemaVersion: CORE_SCHEMA_VERSION,
    id: newEntityId(),
    projectId: input.projectId,
    kind: input.kind,
    status: "candidate",
    cacheKey: deriveCacheKey(input.provenance),
    provenance: input.provenance,
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    uri: input.uri,
    ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
    createdAt: now().toISOString(),
  });
}

export type ValidationVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** candidate -> validated | rejected. Returns a new artifact; never mutates the input. */
export function validateArtifact(artifact: Artifact, verdict: ValidationVerdict): Artifact {
  if (artifact.status !== "candidate") {
    throw new ArtifactLifecycleError(`artifact ${artifact.id}: only a candidate can be validated (status is ${artifact.status})`);
  }
  return verdict.ok
    ? ArtifactSchema.parse({ ...artifact, status: "validated" })
    : ArtifactSchema.parse({ ...artifact, status: "rejected", rejection: verdict.reason });
}

export interface PromotionResult {
  readonly current: Artifact;
  readonly superseded?: Artifact;
}

/**
 * validated -> current, atomically superseding the previous current artifact
 * of the same project and kind when one is given. Returns new objects.
 */
export function promoteArtifact(candidate: Artifact, current?: Artifact): PromotionResult {
  if (candidate.status !== "validated") {
    throw new ArtifactLifecycleError(`artifact ${candidate.id}: only a validated artifact can be promoted (status is ${candidate.status})`);
  }
  if (current !== undefined) {
    if (current.status !== "current") {
      throw new ArtifactLifecycleError(`artifact ${current.id} is not current (status is ${current.status}) and cannot be superseded`);
    }
    if (current.projectId !== candidate.projectId || current.kind !== candidate.kind) {
      throw new ArtifactLifecycleError(`artifact ${candidate.id} cannot supersede ${current.id}: project or kind differs`);
    }
    if (current.id === candidate.id) {
      throw new ArtifactLifecycleError(`artifact ${candidate.id} cannot supersede itself`);
    }
  }
  const promoted = ArtifactSchema.parse({ ...candidate, status: "current" });
  if (current === undefined) {
    return { current: promoted };
  }
  const superseded = ArtifactSchema.parse({ ...current, status: "superseded", supersededBy: promoted.id });
  return { current: promoted, superseded };
}
