import { describe, expect, it } from "vitest";
import { mapCaptionRange, rangesOverlap } from "./time.js";
import { selectRule } from "./rules.js";
import { placeGraphic } from "./placement.js";

const time = (ticks: bigint, numerator = 1, denominator = 24) => ({ ticks, timebase: { numerator, denominator } });
const range = (start: bigint, duration: bigint) => ({ start: time(start), duration: time(duration) });
const rate = { rate: { numerator: 24, denominator: 1 }, dropFrame: false };
const mapping = { mediaAssetId: "m", sourceRange: range(240n, 240n), destination: time(48n), frameRate: rate };

describe("exact caption time mapping", () => {
  it("maps media time to sequence frames without retaining the source offset", () => {
    expect(mapCaptionRange({ mediaAssetId: "m", range: range(264n, 48n) }, mapping, rate)).toEqual(range(72n, 48n));
  });
  it.each([[24000, 1001, false], [30000, 1001, true]] as const)("preserves rational rate %i/%i", (numerator, denominator, dropFrame) => {
    const fps = { rate: { numerator, denominator }, dropFrame };
    const at = (ticks: bigint) => time(ticks, denominator, numerator);
    const r = { start: at(10000000000000001n), duration: at(2n) };
    const result = mapCaptionRange({ mediaAssetId: "m", range: r }, {
      mediaAssetId: "m", sourceRange: r, destination: at(50000000000000001n), frameRate: fps,
    }, fps);
    expect(result).toEqual({ start: at(50000000000000001n), duration: at(2n) });
  });
  it("rejects mismatched media, partial clip ranges, zero durations and subframes", () => {
    expect(() => mapCaptionRange({ mediaAssetId: "other", range: range(264n, 48n) }, mapping, rate)).toThrow(/media/i);
    expect(() => mapCaptionRange({ mediaAssetId: "m", range: range(230n, 48n) }, mapping, rate)).toThrow(/clip/i);
    expect(() => mapCaptionRange({ mediaAssetId: "m", range: range(264n, 0n) }, mapping, rate)).toThrow();
    expect(() => mapCaptionRange({ mediaAssetId: "m", range: { start: time(10001n, 1, 1000), duration: time(1n, 1, 1) } }, mapping, rate)).toThrow(/frame/i);
  });
  it("rejects frame-rate conversion and drop-frame identity changes", () => {
    const segment = { mediaAssetId: "m", range: range(264n, 48n) };
    expect(() => mapCaptionRange(segment, mapping, { rate: { numerator: 25, denominator: 1 }, dropFrame: false })).toThrow(/rate/i);
    expect(() => mapCaptionRange(segment, mapping, { ...rate, dropFrame: true })).toThrow(/rate/i);
  });
  it("uses half-open ranges and compares mixed rational timebases exactly", () => {
    expect(rangesOverlap(range(0n, 24n), { start: time(1000n, 1, 1000), duration: time(1n, 1, 1) })).toBe(false);
    expect(rangesOverlap(range(0n, 24n), range(23n, 2n))).toBe(true);
  });
});

describe("graphic rules", () => {
  const rules = [
    { id: "z", priority: 2, when: { locale: "ko", tags: ["interview"] }, templateId: "z" },
    { id: "a", priority: 2, when: { speakerId: "s" }, templateId: "a" },
    { id: "base", priority: 0, when: {}, templateId: "base" },
  ];
  it("matches all conditions and resolves equal priorities by stable ID", () => {
    const context = { speakerId: "s", locale: "ko", tags: ["interview"] };
    expect(selectRule(rules, context).rule?.templateId).toBe("a");
    expect(selectRule([...rules].reverse(), context)).toEqual(selectRule(rules, context));
    expect(selectRule(rules, { locale: "ko", tags: [] }).rule?.id).toBe("base");
  });
  it("reports every matched rule and rejects duplicate IDs", () => {
    expect(selectRule(rules, { speakerId: "s", locale: "ko", tags: ["interview"] }).matchedIds).toEqual(["a", "z", "base"]);
    expect(() => selectRule([rules[0], rules[0]], { tags: [] })).toThrow(/duplicate/i);
  });
});

describe("automatic placement", () => {
  const canvas = { width: 100, height: 200, safe: { top: 10, right: 10, bottom: 10, left: 10 } };
  const size = { width: 40, height: 20 };
  it("uses safe-area coordinates and falls back around concurrent obstacles", () => {
    const request = { canvas, size, range: range(0n, 24n), anchors: ["bottom-center", "top-center"] as const, obstacles: [] };
    expect(placeGraphic(request)).toEqual({ x: 30, y: 170, width: 40, height: 20 });
    expect(placeGraphic({ ...request, obstacles: [{ box: { x: 30, y: 170, ...size }, range: range(0n, 24n) }] }))
      .toEqual({ x: 30, y: 10, width: 40, height: 20 });
  });
  it("reuses a location after an obstacle ends", () => {
    expect(placeGraphic({ canvas, size, range: range(24n, 24n), anchors: ["bottom-center"],
      obstacles: [{ box: { x: 30, y: 170, ...size }, range: range(0n, 24n) }] })?.y).toBe(170);
  });
  it("returns no placement when the safe area cannot fit the caption", () => {
    expect(placeGraphic({ canvas, size: { width: 90, height: 20 }, range: range(0n, 24n), anchors: ["center"], obstacles: [] })).toBeNull();
  });
  it("handles landscape canvas and rejects invalid geometry", () => {
    expect(placeGraphic({ canvas: { ...canvas, width: 200, height: 100 }, size, range: range(0n, 24n), anchors: ["bottom-right"], obstacles: [] }))
      .toEqual({ x: 150, y: 70, width: 40, height: 20 });
    expect(() => placeGraphic({ canvas, size: { width: NaN, height: 20 }, range: range(0n, 24n), anchors: ["center"], obstacles: [] })).toThrow();
  });
});
