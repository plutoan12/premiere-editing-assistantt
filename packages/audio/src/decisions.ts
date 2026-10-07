import { AudioDecisionSchema, compareMediaTime, type AudioDecision, type MediaTime } from "@pea/core";
import { z } from "zod";
import { addTime, validateRange, validateTime } from "./time.js";

export interface AudioEnvelopeDecision {
  schemaVersion: "1.0.0";
  mediaAssetId: string;
  clipId: string;
  timeSpace: "sequence";
  interpolation: "linear-db";
  decision: AudioDecision;
  points: { time: MediaTime; gainDb: number }[];
}

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timeWire = z.object({ ticks: z.string().regex(/^\d+$/), timebase: z.object({ numerator: positive, denominator: positive }).strict() }).strict();
const wireSchema = z.object({
  schemaVersion: z.literal("1.0.0"), mediaAssetId: z.string().min(1), clipId: z.string().min(1), timeSpace: z.literal("sequence"), interpolation: z.literal("linear-db"),
  decision: z.object({ id: z.string().min(1), kind: z.literal("duck"), range: z.object({ start: timeWire, duration: timeWire }).strict(), value: z.number().finite().nonpositive() }).strict(),
  points: z.array(z.object({ time: timeWire, gainDb: z.number().finite().nonpositive() }).strict()).min(2),
}).strict();

function validateEnvelope(value: AudioEnvelopeDecision): void {
  AudioDecisionSchema.parse(value.decision);
  validateRange(value.decision.range);
  const end = addTime(value.decision.range.start, value.decision.range.duration);
  if (value.points.length < 2) throw new Error("envelope requires at least two points");
  for (let i = 0; i < value.points.length; i++) {
    const point = value.points[i];
    validateTime(point.time);
    if (compareMediaTime(point.time, value.decision.range.start) < 0 || compareMediaTime(point.time, end) > 0) throw new Error("point outside decision range");
    if (i > 0 && compareMediaTime(value.points[i - 1].time, point.time) >= 0) throw new Error("points must be strictly ordered");
    if (!Number.isFinite(point.gainDb) || point.gainDb > 0) throw new Error("invalid attenuation");
  }
  if (compareMediaTime(value.points[0].time, value.decision.range.start) !== 0 || compareMediaTime(value.points[value.points.length - 1].time, end) !== 0) throw new Error("envelope must cover both range boundaries");
}

export function serializeAudioDecision(value: AudioEnvelopeDecision): string {
  validateEnvelope(value);
  const result = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
  wireSchema.parse(JSON.parse(result));
  return result;
}

export function parseAudioDecision(json: string): AudioEnvelopeDecision {
  const wire = wireSchema.parse(JSON.parse(json));
  const time = (value: z.infer<typeof timeWire>): MediaTime => ({ ticks: BigInt(value.ticks), timebase: value.timebase });
  const value: AudioEnvelopeDecision = { ...wire, decision: { ...wire.decision, range: { start: time(wire.decision.range.start), duration: time(wire.decision.range.duration) } }, points: wire.points.map(point => ({ ...point, time: time(point.time) })) };
  validateEnvelope(value);
  return value;
}
