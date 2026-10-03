import { describe,it,expect } from 'vitest';
import * as api from './index.js';

describe('consolidated public API',()=>{
 it('exports the canonical Sync surface without validation internals',()=>{
   for(const name of ['SyncValidationError','parseTimecode','frameTimebase','buildTimecodeSyncGroup','chooseSyncStrategy','correlateAudio','syncClips','buildMulticamGroups','syncPlayback','syncPlaybackBatch','resyncArtifacts']) {
     expect(api).toHaveProperty(name);
   }
   expect(api).not.toHaveProperty('validateAudioWindow');
   expect(api).not.toHaveProperty('snapshotAudioWindow');
   expect(api).not.toHaveProperty('correlationSums');
 });
});
