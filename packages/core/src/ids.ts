/**
 * Entity identity: UUID v7 (time-ordered). Generation is monotonic within a
 * process even when the wall clock steps backwards. IDs are never derived
 * from file paths or NLE-internal identifiers.
 */
import { z } from "zod";

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const EntityIdSchema = z.string().regex(UUID_V7_PATTERN, "must be a lowercase UUID v7").brand<"EntityId">();

export type EntityId = z.infer<typeof EntityIdSchema>;

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

export function assertEntityId(value: unknown): EntityId {
  if (!isEntityId(value)) {
    throw new TypeError(`expected a UUID v7 entity id, got ${JSON.stringify(value)}`);
  }
  return value;
}

let lastMs = 0;
let sequence = 0;

function randomSequence(): number {
  const buf = new Uint16Array(1);
  globalThis.crypto.getRandomValues(buf);
  // Leave headroom below 0xfff so same-millisecond bursts can count upwards.
  return buf[0]! & 0x7ff;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function newEntityId(now: () => number = Date.now): EntityId {
  let ms = Math.max(Math.floor(now()), lastMs);
  if (ms === lastMs) {
    sequence += 1;
    if (sequence > 0xfff) {
      ms += 1;
      sequence = randomSequence();
    }
  } else {
    sequence = randomSequence();
  }
  lastMs = ms;

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes.subarray(8));
  // 48-bit big-endian millisecond timestamp
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  // version 7 + 12-bit sequence
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  // RFC 4122 variant
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as EntityId;
}
