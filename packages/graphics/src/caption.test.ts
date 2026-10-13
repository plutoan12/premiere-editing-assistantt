import { describe, expect, it } from "vitest";
import { layoutCaption, resolveStyle, resolveTemplate } from "./caption.js";

const template = {
  id: "title", version: "1", captionProperty: "title",
  properties: { title: { type: "string" as const, required: true },
    size: { type: "number" as const, default: 30, min: 10, max: 80 },
    visible: { type: "boolean" as const, default: true } },
  requiredAssets: ["logo"],
};
const style = { fontFamily: "Noto", fontSize: 20, referenceHeight: 100,
  lineHeight: 1.2, padding: 2, maxLines: 3, align: "center" as const,
  color: "#FFFFFF", background: "#00000000", outlineColor: "#000000",
  outlineWidth: 0, shadowColor: "#00000000", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
const measure = (text: string) => Array.from(new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text)).length * 10;

describe("template properties", () => {
  it("resolves typed defaults and binds caption text without string coercion", () => {
    expect(resolveTemplate(template, "안녕", { size: 40 }, ["logo"]).properties)
      .toEqual({ title: "안녕", size: 40, visible: true });
  });
  it.each([{ size: "40" }, { unknown: 1 }, { size: 81 }, { visible: 1 }, { title: "override" }])
    ("rejects invalid or caption-owned overrides %j", (values) => {
      expect(() => resolveTemplate(template, "text", values, ["logo"])).toThrow();
    });
  it("rejects missing assets and non-string caption bindings", () => {
    expect(() => resolveTemplate(template, "text", {}, [])).toThrow(/asset/i);
    expect(() => resolveTemplate({ ...template, captionProperty: "size" }, "text", {}, ["logo"])).toThrow();
  });
});

describe("caption layout", () => {
  it("applies defaults, preset and item override in order, scaling by frame height", () => {
    const result = resolveStyle(style, { fontSize: 30, color: "#FF0000" }, { fontSize: 40 }, 200, ["Noto"]);
    expect(result.fontSize).toBe(80);
    expect(result.padding).toBe(4);
    expect(result.color).toBe("#FF0000");
  });
  it("fails explicitly on missing fonts and malformed style", () => {
    expect(() => resolveStyle(style, {}, {}, 100, [])).toThrow(/font/i);
    expect(() => resolveStyle(style, {}, { fontSize: -1 }, 100, ["Noto"])).toThrow();
  });
  it("wraps Korean and emoji at grapheme boundaries with literal bounds", () => {
    const resolved = resolveStyle(style, {}, {}, 100, ["Noto"]);
    const result = layoutCaption("한글👨‍👩‍👧‍👦AB", resolved, 34, measure);
    expect(result.lines).toEqual(["한글👨‍👩‍👧‍👦", "AB"]);
    expect(result.width).toBe(34);
    expect(result.height).toBe(52);
  });
  it("keeps explicit newlines and handles CRLF", () => {
    expect(layoutCaption("A\r\nB", style, 100, measure).lines).toEqual(["A", "B"]);
  });
  it("rejects line overflow, impossible glyphs and invalid measurements", () => {
    expect(() => layoutCaption("ABCDEFG", { ...style, maxLines: 1 }, 34, measure)).toThrow(/fit|line/i);
    expect(() => layoutCaption("A", style, 8, measure)).toThrow(/fit/i);
    expect(() => layoutCaption("A", style, 100, () => NaN)).toThrow(/measur/i);
  });
  it("includes outline and shadow extents in collision bounds", () => {
    const result = layoutCaption("A", { ...style, outlineWidth: 2, shadowBlur: 3, shadowOffsetX: -5, shadowOffsetY: 4 }, 100, measure);
    expect(result.width).toBe(29);
    expect(result.height).toBe(42);
    expect(result.contentOffset).toEqual({ x: 12, y: 7 });
  });
});
