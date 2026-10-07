import { z } from 'zod';
import { MediaTimeSchema, RationalSchema, type MediaTime, type Rational } from './time.js';
export type WireMediaTime = { ticks: string; timebase: Rational };
const WireMediaTimeSchema = z.object({
  ticks: z.string().regex(/^(0|-?[1-9][0-9]*)$/), timebase: RationalSchema,
}).strict();
export function encodeMediaTime(value: MediaTime): WireMediaTime {
  const time = MediaTimeSchema.parse(value);
  return { ticks: time.ticks.toString(), timebase: time.timebase };
}
export function decodeMediaTime(input: unknown): MediaTime {
  const wire = WireMediaTimeSchema.parse(input);
  return { ticks: BigInt(wire.ticks), timebase: wire.timebase };
}
