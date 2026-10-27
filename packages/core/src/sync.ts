import { z } from "zod";
import { ConfidenceSchema, ContractViolation, MediaTimeSchema, SchemaVersionSchema } from "./common.js";
import { EntityIdSchema } from "./ids.js";
import type { MediaAsset } from "./media.js";

export const SyncMethodSchema = z.enum(["timecode", "waveform", "manual", "ai"]);

export const SyncMemberSchema = z.strictObject({
  mediaAssetId: EntityIdSchema,
  /** Offset of this member relative to the reference member. The reference itself is at 0. */
  offset: MediaTimeSchema,
  method: SyncMethodSchema,
  confidence: ConfidenceSchema.optional(),
});

export const SyncGroupSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: EntityIdSchema,
    projectId: EntityIdSchema,
    referenceMediaAssetId: EntityIdSchema,
    members: z.array(SyncMemberSchema).min(2, "a sync group needs at least two members"),
  })
  .refine((g) => new Set(g.members.map((m) => m.mediaAssetId)).size === g.members.length, "members must reference distinct assets")
  .refine((g) => g.members.some((m) => m.mediaAssetId === g.referenceMediaAssetId), "reference must be a member")
  .refine(
    (g) => g.members.find((m) => m.mediaAssetId === g.referenceMediaAssetId)?.offset.ticks === 0,
    "reference member must have offset 0",
  );

export type SyncMember = z.infer<typeof SyncMemberSchema>;
export type SyncGroup = z.infer<typeof SyncGroupSchema>;

/** Schema-validate a group and check every member against the known assets of its project. */
export function validateSyncGroup(group: SyncGroup, assets: readonly MediaAsset[]): SyncGroup {
  const parsed = SyncGroupSchema.parse(group);
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  for (const member of parsed.members) {
    const asset = byId.get(member.mediaAssetId);
    if (asset === undefined) {
      throw new ContractViolation(`sync group ${parsed.id} references missing media asset ${member.mediaAssetId}`);
    }
    if (asset.projectId !== parsed.projectId) {
      throw new ContractViolation(`media asset ${asset.id} belongs to project ${asset.projectId}, not ${parsed.projectId}`);
    }
  }
  return parsed;
}
