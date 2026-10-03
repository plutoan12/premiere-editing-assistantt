import type { SyncEvidence, SyncGroup } from "./types.js";
import { memberAt, requireId, sameFrameRate, sameRational, validFrameRate, validRational, validateItems } from "./validation.js";

export function hasValidTimecode(item: SyncEvidence): boolean {
  return typeof item.timecodeTicks === "bigint" && item.timecodeTicks >= 0n
    && validRational(item.timebase) && validFrameRate(item.frameRate)
    && (item.timecodeDomain === undefined || (typeof item.timecodeDomain === "string" && item.timecodeDomain.trim().length > 0));
}
export function compatibleTimecodes(items: readonly SyncEvidence[]): boolean {
  if (items.length < 2 || !items.every(hasValidTimecode)) return false;
  const first = items[0];
  return items.every(item => sameRational(item.timebase!, first.timebase!)
    && sameFrameRate(item.frameRate!, first.frameRate!) && item.timecodeDomain === first.timecodeDomain);
}
export function buildTimecodeSyncGroup(id: string, items: readonly SyncEvidence[], referenceClipId = items[0]?.clipId): SyncGroup {
  requireId(id, "group ID");
  validateItems(items, 2);
  if (!compatibleTimecodes(items)) throw new Error("complete compatible timecode, timebase and frame rate evidence required");
  if (!items.some(item => item.clipId === referenceClipId)) throw new Error("unknown reference clip");
  const earliest = items.reduce((min, item) => item.timecodeTicks! < min ? item.timecodeTicks! : min, items[0].timecodeTicks!);
  const timebase = { ...items[0].timebase! };
  return { id, strategy: "timecode", confidence: 1, referenceClipId, timebase,
    members: items.map(item => memberAt(item, item.timecodeTicks! - earliest, timebase)),
    provenance: items.map(item => ({ clipId: item.clipId, method: "timecode", timecodeTicks: item.timecodeTicks,
      timebase: { ...item.timebase! }, frameRate: { rate: { ...item.frameRate!.rate }, dropFrame: item.frameRate!.dropFrame },
      timecodeDomain: item.timecodeDomain })) };
}
