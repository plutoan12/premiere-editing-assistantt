/**
 * Artifact lifecycle. Status names are kept for compatibility with existing
 * catalogs and map onto the platform spec as follows:
 *   candidate  -> produced, not yet validated
 *   valid      -> validated and promoted (the spec's `validated`/`current`)
 *   superseded -> was `valid`, replaced atomically by a newer `valid` artifact
 *   failed     -> rejected by validation or produced by a failed job (the spec's `rejected`)
 * A `failed` or `candidate` artifact never replaces the current `valid` one.
 */
import { z } from "zod";
import { ProvenanceSchema } from "./analysis.js";
import { sha256Hex } from "./sha256.js";

export const ARTIFACT_STATUSES = ["candidate", "valid", "failed", "superseded"] as const;
export const ArtifactStatusSchema = z.enum(ARTIFACT_STATUSES);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

const HexDigestSchema = z.string().regex(/^[0-9a-f]{32,128}$/, "must be a lowercase hex digest");

/** Provenance that makes the cache inputs mandatory; `cacheKey` is derived from exactly these fields. */
export const ArtifactProvenanceSchema = ProvenanceSchema.extend({
  producerModule: z.string().min(1).optional(),
  producerVersion: z.string().min(1).optional(),
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

/** SHA-256 over the provenance inputs that determine the output. */
export function deriveCacheKey(provenance: ArtifactProvenance): string {
  const p = ArtifactProvenanceSchema.parse(provenance);
  return sha256Hex(
      canonicalJson({
        provider: p.provider,
        model: p.model ?? null,
        version: p.version ?? null,
        promptVersion: p.promptVersion ?? null,
        producerModule: p.producerModule ?? null,
        producerVersion: p.producerVersion ?? null,
        inputFingerprints: p.inputFingerprints,
        configHash: p.configHash,
      }),
  );
}

export const ArtifactSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    version: z.number().int().positive(),
    status: ArtifactStatusSchema,
    uri: z.string().optional(),
    provenance: ArtifactProvenanceSchema.optional(),
    cacheKey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    jobId: z.string().min(1).optional(),
    createdAt: z.string().datetime().optional(),
    supersededBy: z.string().min(1).optional(),
    rejection: z.string().min(1).optional(),
  })
  .refine((a) => {
    if (a.cacheKey === undefined || a.provenance === undefined) return true;
    const provenance = ArtifactProvenanceSchema.safeParse(a.provenance);
    return !provenance.success || a.cacheKey === deriveCacheKey(provenance.data);
  }, "cacheKey must be derived from the artifact provenance")
  .refine((a) => (a.supersededBy === undefined) === (a.status !== "superseded"), "supersededBy is set exactly when status is superseded")
  .refine((a) => a.rejection === undefined || a.status === "failed", "rejection is only set on a failed artifact");
export type Artifact = z.infer<typeof ArtifactSchema>;

export class ArtifactLifecycleError extends Error {
  override readonly name = "ArtifactLifecycleError";
}

function assertReplaceable(candidate: Artifact, current: Artifact | undefined): void {
  if (current === undefined) return;
  if (current.status !== "valid") {
    throw new ArtifactLifecycleError(`artifact ${current.id} is not the current valid artifact (status is ${current.status})`);
  }
  if (current.kind !== candidate.kind) {
    throw new ArtifactLifecycleError(`artifact ${candidate.id} (${candidate.kind}) cannot replace ${current.id} (${current.kind})`);
  }
}

/**
 * Compatibility entry point: returns the artifact that should be current after
 * considering `candidate`. A `valid` candidate wins; anything else keeps `current`.
 */
export function promoteArtifact(candidate: Artifact, current?: Artifact): Artifact | undefined {
  assertReplaceable(candidate, current);
  return candidate.status === "valid" ? candidate : current;
}

export interface ArtifactPromotion {
  /** The artifact that is current after promotion (unchanged `current` when the candidate was not valid). */
  readonly current: Artifact | undefined;
  /** The previous current artifact marked `superseded`, when the candidate replaced it. */
  readonly superseded?: Artifact;
}

/** Atomic promotion: the previous `valid` artifact becomes `superseded` in the same step. Inputs are never mutated. */
export function resolveArtifactPromotion(candidate: Artifact, current?: Artifact): ArtifactPromotion {
  assertReplaceable(candidate, current);
  if (candidate.status !== "valid") return { current };
  if (current === undefined || current.id === candidate.id) return { current: candidate };
  return {
    current: candidate,
    superseded: ArtifactSchema.parse({ ...current, status: "superseded", supersededBy: candidate.id }),
  };
}

/** candidate -> valid. */
export function validateArtifact(candidate: Artifact): Artifact {
  if (candidate.status !== "candidate") {
    throw new ArtifactLifecycleError(`artifact ${candidate.id}: only a candidate can be validated (status is ${candidate.status})`);
  }
  return ArtifactSchema.parse({ ...candidate, status: "valid" });
}

/** candidate -> failed, with the reason recorded. */
export function rejectArtifact(candidate: Artifact, reason: string): Artifact {
  if (candidate.status !== "candidate") {
    throw new ArtifactLifecycleError(`artifact ${candidate.id}: only a candidate can be rejected (status is ${candidate.status})`);
  }
  return ArtifactSchema.parse({ ...candidate, status: "failed", rejection: reason });
}
