import { describe, expect, it } from "vitest";
import { planGraphics, serializeGraphicsPlan, parseGraphicsPlan } from "./index.js";

const time = (ticks: bigint) => ({ ticks, timebase: { numerator: 1, denominator: 24 } });
const range = (start: bigint, duration: bigint) => ({ start: time(start), duration: time(duration) });
const frameRate = { rate: { numerator: 24, denominator: 1 }, dropFrame: false };
const item = (id: string, text = "AB") => ({ id, segment: { id: `seg-${id}`, mediaAssetId: "m", range: range(264n, 24n), text },
  mapping: { mediaAssetId: "m", sourceRange: range(240n, 240n), destination: time(0n), frameRate } });
const input = () => ({
  frameRate, canvas: { width: 200, height: 100, safe: { top: 10, right: 10, bottom: 10, left: 10 } },
  templates: [{ id: "title", version: "1", captionProperty: "text", properties: {
    text: { type: "string" as const, required: true }, opacity: { type: "number" as const, default: 0.8 },
  }, requiredAssets: [] }], defaultTemplateId: "title", rules: [],
  defaults: { fontFamily: "Noto", fontSize: 10, referenceHeight: 100, padding: 2 },
  availableFonts: ["Noto"], availableAssets: [], requests: [item("a")],
});
const measure = (text: string) => Array.from(text).length * 10;

describe("graphics planning", () => {
  it("produces canonical decisions plus typed layout metadata without mutating input", () => {
    const request = input(), before = structuredClone(request);
    const plan = planGraphics(request, measure);
    expect(plan.issues).toEqual([]);
    expect(plan.graphics[0].decision).toEqual({ id: "a", templateId: "title", range: range(24n, 24n), variables: { text: "AB" } });
    expect(plan.graphics[0].properties.opacity).toBe(0.8);
    expect(plan.graphics[0].box).toEqual({ x: 88, y: 74, width: 24, height: 16 });
    expect(request).toEqual(before);
  });
  it("retains successful requests, reports failures and skips empty captions", () => {
    const plan = planGraphics({ ...input(), requests: [item("a"), { ...item("b"), templateId: "missing" }, item("c", "   ")] }, measure);
    expect(plan.graphics.map(g => g.decision.id)).toEqual(["a"]);
    expect(plan.issues.map(issue => [issue.requestId, issue.code])).toEqual([["b", "MISSING_TEMPLATE"], ["c", "EMPTY_CAPTION"]]);
  });
  it("applies selected rule styling and records why it won", () => {
    const plan = planGraphics({ ...input(), rules: [{ id: "rule", priority: 1, when: {}, style: { color: "#FF0000" } }],
      requests: [{ ...item("a"), style: { color: "#00FF00" } }] }, measure);
    expect(plan.graphics[0].caption.style.color).toBe("#00FF00");
    expect(plan.graphics[0].matchedRuleIds).toEqual(["rule"]);
    expect(plan.graphics[0].ruleId).toBe("rule");
  });
  it("gives higher-priority requests first choice and stays stable under reordering", () => {
    const requests = [item("a"), { ...item("b"), priority: 5 }];
    const first = planGraphics({ ...input(), requests }, measure);
    const second = planGraphics({ ...input(), requests: [...requests].reverse() }, measure);
    expect(first).toEqual(second);
    expect(first.graphics.find(g => g.decision.id === "b")?.box.y).toBe(74);
    expect(first.graphics.find(g => g.decision.id === "a")?.box.y).toBe(10);
  });
  it("reports unavailable placement instead of forcing overlaps", () => {
    const plan = planGraphics({ ...input(), anchors: ["bottom-center"], requests: [item("a"), item("b")] }, measure);
    expect(plan.graphics).toHaveLength(1);
    expect(plan.issues[0].code).toBe("NO_PLACEMENT");
  });
  it("validates highlight spans against graphemes and preserves their colors", () => {
    const emphasis = [{ start: 1, end: 2, color: "#FF0000" }];
    const plan = planGraphics({ ...input(), requests: [{ ...item("a", "한👨‍👩‍👧‍👦"), emphasis }] }, () => 20);
    expect(plan.graphics[0].caption.emphasis).toEqual(emphasis);
    const invalid = planGraphics({ ...input(), requests: [{ ...item("a"), emphasis: [{ start: 0, end: 3, color: "#FF0000" }] }] }, measure);
    expect(invalid.issues[0].code).toBe("INVALID_EMPHASIS");
  });
  it("rejects ambiguous duplicate IDs and malformed shared configuration", () => {
    expect(() => planGraphics({ ...input(), requests: [item("a"), item("a")] }, measure)).toThrow(/duplicate/i);
    expect(() => planGraphics({ ...input(), canvas: { ...input().canvas, width: -1 } }, measure)).toThrow();
  });
  it("keeps successful captions when the host text measurer throws for another request", () => {
    const plan = planGraphics({ ...input(), requests: [item("a"), item("b", "broken")] }, text => {
      if (text === "broken") throw new Error("Shaping failed");
      return measure(text);
    });
    expect(plan.graphics.map(g => g.decision.id)).toEqual(["a"]);
    expect(plan.issues[0]).toMatchObject({ requestId: "b", code: "MEASUREMENT_FAILED" });
  });
  it("does not let a malformed request's diagnostic ID collide with a real request", () => {
    const plan = planGraphics({ ...input(), requests: [{ segment: {} }, item("request-0")] }, measure);
    expect(plan.graphics.map(g => g.decision.id)).toEqual(["request-0"]);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0].code).toBe("INVALID_REQUEST");
    expect(plan.issues[0].requestId).not.toBe("request-0");
  });
});

describe("versioned GraphicsPlan serialization", () => {
  it("round-trips bigint time and typed properties through JSON", () => {
    const plan = planGraphics(input(), measure);
    const json = serializeGraphicsPlan(plan);
    expect(JSON.parse(json).graphics[0].decision.range.start.ticks).toBe("24");
    expect(parseGraphicsPlan(json)).toEqual(plan);
  });
  it.each(["start", "duration"] as const)("round-trips %s ticks beyond 100 decimal digits without rounding", field => {
    const plan = planGraphics(input(), measure);
    const ticks = 10n ** 100n + 123456789n;
    plan.graphics[0].decision.range[field].ticks = ticks;
    const json = serializeGraphicsPlan(plan);
    expect(JSON.parse(json).graphics[0].decision.range[field].ticks).toBe(ticks.toString());
    const restored = parseGraphicsPlan(json);
    expect(restored.graphics[0].decision.range[field].ticks).toBe(ticks);
    expect(restored).toEqual(plan);
  });
  it.each(["1e3", "01", "-1", "1.5", "", " 1"])("rejects noncanonical tick string %j", ticks => {
    const plain = JSON.parse(serializeGraphicsPlan(planGraphics(input(), measure)));
    plain.graphics[0].decision.range.start.ticks = ticks;
    expect(() => parseGraphicsPlan(JSON.stringify(plain))).toThrow();
  });
  it("rejects unsupported versions, invalid geometry and overlapping decisions", () => {
    const plain = JSON.parse(serializeGraphicsPlan(planGraphics(input(), measure)));
    expect(() => parseGraphicsPlan(JSON.stringify({ ...plain, schemaVersion: "2.0.0" }))).toThrow();
    const outside = structuredClone(plain); outside.graphics[0].box.x = 999;
    expect(() => parseGraphicsPlan(JSON.stringify(outside))).toThrow();
    const overlap = structuredClone(plain); overlap.graphics.push({ ...overlap.graphics[0], decision: { ...overlap.graphics[0].decision, id: "b" } });
    expect(() => parseGraphicsPlan(JSON.stringify(overlap))).toThrow(/overlap/i);
  });
  it("rejects time coercion and inconsistent canonical/typed caption values", () => {
    const plain = JSON.parse(serializeGraphicsPlan(planGraphics(input(), measure)));
    const numeric = structuredClone(plain); numeric.graphics[0].decision.range.start.ticks = 24;
    expect(() => parseGraphicsPlan(JSON.stringify(numeric))).toThrow();
    plain.graphics[0].properties.text = "changed";
    expect(() => parseGraphicsPlan(JSON.stringify(plain))).toThrow();
  });
  it("rejects imported layout dimensions incompatible with line height and effect insets", () => {
    const plain = JSON.parse(serializeGraphicsPlan(planGraphics(input(), measure)));
    plain.graphics[0].caption.height = 8;
    plain.graphics[0].box.height = 8;
    expect(() => parseGraphicsPlan(JSON.stringify(plain))).toThrow(/layout/i);
    const offset = JSON.parse(serializeGraphicsPlan(planGraphics(input(), measure)));
    offset.graphics[0].caption.contentOffset.x = 0;
    expect(() => parseGraphicsPlan(JSON.stringify(offset))).toThrow(/layout/i);
  });
  it("rejects imported lines that erase hard breaks or split a grapheme", () => {
    const multiline = JSON.parse(serializeGraphicsPlan(planGraphics({ ...input(), requests: [item("a", "A\nB")] }, measure)));
    multiline.graphics[0].caption.lines = ["AB"];
    multiline.graphics[0].caption.height = multiline.graphics[0].box.height = 16;
    expect(() => parseGraphicsPlan(JSON.stringify(multiline))).toThrow(/layout/i);
    const emoji = JSON.parse(serializeGraphicsPlan(planGraphics({ ...input(), requests: [item("a", "A👨‍👩‍👧‍👦B")] }, () => 10)));
    emoji.graphics[0].caption.lines = ["A👨", "‍👩‍👧‍👦B"];
    emoji.graphics[0].caption.height = emoji.graphics[0].box.height = 28;
    emoji.graphics[0].box.y = 60;
    expect(() => parseGraphicsPlan(JSON.stringify(emoji))).toThrow(/layout/i);
  });
});
