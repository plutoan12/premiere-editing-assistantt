import { z } from "zod";
import {
  encodeMediaDocument,
  parseCoreDocument,
  encodeMediaTime,
  decodeMediaTime,
  type TimeRange,
} from "@pea/core";
import {
  CatalogSchema,
  AssetRecordSchema,
  validateCatalog,
  unique,
  type CatalogState,
} from "./catalog.js";
import { ProbeRecordSchema, ScanRecordSchema } from "./scan.js";
import { AnnotationSchema } from "./metadata.js";
import {
  HostApplyPlanSchema,
  HostContextSchema,
  HostItemSnapshotSchema,
} from "./editor-contract.js";
const WireTime = z.unknown().transform(decodeMediaTime);
const WireRange = z.object({ start: WireTime, duration: WireTime }).strict();
const Integer = z
  .string()
  .regex(/^(0|-?[1-9][0-9]*)$/)
  .transform((x) => BigInt(x));
const WireStamp = z
  .object({
    size: Integer.refine((x) => x >= 0n),
    mtimeNs: Integer,
    identity: z.string().optional(),
  })
  .strict();
const WireProbe = ProbeRecordSchema.extend({ duration: WireTime.optional() });
const WireAsset = AssetRecordSchema.omit({ asset: true }).extend({
  mediaAssetId: z.string().min(1),
  duration: WireTime.optional(),
  probe: WireProbe.optional(),
});
const WireOrganizer = CatalogSchema.omit({ assets: true, clips: true }).extend({
  assets: z.array(WireAsset),
  scans: z.array(
    ScanRecordSchema.extend({
      sourceRange: WireRange.optional(),
      stamp: WireStamp.optional(),
    }),
  ),
  annotations: z.array(
    z
      .object({ ...AnnotationSchema.shape, range: WireRange.optional() })
      .strict()
      .pipe(AnnotationSchema),
  ),
  hostPlans: z.array(
    z
      .object({
        ...HostApplyPlanSchema.shape,
        expectedContext: HostContextSchema.extend({
          items: z.array(
            HostItemSnapshotSchema.extend({
              sourceRange: WireRange.optional(),
            }),
          ),
        }),
      })
      .strict()
      .pipe(HostApplyPlanSchema),
  ),
});
const Envelope = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    producer: z
      .object({
        module: z.literal("media-organizer"),
        version: z.string().min(1),
      })
      .strict(),
    core: z.unknown(),
    organizer: WireOrganizer,
  })
  .strict();
const encodeRange = (range: TimeRange) => ({
  start: encodeMediaTime(range.start),
  duration: encodeMediaTime(range.duration),
});
export function exportCatalog(input: CatalogState): string {
  const state = validateCatalog(input),
    { clips, assets, ...rest } = state;
  const organizer = {
    ...rest,
    assets: assets.map(({ asset, duration, probe, ...extension }) => ({
      ...extension,
      mediaAssetId: asset.id,
      duration: duration && encodeMediaTime(duration),
      probe: probe && {
        ...probe,
        duration: probe.duration && encodeMediaTime(probe.duration),
      },
    })),
    scans: state.scans.map((scan) => ({
      ...scan,
      sourceRange: scan.sourceRange && encodeRange(scan.sourceRange),
      stamp: scan.stamp && {
        ...scan.stamp,
        size: String(scan.stamp.size),
        mtimeNs: String(scan.stamp.mtimeNs),
      },
    })),
    annotations: state.annotations.map((a) => ({
      ...a,
      range: a.range && encodeRange(a.range),
    })),
    hostPlans: state.hostPlans.map((p) => ({
      ...p,
      expectedContext: {
        ...p.expectedContext,
        items: p.expectedContext.items.map((item) => ({
          ...item,
          sourceRange: item.sourceRange && encodeRange(item.sourceRange),
        })),
      },
    })),
  };
  return JSON.stringify({
    schemaVersion: "1.0.0",
    producer: { module: "media-organizer", version: "0.1.0" },
    core: encodeMediaDocument({
      schemaVersion: "1.0.0",
      kind: "media",
      data: { assets: assets.map((x) => x.asset), clips },
    }),
    organizer,
  });
}
/** Parsing never writes to a store or authorizes execution of opaque adapter actions. */
export function importCatalog(json: string): CatalogState {
  const envelope = Envelope.parse(JSON.parse(json)),
    core = parseCoreDocument(envelope.core);
  if (core.kind !== "media")
    throw new Error("catalog requires a Core media document");
  const extensions = envelope.organizer.assets;
  unique(
    extensions.map((x) => x.mediaAssetId),
    "asset extension",
  );
  if (extensions.length !== core.data.assets.length)
    throw new Error("asset extension count mismatch");
  const assets = extensions.map(({ mediaAssetId, ...extension }) => {
    const asset = core.data.assets.find((x) => x.id === mediaAssetId);
    if (!asset) throw new Error("extension references missing asset");
    return { ...extension, asset };
  });
  return validateCatalog({
    ...envelope.organizer,
    assets,
    clips: core.data.clips,
  });
}
