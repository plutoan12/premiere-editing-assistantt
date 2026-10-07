import { TranscriptSchema, type TimeRange, type Transcript } from "@pea/core";
import { type PcmInput, validatePcm } from "./pcm.js";
import { addTime, sampleTime, timeToSamples, validateRange } from "./time.js";

export interface SampleLevels { samplePeakDbfs: number | null; rmsDbfs: number | null; channelCount: number; frameCount: number }
const db = (amplitude: number) => amplitude === 0 ? null : 20 * Math.log10(amplitude);

function levels(channels: readonly Float32Array[], start: number, end: number): SampleLevels {
  let sum = 0, peak = 0;
  for (const channel of channels) for (let i = start; i < end; i++) {
    const value = channel[i];
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const count = (end - start) * channels.length;
  return { samplePeakDbfs: db(peak), rmsDbfs: db(count ? Math.sqrt(sum / count) : 0), channelCount: channels.length, frameCount: end - start };
}

export function measureSampleLevels(input: PcmInput): SampleLevels { return levels(input.channels, 0, validatePcm(input)); }

export interface DialogueGainOptions { targetRmsDbfs: number; maxGainDb: number; maxSamplePeakDbfs: number }
export interface DialogueSegmentAnalysis extends SampleLevels { segmentId: string; range: TimeRange; gainDb?: number }
export interface DialogueAnalysis { schemaVersion: "1.0.0"; mediaAssetId: string; status: "ok" | "no-dialogue"; evidence: "transcript"; segments: DialogueSegmentAnalysis[] }

export function analyzeDialogue(input: PcmInput, transcript: Transcript, gain?: DialogueGainOptions): DialogueAnalysis {
  const length = validatePcm(input);
  TranscriptSchema.parse(transcript);
  if (gain && (![gain.targetRmsDbfs, gain.maxGainDb, gain.maxSamplePeakDbfs].every(Number.isFinite) || gain.maxGainDb < 0 || gain.maxSamplePeakDbfs > 0 || gain.targetRmsDbfs > 0)) throw new Error("invalid dialogue gain configuration");
  const segments: DialogueSegmentAnalysis[] = [];
  const limit = input.startSample + BigInt(length);
  for (const segment of transcript.segments) {
    validateRange(segment.range);
    if (segment.mediaAssetId !== input.mediaAssetId) continue;
    const first = timeToSamples(segment.range.start, input.sampleRate, "ceil");
    const last = timeToSamples(addTime(segment.range.start, segment.range.duration), input.sampleRate, "ceil");
    const start = first < input.startSample ? input.startSample : first;
    const end = last > limit ? limit : last;
    if (start >= end) continue;
    const measured = levels(input.channels, Number(start - input.startSample), Number(end - input.startSample));
    const result: DialogueSegmentAnalysis = { segmentId: segment.id, range: { start: sampleTime(start, input.sampleRate), duration: sampleTime(end - start, input.sampleRate) }, ...measured };
    if (gain && measured.rmsDbfs !== null && measured.samplePeakDbfs !== null) {
      result.gainDb = Math.min(gain.targetRmsDbfs - measured.rmsDbfs, gain.maxGainDb, gain.maxSamplePeakDbfs - measured.samplePeakDbfs);
    }
    segments.push(result);
  }
  return { schemaVersion: "1.0.0", mediaAssetId: input.mediaAssetId, status: segments.length ? "ok" : "no-dialogue", evidence: "transcript", segments };
}
