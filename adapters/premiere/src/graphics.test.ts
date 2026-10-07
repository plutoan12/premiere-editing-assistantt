import { describe, expect, it } from "vitest";
import { planGraphics } from "@pea/graphics";
import { compilePremiereGraphicsPlan, createMogrtPreviewRequest } from "./index.js";
import * as adapter from "./index.js";

const fps = { rate: { numerator: 30000, denominator: 1001 }, dropFrame: true };
const time = (ticks: bigint) => ({ ticks, timebase: { numerator: 1001, denominator: 30000 } });
const range = { start: time(0n), duration: time(30n) };
const createPlan = () => planGraphics({
  frameRate: fps, canvas: { width: 1920, height: 1080, safe: { top: 100, right: 100, bottom: 100, left: 100 } },
  templates: [{ id: "title", version: "1", captionProperty: "text", properties: {
    text: { type: "string" }, enabled: { type: "boolean", default: true }, opacity: { type: "number", default: 0.8 },
  } }], defaultTemplateId: "title", availableFonts: ["Noto Sans"], availableAssets: [],
  requests: [{ id: "a", segment: { id: "s", mediaAssetId: "m", text: "안녕", range },
    mapping: { mediaAssetId: "m", sourceRange: range, destination: time(60n), frameRate: fps } }],
}, () => 100);
const context = () => ({ sequenceId: "sequence", availableSequenceIds: ["sequence"],
  availableTemplatePaths: ["/templates/title.mogrt"],
  capabilities: { mogrt: true, captionLayout: true, emphasis: false },
  bindings: [{ templateId: "title", templateVersion: "1", templatePath: "/templates/title.mogrt", propertyMap: {
    text: { id: "Source Text", type: "string" as const },
    enabled: { id: "Enabled", type: "boolean" as const },
    opacity: { id: "Opacity", type: "number" as const },
  } }],
});

describe("Premiere graphics plan compiler", () => {
  it("maps host properties without coercing typed values or fractional time", () => {
    const result = compilePremiereGraphicsPlan(createPlan(), context());
    expect(result.status).toBe("planned");
    if (result.status !== "planned") throw new Error("Expected plan");
    expect(result.operations[0].properties).toEqual([
      { id: "Enabled", value: true }, { id: "Opacity", value: 0.8 }, { id: "Source Text", value: "안녕" },
    ]);
    expect(result.operations[0].range.start).toEqual({ ticks: "60", timebase: { numerator: 1001, denominator: 30000 } });
    expect(result.frameRate).toEqual(fps);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("reports missing capabilities instead of claiming the graphics were applied", () => {
    const { capabilities: _capabilities, ...withoutCapabilities } = context();
    expect(compilePremiereGraphicsPlan(createPlan(), withoutCapabilities).status).toBe("unsupported");
  });
  it.each(["../title.mogrt", "/templates/../title.mogrt", "https://example.com/title.mogrt", "/templates/title.exe"])
    ("rejects unsafe or non-MOGRT path %s", (templatePath) => {
      const c = context(); c.bindings[0].templatePath = templatePath;
      expect(() => compilePremiereGraphicsPlan(createPlan(), c)).toThrow();
    });
  it("rejects missing templates, unknown sequences and mismatched template versions", () => {
    expect(() => compilePremiereGraphicsPlan(createPlan(), { ...context(), availableTemplatePaths: [] })).toThrow(/template/i);
    expect(() => compilePremiereGraphicsPlan(createPlan(), { ...context(), availableSequenceIds: [] })).toThrow(/sequence/i);
    const c = context(); c.bindings[0].templateVersion = "2";
    expect(() => compilePremiereGraphicsPlan(createPlan(), c)).toThrow(/binding/i);
  });
  it("rejects missing property mappings and duplicate host targets", () => {
    const c = context();
    expect(() => compilePremiereGraphicsPlan(createPlan(), { ...c, bindings: [{ ...c.bindings[0], propertyMap: {} }] })).toThrow(/property/i);
    c.bindings[0].propertyMap.enabled.id = "Opacity";
    expect(() => compilePremiereGraphicsPlan(createPlan(), c)).toThrow(/duplicate/i);
  });
  it("requires explicit partial-result acceptance when the plan contains errors", () => {
    const plan = createPlan(); plan.issues.push({ requestId: "b", code: "NO_PLACEMENT", severity: "error", message: "no fit" });
    expect(() => compilePremiereGraphicsPlan(plan, context())).toThrow(/partial/i);
    expect(compilePremiereGraphicsPlan(plan, { ...context(), allowPartial: true }).status).toBe("planned");
  });
});


describe("graphics plan to Premiere preview", () => {
  it("carries editable caption text with exact template identity without assuming font units or layout support", () => {
    const draft=adapter.createMogrtTextDraft(createPlan(),"a",context().bindings[0]);
    expect(draft).toMatchObject({schemaVersion:"1.0.0",mode:"editable-text-draft",edit:{text:"안녕"},
      preview:{decisionId:"a",templateId:"title",templateVersion:"1",startTicks:"508540032000"}});
    expect(draft.edit).not.toHaveProperty("fontSize");
    expect(draft.edit).not.toHaveProperty("fontName");
    expect(()=>adapter.createMogrtTextDraft(createPlan(),"a",{...context().bindings[0],templateVersion:"other"})).toThrow(/BINDING/);
  });
  it("converts planned NTSC timing exactly and labels unapplied graphics as a preview", () => {
    const result = createMogrtPreviewRequest(createPlan(), "a", context().bindings[0]);
    expect(result).toMatchObject({mode:"template-preview",startTicks:"508540032000",durationTicks:"254270016000",frameTicks:"8475667200",canvas:{width:1920,height:1080}});
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("requires the exact decision and template version", () => {
    expect(() => createMogrtPreviewRequest(createPlan(), "missing", context().bindings[0])).toThrow(/DECISION/);
    expect(() => createMogrtPreviewRequest(createPlan(), "a", {...context().bindings[0],templateVersion:"2"})).toThrow(/BINDING/);
  });
  it("rejects a valid engine plan whose ticks overflow the host boundary", () => {
    const plan=createPlan();plan.graphics[0].decision.range.start.ticks=10n**40n;
    expect(() => createMogrtPreviewRequest(plan,"a",context().bindings[0])).toThrow(/INVALID_TICKS/);
  });
});
