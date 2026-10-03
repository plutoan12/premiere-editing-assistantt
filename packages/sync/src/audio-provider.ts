import type { ProviderContext } from '@pea/core';
import type { SyncEvidence } from './types.js';
import { SyncValidationError } from './types.js';
/** Host decodes/downmixes/resamples explicitly. Matcher never launches FFmpeg. */
export interface AudioSampleWindow {
  samples: Float32Array;
  sampleRate: number;
  /** First decoded sample relative to the selected clip's local zero, not file zero. */
  startSample: bigint;
}
export interface AudioSampleProvider {
  id: string;
  version: string;
  read(clip: SyncEvidence, context?: ProviderContext): Promise<AudioSampleWindow>;
}
export const MAX_ANALYSIS_SAMPLES = 262144;
export function validateAudioWindow(window: AudioSampleWindow): void {
  if(!window || !(window.samples instanceof Float32Array)) throw new SyncValidationError('Float32Array audio samples required');
  if(!Number.isSafeInteger(window.sampleRate) || window.sampleRate<=0 || window.sampleRate>384000) {
    throw new SyncValidationError('invalid sample rate');
  }
  if(typeof window.startSample!=='bigint' || window.startSample<0n) throw new SyncValidationError('invalid analysis startSample');
  if(window.samples.length>MAX_ANALYSIS_SAMPLES) throw new SyncValidationError('analysis window exceeds sample limit');
  for(const sample of window.samples) {
    if(!Number.isFinite(sample) || Math.abs(sample)>1) throw new SyncValidationError('finite normalized samples in [-1,1] required');
  }
}

export function snapshotAudioWindow(window: AudioSampleWindow): AudioSampleWindow {
  validateAudioWindow(window);
  return { samples: new Float32Array(window.samples), sampleRate: window.sampleRate, startSample: window.startSample };
}
