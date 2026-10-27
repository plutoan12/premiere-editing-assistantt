import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256.js";

describe("sha256Hex", () => {
  it("matches FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with node:crypto across block boundaries and binary input", () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const bytes = randomBytes(len);
      expect(sha256Hex(new Uint8Array(bytes))).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    const text = "한국어 텍스트와 emoji 🎬";
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });
});
