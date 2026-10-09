import type { MediaFingerprint } from "@pea/core";
import { positiveInteger } from "./time.js";

export interface PcmInput {
  mediaAssetId: string;
  fingerprint: MediaFingerprint;
  sampleRate: number;
  startSample: bigint;
  channels: readonly Float32Array[];
}

/** Returns frames per channel, never a sum of channel lengths. */
export function validatePcm(input: PcmInput): number {
  if (!input.mediaAssetId || input.fingerprint.algorithm !== "sha256" || !input.fingerprint.value) throw new Error("media identity and fingerprint are required");
  positiveInteger(input.sampleRate, "sample rate");
  if (typeof input.startSample !== "bigint" || input.startSample < 0n) throw new Error("source start sample must be nonnegative bigint");
  if (input.channels.length === 0) throw new Error("PCM requires at least one channel");
  const length = input.channels[0].length;
  for (const channel of input.channels) {
    if (!(channel instanceof Float32Array) || channel.length !== length) throw new Error("PCM channels must have equal lengths");
    for (const value of channel) if (!Number.isFinite(value)) throw new Error("PCM samples must be finite");
  }
  return length;
}
