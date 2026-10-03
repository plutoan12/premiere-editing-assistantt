import type { PcmWindow, SilenceCandidate, SilenceOptions } from './types.js';
import { fraction, mediaRange, positiveInteger, quantize, requireText } from './time-math.js';

/** Quietness is evidence for human review, not a speech/NG/semantic classifier. */
export function detectSilenceCandidates(pcm: PcmWindow, options: SilenceOptions = {}): SilenceCandidate[] {
  requireText(pcm.clipId, 'clipId');
  requireText(pcm.decoderId, 'decoderId');
  positiveInteger(pcm.sampleRate, 'sampleRate');
  const quantum = { numerator: 1, denominator: pcm.sampleRate };
  const origin = quantize(fraction(pcm.sourceStart, 'sourceStart'), quantum, 'exact', 'sourceStart');
  const thresholdDb = options.thresholdDb ?? -42;
  if (!Number.isFinite(thresholdDb) || thresholdDb < -160 || thresholdDb > 0) throw new Error('thresholdDb must be finite and between -160 and 0');
  const minSilenceMs = options.minSilenceMs ?? 500;
  const handleMs = options.handleMs ?? 100;
  const windowMs = options.windowMs ?? 10;
  positiveInteger(minSilenceMs, 'minSilenceMs');
  positiveInteger(windowMs, 'windowMs');
  if (!Number.isSafeInteger(handleMs) || handleMs < 0) throw new Error('handleMs must be a non-negative safe integer');
  const samplesFor = (ms: number): number => {
    const value = (BigInt(ms) * BigInt(pcm.sampleRate) + 999n) / 1000n;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('detector duration exceeds safe sample count');
    return Number(value);
  };
  const minimum = samplesFor(minSilenceMs);
  const handles = samplesFor(handleMs);
  const windowSamples = samplesFor(windowMs);
  if (!Array.isArray(pcm.channels) || pcm.channels.length === 0) throw new Error('At least one PCM channel is required');
  if (!(pcm.channels[0] instanceof Float32Array) || pcm.channels[0].length === 0) throw new Error('PCM samples must be a nonempty Float32Array');
  const length = pcm.channels[0].length;
  for (const channel of pcm.channels) {
    if (!(channel instanceof Float32Array) || channel.length !== length) throw new Error('PCM channel lengths must match');
  }
  const candidates: SilenceCandidate[] = [];
  const thresholdPower = Math.pow(10, thresholdDb / 10);
  let quietStart: number | undefined;
  const finish = (end: number): void => {
    if (quietStart === undefined) return;
    const start = quietStart;
    quietStart = undefined;
    if (end - start < minimum || end - start <= 2 * handles) return;
    const first = origin + BigInt(start + handles);
    const last = origin + BigInt(end - handles);
    candidates.push({
      id: `silence:${JSON.stringify([pcm.clipId, pcm.decoderId, pcm.sampleRate, thresholdDb, minSilenceMs, handleMs, windowMs, first.toString(), last.toString()])}`,
      kind: 'silence', clipId: pcm.clipId,
      sourceRange: mediaRange([first,last], quantum),
      evidence: { decoderId: pcm.decoderId, thresholdDb, windowSamples },
    });
  };
  for (let start=0; start<length; start+=windowSamples) {
    const end = Math.min(start+windowSamples, length);
    let quiet = true;
    // Check every channel even after discovering sound, so corrupt PCM is rejected.
    for (const channel of pcm.channels) {
      let sum = 0;
      for (let i=start; i<end; i++) {
        const value = channel[i];
        if (!Number.isFinite(value)) throw new Error('PCM samples must be finite');
        sum += value*value;
      }
      if (sum/(end-start) > thresholdPower) quiet = false;
    }
    if (quiet && quietStart === undefined) quietStart = start;
    if (!quiet) finish(start);
  }
  finish(length);
  return candidates;
}
