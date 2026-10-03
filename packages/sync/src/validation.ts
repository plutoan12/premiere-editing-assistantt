import type { FrameRate, MediaTime, Rational, SyncEvidence, SyncMember } from "./types.js";
export function requireId(value: string, label = "clip ID"): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be nonempty`);
}
export function validateItems(items: readonly SyncEvidence[], minimum = 0): void {
  if (items.length < minimum) throw new Error(`at least ${minimum} clips required`);
  const ids = new Set<string>();
  for (const item of items) {
    requireId(item.clipId);
    if (ids.has(item.clipId)) throw new Error(`duplicate clip ID: ${item.clipId}`);
    ids.add(item.clipId);
  }
}
export function validRational(r: Rational | undefined): r is Rational {
  return !!r && Number.isSafeInteger(r.numerator) && r.numerator > 0
    && Number.isSafeInteger(r.denominator) && r.denominator > 0;
}
export function sameRational(a: Rational, b: Rational): boolean {
  return validRational(a) && validRational(b)
    && BigInt(a.numerator) * BigInt(b.denominator) === BigInt(b.numerator) * BigInt(a.denominator);
}
export function rationalKey(r: Rational): string {
  if (!validRational(r)) throw new Error("invalid timebase/rational");
  let a = BigInt(r.numerator), b = BigInt(r.denominator);
  while (b !== 0n) [a, b] = [b, a % b];
  return `${BigInt(r.numerator) / a}/${BigInt(r.denominator) / a}`;
}
const rates = new Set(["24/1", "24000/1001", "25/1", "30/1", "30000/1001", "48/1", "50/1", "60/1", "60000/1001"]);
export function validFrameRate(rate: FrameRate | undefined): rate is FrameRate {
  if (!rate || !validRational(rate.rate) || typeof rate.dropFrame !== "boolean") return false;
  const key = rationalKey(rate.rate);
  return rates.has(key) && (!rate.dropFrame || key === "30000/1001" || key === "60000/1001");
}
export function sameFrameRate(a: FrameRate, b: FrameRate): boolean {
  return validFrameRate(a) && validFrameRate(b) && sameRational(a.rate, b.rate) && a.dropFrame === b.dropFrame;
}
export function validateTime(time: MediaTime, label: string): void {
  if (typeof time?.ticks !== "bigint" || !validRational(time.timebase)) throw new Error(`invalid ${label} timebase/ticks`);
}
export function requireSameTimebase(a: Rational, b: Rational): void {
  if (!sameRational(a, b)) throw new Error("incompatible timebase; explicit conversion required");
}
export function memberAt(item: SyncEvidence, ticks: bigint, timebase: Rational): SyncMember {
  return { clipId: item.clipId, sourceId: item.sourceId, cameraId: item.cameraId, role: item.role,
    offsetTicks: ticks, offset: { ticks, timebase: { ...timebase } } };
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error("Operation cancelled"), { name: "AbortError" });
}
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
