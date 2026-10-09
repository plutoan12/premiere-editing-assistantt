import type { AudioEnvelopeDecision } from "./decisions.js";
import { positiveInteger, sampleTime } from "./time.js";

export interface SampleInterval { start: bigint; end: bigint }
export interface DuckingRequest {
  id: string; clipId: string; mediaAssetId: string; sampleRate: number; range: SampleInterval; dialogue: readonly SampleInterval[];
  amountDb: number; attackSamples: bigint; holdSamples: bigint; releaseSamples: bigint;
}
const min = (a: bigint, b: bigint) => a < b ? a : b;
const max = (a: bigint, b: bigint) => a > b ? a : b;
function interval(value: SampleInterval): void {
  if (typeof value.start !== "bigint" || typeof value.end !== "bigint" || value.start < 0n || value.end <= value.start) throw new Error("invalid sample interval");
}

export function buildDuckingEnvelope(request: DuckingRequest): AudioEnvelopeDecision {
  positiveInteger(request.sampleRate, "sample rate");
  interval(request.range);
  if (!request.id || !request.clipId || !request.mediaAssetId || !Number.isFinite(request.amountDb) || request.amountDb > 0) throw new Error("invalid ducking identity or attenuation");
  for (const [name, value] of [["attack", request.attackSamples], ["hold", request.holdSamples], ["release", request.releaseSamples]] as const) {
    if (typeof value !== "bigint" || value < (name === "hold" ? 0n : 1n) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`invalid ${name} sample count`);
  }
  const ranges = request.dialogue.map(value => { interval(value); return { ...value }; }).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  const groups: SampleInterval[] = [];
  for (const next of ranges) {
    const previous = groups[groups.length - 1];
    if (previous && next.start - request.attackSamples <= previous.end + request.holdSamples + request.releaseSamples) previous.end = max(previous.end, next.end);
    else groups.push(next);
  }
  const supports = groups.map(group => ({ start: group.start - request.attackSamples, lowStart: group.start, lowEnd: group.end + request.holdSamples, end: group.end + request.holdSamples + request.releaseSamples }));
  const times = new Set<bigint>([request.range.start, request.range.end]);
  for (const support of supports) {
    if (support.end < request.range.start || support.start > request.range.end) continue;
    for (const time of [support.start, support.lowStart, support.lowEnd, support.end]) times.add(max(request.range.start, min(request.range.end, time)));
  }
  const ordered = [...times].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  let supportIndex = 0;
  const points = ordered.map(position => {
    while (supportIndex < supports.length && position > supports[supportIndex].end) supportIndex++;
    const support = supports[supportIndex];
    let gainDb = 0;
    if (support && position >= support.start && position <= support.end) {
      if (position < support.lowStart) gainDb = request.amountDb * (Number(position - support.start) / Number(request.attackSamples));
      else if (position <= support.lowEnd) gainDb = request.amountDb;
      else gainDb = request.amountDb * (Number(support.end - position) / Number(request.releaseSamples));
    }
    return { time: sampleTime(position, request.sampleRate), gainDb: gainDb || 0 };
  });
  return {
    schemaVersion: "1.0.0", mediaAssetId: request.mediaAssetId, clipId: request.clipId, timeSpace: "sequence", interpolation: "linear-db",
    decision: { id: request.id, kind: "duck", range: { start: sampleTime(request.range.start, request.sampleRate), duration: sampleTime(request.range.end - request.range.start, request.sampleRate) }, value: request.amountDb }, points,
  };
}
