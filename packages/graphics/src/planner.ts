import { z } from "zod";
import { TranscriptSegmentSchema } from "@pea/core";
import { AnchorSchema, CanvasSchema, CaptionStyleSchema, GraphicsError, IdSchema, PropertyValueSchema, TemplateSchema } from "./contracts.js";
import { layoutCaption, resolveStyle, resolveTemplate, type TextMeasurer } from "./caption.js";
import { ClipMappingSchema, GraphicsFrameRateSchema, mapCaptionRange } from "./time.js";
import { compareIds, RuleSchema, selectRule } from "./rules.js";
import { ObstacleSchema, placeGraphic } from "./placement.js";
import { EmphasisSchema, validateEmphasis, validateGraphicsPlan, type GraphicsPlan } from "./plan-schema.js";

const RequestSchema = z.object({
  id: IdSchema, segment: TranscriptSegmentSchema, mapping: ClipMappingSchema,
  priority: z.number().int().safe().default(0), locale: IdSchema.optional(), tags: z.array(IdSchema).default([]),
  templateId: IdSchema.optional(), style: CaptionStyleSchema.partial().default({}),
  properties: z.record(IdSchema, PropertyValueSchema).default({}),
  emphasis: z.array(EmphasisSchema).default([]), anchors: z.array(AnchorSchema).min(1).optional(),
}).strict();
export type GraphicRequest = z.input<typeof RequestSchema>;
const ConfigSchema = z.object({
  frameRate: GraphicsFrameRateSchema, canvas: CanvasSchema, templates: z.array(TemplateSchema), defaultTemplateId: IdSchema,
  rules: z.array(RuleSchema).default([]), defaults: CaptionStyleSchema.partial().default({}), preset: CaptionStyleSchema.partial().default({}),
  availableFonts: z.array(IdSchema), availableAssets: z.array(IdSchema),
  anchors: z.array(AnchorSchema).min(1).default(["bottom-center", "top-center", "center"]),
  obstacles: z.array(ObstacleSchema).default([]), requests: z.array(z.unknown()),
}).strict();
export type GraphicsInput = Omit<z.input<typeof ConfigSchema>, "requests"> & { requests: GraphicRequest[] };

/** Pure planning. No files, artifacts or host state are written or promoted. */
export function planGraphics(input: unknown, measure: TextMeasurer): GraphicsPlan {
  const config = ConfigSchema.parse(input);
  selectRule(config.rules, { tags: [] }); // Reject ambiguous shared rules even with no requests.
  const templates = new Map(config.templates.map(template => [template.id, template]));
  if (templates.size !== config.templates.length) throw new GraphicsError("DUPLICATE_TEMPLATE", "Duplicate template ID");
  if (!templates.has(config.defaultTemplateId)) throw new GraphicsError("MISSING_TEMPLATE", "Default template is missing");
  const plan: GraphicsPlan = { schemaVersion: "1.0.0", frameRate: config.frameRate, canvas: config.canvas, graphics: [], issues: [] };
  const pending: z.output<typeof RequestSchema>[] = [], ids = new Set<string>();
  const requestIds = config.requests.map(request => z.object({ id: IdSchema }).safeParse(request));
  for (const parsed of requestIds) {
    if (!parsed.success) continue;
    if (ids.has(parsed.data.id)) throw new GraphicsError("DUPLICATE_REQUEST", "Duplicate request ID");
    ids.add(parsed.data.id);
  }
  const issue = (id: string, error: unknown) => {
    if (error instanceof GraphicsError || error instanceof z.ZodError)
      plan.issues.push({ requestId: id, severity: "error", code: error instanceof GraphicsError ? error.code : "INVALID_REQUEST", message: error.message });
    else throw error;
  };
  config.requests.forEach((request, index) => {
    const rawId = requestIds[index];
    let id = rawId.success ? rawId.data.id : `request-${index}`;
    if (!rawId.success) {
      while (ids.has(id)) id = `_${id}`;
      ids.add(id);
    }
    try { pending.push(RequestSchema.parse(request)); } catch (error) { issue(id, error); }
  });
  pending.sort((a, b) => b.priority - a.priority || compareIds(a.id, b.id));
  const obstacles = [...config.obstacles];
  for (const request of pending) {
    try {
      if (!request.segment.text.trim()) {
        plan.issues.push({ requestId: request.id, severity: "info", code: "EMPTY_CAPTION", message: "Empty caption skipped" }); continue;
      }
      const selection = selectRule(config.rules, { speakerId: request.segment.speakerId, locale: request.locale, tags: request.tags });
      const templateId = request.templateId ?? selection.rule?.templateId ?? config.defaultTemplateId;
      const template = templates.get(templateId);
      if (!template) throw new GraphicsError("MISSING_TEMPLATE", `Missing template: ${templateId}`);
      const range = mapCaptionRange(request.segment, request.mapping, config.frameRate);
      const style = resolveStyle(config.defaults, { ...config.preset, ...selection.rule?.style }, request.style, config.canvas.height, config.availableFonts);
      const layout = layoutCaption(request.segment.text, style, config.canvas.width - config.canvas.safe.left - config.canvas.safe.right, measure);
      validateEmphasis(layout.text, request.emphasis);
      const { properties } = resolveTemplate(template, layout.text, request.properties, config.availableAssets);
      const box = placeGraphic({ canvas: config.canvas, size: { width: layout.width, height: layout.height }, range,
        anchors: request.anchors ?? selection.rule?.anchors ?? config.anchors, obstacles });
      if (!box) throw new GraphicsError("NO_PLACEMENT", "No non-overlapping placement fits the safe area");
      plan.graphics.push({
        decision: { id: request.id, templateId, range, variables: Object.fromEntries(Object.entries(properties).filter((entry): entry is [string, string] => typeof entry[1] === "string")) },
        templateVersion: template.version, captionProperty: template.captionProperty, properties,
        caption: { ...layout, style, emphasis: request.emphasis }, box,
        matchedRuleIds: selection.matchedIds, ...(selection.rule ? { ruleId: selection.rule.id } : {}),
      });
      obstacles.push({ box, range });
    } catch (error) { issue(request.id, error); }
  }
  plan.graphics.sort((a, b) => compareIds(a.decision.id, b.decision.id));
  plan.issues.sort((a, b) => compareIds(a.requestId, b.requestId));
  return validateGraphicsPlan(plan);
}
