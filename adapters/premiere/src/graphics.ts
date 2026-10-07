import { PREMIERE_TICKS_PER_SECOND, validateMogrtPreviewRequest } from "./uxp-mogrt.js";
import { z } from "zod";
import { compareIds, GraphicsError, IdSchema, validateGraphicsPlan, type PropertyValue } from "@pea/graphics";

const MogrtPathSchema = z.string().refine(value =>
  !/[\x00-\x1f]/.test(value) && /\.mogrt$/i.test(value)
  && (/^\/(?!\/)/.test(value) || /^[A-Za-z]:[\\/]/.test(value))
  && !value.split(/[\\/]/).includes(".."), "Expected an absolute local .mogrt path without traversal");
const BindingSchema = z.object({
  templateId: IdSchema, templateVersion: IdSchema, templatePath: MogrtPathSchema,
  propertyMap: z.record(IdSchema, z.object({ id: IdSchema, type: z.enum(["string", "number", "boolean"]) }).strict()),
}).strict();
const ContextSchema = z.object({
  sequenceId: IdSchema, availableSequenceIds: z.array(IdSchema), availableTemplatePaths: z.array(MogrtPathSchema),
  bindings: z.array(BindingSchema), allowPartial: z.boolean().default(false),
  capabilities: z.object({ mogrt: z.boolean(), captionLayout: z.boolean(), emphasis: z.boolean() }).strict()
    .default({ mogrt: false, captionLayout: false, emphasis: false }),
}).strict();
export type PremiereGraphicsContext = z.input<typeof ContextSchema>;

/** Compile our bridge contract only. This function never calls Premiere or writes a project. */
export function compilePremiereGraphicsPlan(input: unknown, inputContext: unknown) {
  const plan = validateGraphicsPlan(input), context = ContextSchema.parse(inputContext);
  if (!context.capabilities.mogrt || !context.capabilities.captionLayout
    || (plan.graphics.some(graphic => graphic.caption.emphasis.length > 0) && !context.capabilities.emphasis)) {
    return { status: "unsupported" as const, reason: "Host must explicitly support MOGRT, measured caption layout and any used emphasis", operations: [] };
  }
  if (!context.availableSequenceIds.includes(context.sequenceId))
    throw new GraphicsError("MISSING_SEQUENCE", "Target sequence is not in the host inventory");
  if (!context.allowPartial && plan.issues.some(issue => issue.severity === "error"))
    throw new GraphicsError("PARTIAL_PLAN", "Partial graphics plan requires explicit allowPartial");
  const bindings = new Set<string>();
  for (const binding of context.bindings) {
    const key = JSON.stringify([binding.templateId, binding.templateVersion]);
    if (bindings.has(key)) throw new GraphicsError("DUPLICATE_BINDING", "Duplicate template binding");
    bindings.add(key);
    const targets = Object.values(binding.propertyMap).map(property => property.id);
    if (new Set(targets).size !== targets.length) throw new GraphicsError("DUPLICATE_PROPERTY", "Duplicate host property target");
  }
  const operations = plan.graphics.map(graphic => {
    const binding = context.bindings.find(candidate => candidate.templateId === graphic.decision.templateId && candidate.templateVersion === graphic.templateVersion);
    if (!binding) throw new GraphicsError("MISSING_BINDING", `Missing exact-version template binding: ${graphic.decision.templateId}@${graphic.templateVersion}`);
    if (!context.availableTemplatePaths.includes(binding.templatePath))
      throw new GraphicsError("MISSING_TEMPLATE", `Template is absent from the host inventory: ${binding.templatePath}`);
    const properties = Object.entries(graphic.properties).map(([key, value]): { id: string; value: PropertyValue } => {
      const property = Object.hasOwn(binding.propertyMap, key) ? binding.propertyMap[key] : undefined;
      if (!property || property.type !== typeof value)
        throw new GraphicsError("UNSUPPORTED_PROPERTY", `Missing or incompatible property mapping: ${key}`);
      return { id: property.id, value };
    }).sort((a, b) => compareIds(a.id, b.id));
    return {
      kind: "insert-mogrt" as const, decisionId: graphic.decision.id, sequenceId: context.sequenceId,
      templatePath: binding.templatePath, templateVersion: binding.templateVersion, properties,
      range: {
        start: { ...graphic.decision.range.start, ticks: graphic.decision.range.start.ticks.toString() },
        duration: { ...graphic.decision.range.duration, ticks: graphic.decision.range.duration.ticks.toString() },
      },
      box: graphic.box, caption: graphic.caption,
    };
  });
  return { schemaVersion: "1.0.0" as const, status: "planned" as const, frameRate: plan.frameRate,
    canvas: plan.canvas, operations, issues: plan.issues };
}

/** Produce a deliberately limited request for inspecting an ORIGINAL template in Premiere.
 * The host receipt always says graphicsApplied:false; caption/placement/property data is not discarded into an "applied" result.
 */
export function createMogrtPreviewRequest(input: unknown, decisionId: string, inputBinding: unknown) {
  const plan = validateGraphicsPlan(input), binding = BindingSchema.parse(inputBinding);
  const graphic = plan.graphics.find(candidate => candidate.decision.id === decisionId);
  if (!graphic) throw new GraphicsError("MISSING_DECISION", "MISSING_DECISION");
  if (graphic.decision.templateId !== binding.templateId || graphic.templateVersion !== binding.templateVersion)
    throw new GraphicsError("MISSING_BINDING", "MISSING_BINDING");
  const ticks = (time: {ticks:bigint;timebase:{numerator:number;denominator:number}}) => {
    const numerator = time.ticks * BigInt(time.timebase.numerator) * PREMIERE_TICKS_PER_SECOND;
    const denominator = BigInt(time.timebase.denominator);
    if (numerator % denominator) throw new GraphicsError("UNREPRESENTABLE_TIME", "UNREPRESENTABLE_TIME");
    return (numerator / denominator).toString();
  };
  return validateMogrtPreviewRequest({schemaVersion:"1.0.0",mode:"template-preview",decisionId,
    templateId:binding.templateId,templateVersion:binding.templateVersion,templatePath:binding.templatePath,
    startTicks:ticks(graphic.decision.range.start),durationTicks:ticks(graphic.decision.range.duration),
    frameTicks:ticks({ticks:1n,timebase:{numerator:plan.frameRate.rate.denominator,denominator:plan.frameRate.rate.numerator}}),
    canvas:{width:plan.canvas.width,height:plan.canvas.height},
  });
}
