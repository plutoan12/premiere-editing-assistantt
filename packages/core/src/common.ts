/** Shared Zod building blocks for every Core contract. */
import { z } from "zod";
import { compareMediaTime, isSameTimebase, rational } from "./time.js";

export class ContractViolation extends Error {
  override readonly name = "ContractViolation";
}

export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const SchemaVersionSchema = z.string().regex(SEMVER_PATTERN, "schemaVersion must be MAJOR.MINOR.PATCH");

export const SafeIntegerSchema = z
  .number()
  .int()
  .refine((n) => Number.isSafeInteger(n), "must be a safe integer (|n| <= 2^53 - 1)");

export const NonNegativeIntegerSchema = SafeIntegerSchema.min(0);
export const PositiveIntegerSchema = SafeIntegerSchema.min(1);

function isReduced(numerator: number, denominator: number): boolean {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    return false; // field-level checks already report these; keep the object refine total
  }
  const r = rational(numerator, denominator);
  return r.numerator === numerator && r.denominator === denominator;
}

export const RationalSchema = z
  .strictObject({
    numerator: SafeIntegerSchema,
    denominator: PositiveIntegerSchema,
  })
  .refine((r) => isReduced(r.numerator, r.denominator), "rational must be in lowest terms");

export const PositiveRationalSchema = RationalSchema.refine((r) => r.numerator > 0, "must be a positive rate");

export const MediaTimeSchema = z.strictObject({
  ticks: SafeIntegerSchema,
  timebase: PositiveRationalSchema,
});

export const NonNegativeMediaTimeSchema = MediaTimeSchema.refine((t) => t.ticks >= 0, "ticks must be >= 0");

export const TimeRangeSchema = z
  .strictObject({
    start: MediaTimeSchema,
    end: MediaTimeSchema,
  })
  .refine((r) => isSameTimebase(r.start, r.end), "start and end must share one timebase")
  .refine((r) => compareMediaTime(r.end, r.start) >= 0, "range must not have a negative duration");

export const ConfidenceSchema = z.number().min(0).max(1);

export const IsoDateTimeSchema = z.iso.datetime();

/** Adapter-owned references into an NLE (e.g. `{ premiere: "<nodeId>" }`). Never used as identity. */
export const NleRefsSchema = z.record(z.string().min(1), z.string().min(1));
