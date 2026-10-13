import { z } from "zod";
import { GraphicDecisionSchema } from "@pea/core";
import { BoxSchema, CanvasSchema, CaptionStyleSchema, ColorSchema, GraphicsError, IdSchema, PropertyValueSchema } from "./contracts.js";
import { assertFrameAligned, GraphicsFrameRateSchema, GraphicsRangeSchema, GraphicsTimeSchema, rangesOverlap } from "./time.js";
import { boxInsideSafeArea, boxesOverlap } from "./placement.js";
import { captionInsets, preservesLineBreaks } from "./layout-metrics.js";

export const EmphasisSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(), color: ColorSchema }).strict();
export type Emphasis = z.infer<typeof EmphasisSchema>;
export function validateEmphasis(text: string, spans: readonly Emphasis[]): void {
  const length = Array.from(new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)).length;
  let previousEnd = 0;
  for (const span of spans) {
    EmphasisSchema.parse(span);
    if (span.start < previousEnd || span.start >= span.end || span.end > length)
      throw new GraphicsError("INVALID_EMPHASIS", "Emphasis spans must be ordered, non-overlapping grapheme ranges inside the text");
    previousEnd = span.end;
  }
}
const point = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict();
const CaptionLayoutSchema = z.object({
  text: z.string().min(1), lines: z.array(z.string()).min(1),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
  contentOffset: point, style: CaptionStyleSchema, emphasis: z.array(EmphasisSchema),
}).strict();
const DecisionSchema = GraphicDecisionSchema.extend({ range: GraphicsRangeSchema }).strict();
const GraphicSchema = z.object({
  decision: DecisionSchema, templateVersion: IdSchema, captionProperty: IdSchema,
  properties: z.record(IdSchema, PropertyValueSchema), caption: CaptionLayoutSchema, box: BoxSchema,
  matchedRuleIds: z.array(IdSchema), ruleId: IdSchema.optional(),
}).strict();
const IssueSchema = z.object({ requestId: IdSchema, code: IdSchema, message: z.string(), severity: z.enum(["error", "info"]) }).strict();
const PlanObjectSchema = z.object({
  schemaVersion: z.literal("1.0.0"), frameRate: GraphicsFrameRateSchema, canvas: CanvasSchema,
  graphics: z.array(GraphicSchema), issues: z.array(IssueSchema),
}).strict();
export type GraphicsPlan = z.infer<typeof PlanObjectSchema>;
export type PlannedGraphic = GraphicsPlan["graphics"][number];

export function validateGraphicsPlan(input: unknown): GraphicsPlan {
  const plan = PlanObjectSchema.parse(input), ids = new Set<string>();
  for (const graphic of plan.graphics) {
    const { decision, caption, box } = graphic;
    if (ids.has(decision.id)) throw new GraphicsError("DUPLICATE_DECISION", "Duplicate graphic decision ID");
    ids.add(decision.id);
    assertFrameAligned(decision.range, plan.frameRate);
    validateEmphasis(caption.text, caption.emphasis);
    const insets = captionInsets(caption.style);
    const expectedHeight = caption.lines.length * caption.style.fontSize * caption.style.lineHeight + insets.top + insets.bottom;
    if (!caption.text.trim() || caption.text.includes("\r") || !preservesLineBreaks(caption.text, caption.lines)
      || caption.lines.length > caption.style.maxLines || caption.width !== box.width || caption.height !== box.height
      || caption.height !== expectedHeight || caption.width < insets.left + insets.right
      || caption.contentOffset.x !== insets.left || caption.contentOffset.y !== insets.top
      || caption.contentOffset.x >= caption.width || caption.contentOffset.y >= caption.height
      || caption.style.referenceHeight !== plan.canvas.height || !boxInsideSafeArea(box, plan.canvas))
      throw new GraphicsError("INVALID_LAYOUT", "Caption layout is inconsistent or outside the safe area");
    if (!Object.hasOwn(graphic.properties, graphic.captionProperty) || graphic.properties[graphic.captionProperty] !== caption.text)
      throw new GraphicsError("INVALID_CAPTION", "Template caption value differs from layout text");
    const stringProperties = Object.entries(graphic.properties).filter(([, value]) => typeof value === "string");
    if (Object.keys(decision.variables).length !== stringProperties.length
      || stringProperties.some(([key, value]) => !Object.hasOwn(decision.variables, key) || decision.variables[key] !== value))
      throw new GraphicsError("INVALID_VARIABLES", "Core string variables differ from typed properties");
    if (graphic.ruleId !== graphic.matchedRuleIds[0])
      throw new GraphicsError("INVALID_RULE", "Selected rule must be the first matching rule");
  }
  for (let i = 0; i < plan.graphics.length; i++) {
    for (let j = i + 1; j < plan.graphics.length; j++) {
      const a = plan.graphics[i], b = plan.graphics[j];
      if (rangesOverlap(a.decision.range, b.decision.range) && boxesOverlap(a.box, b.box))
        throw new GraphicsError("OVERLAPPING_GRAPHICS", `Overlapping graphics: ${a.decision.id}, ${b.decision.id}`);
    }
  }
  return plan;
}

/** JSON wire time uses canonical decimal strings, never lossy JSON numbers. */
const WireTimeSchema = z.object({
  ticks: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => BigInt(value)),
  timebase: z.object({ numerator: z.number(), denominator: z.number() }).strict(),
}).strict().pipe(GraphicsTimeSchema);
const WireRangeSchema = z.object({ start: WireTimeSchema, duration: WireTimeSchema }).strict().pipe(GraphicsRangeSchema);
const WirePlanSchema = PlanObjectSchema.extend({ graphics: z.array(GraphicSchema.extend({
  decision: DecisionSchema.extend({ range: WireRangeSchema }),
})) });
export function serializeGraphicsPlan(input: GraphicsPlan): string {
  const plan = validateGraphicsPlan(input);
  return JSON.stringify({ ...plan, graphics: plan.graphics.map(graphic => ({ ...graphic, decision: { ...graphic.decision,
    range: {
      start: { ...graphic.decision.range.start, ticks: graphic.decision.range.start.ticks.toString() },
      duration: { ...graphic.decision.range.duration, ticks: graphic.decision.range.duration.ticks.toString() },
    },
  } })) });
}
export function parseGraphicsPlan(json: string): GraphicsPlan {
  return validateGraphicsPlan(WirePlanSchema.parse(JSON.parse(json)));
}
