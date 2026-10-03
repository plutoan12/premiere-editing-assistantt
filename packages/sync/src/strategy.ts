import type { SyncEvidence, SyncStrategy } from "./types.js";
import { compatibleTimecodes } from "./timecode.js";
import { validateItems } from "./validation.js";
/** A routing hint only. Fingerprints are never proof of an audio offset. */
export function chooseSyncStrategy(items: readonly SyncEvidence[]): SyncStrategy {
  validateItems(items);
  if (compatibleTimecodes(items)) return "timecode";
  if (items.length > 1 && items.every(item => typeof item.audioFingerprint === "string" && item.audioFingerprint.trim().length > 0)) return "audio";
  return "manual";
}
