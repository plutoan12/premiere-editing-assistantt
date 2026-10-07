import { z } from "zod";

/** null LUFS can mean a gated-out signal; only both null denotes digital silence. */
export const LoudnessMeasurementSchema = z.object({ integratedLufs: z.number().finite().nullable(), truePeakDbtp: z.number().finite().nullable() }).strict();
export type LoudnessMeasurement = z.infer<typeof LoudnessMeasurementSchema>;
export interface LoudnessTarget { integratedLufs: number; maxTruePeakDbtp: number; maxGainDb: number }
export type NormalizationProposal =
  | { status: "silence" | "unmeasurable" | "unsupported"; gainDb: null }
  | { status: "ok"; gainDb: number; requestedGainDb: number; predictedLufs: number; predictedTruePeakDbtp: number; targetReached: boolean; limitedBy: "true-peak" | "max-gain" | null };

/** Constant-gain proposal only. A peak-limited result does not claim target compliance. */
export function proposeNormalization(measurement: LoudnessMeasurement, target: LoudnessTarget): NormalizationProposal {
  LoudnessMeasurementSchema.parse(measurement);
  if (![target.integratedLufs, target.maxTruePeakDbtp, target.maxGainDb].every(Number.isFinite) || target.maxGainDb < 0 || target.maxTruePeakDbtp > 0) throw new Error("invalid normalization target");
  if (measurement.integratedLufs === null) return { status: measurement.truePeakDbtp === null ? "silence" : "unmeasurable", gainDb: null };
  if (measurement.truePeakDbtp === null) return { status: "unsupported", gainDb: null };
  const requestedGainDb = target.integratedLufs - measurement.integratedLufs;
  const headroom = target.maxTruePeakDbtp - measurement.truePeakDbtp;
  const gainDb = Math.min(requestedGainDb, target.maxGainDb, headroom);
  const predictedLufs = measurement.integratedLufs + gainDb;
  const predictedTruePeakDbtp = measurement.truePeakDbtp + gainDb;
  if (![requestedGainDb, headroom, gainDb, predictedLufs, predictedTruePeakDbtp].every(Number.isFinite)) throw new Error("normalization calculation exceeds finite numeric range");
  const targetReached = Math.abs(gainDb - requestedGainDb) < 1e-9;
  return { status: "ok", gainDb, requestedGainDb, predictedLufs, predictedTruePeakDbtp, targetReached, limitedBy: targetReached ? null : gainDb === headroom ? "true-peak" : "max-gain" };
}
