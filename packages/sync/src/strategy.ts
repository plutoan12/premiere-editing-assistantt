import type { SyncEvidence, SyncStrategy } from './types.js';
import { compatibleTimecode } from './timecode.js';
/** Select a capability, not an accepted match; audio must still be measured. */
export function chooseSyncStrategy(items: readonly SyncEvidence[]): SyncStrategy {
  if(compatibleTimecode(items)) return 'timecode';
  if(items.length>1 && items.every(x=>x.hasAudio===true)) return 'audio';
  return 'manual';
}
