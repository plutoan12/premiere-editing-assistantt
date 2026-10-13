import { z } from "zod";

export const IdSchema = z.string().trim().min(1);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
export const CaptionStyleSchema = z.object({
  fontFamily: IdSchema, fontSize: positive, referenceHeight: positive,
  lineHeight: z.number().finite().min(1), padding: nonnegative,
  maxLines: z.number().int().min(1).max(100), align: z.enum(["left", "center", "right"]),
  color: ColorSchema, background: ColorSchema, outlineColor: ColorSchema,
  outlineWidth: nonnegative, shadowColor: ColorSchema, shadowBlur: nonnegative,
  shadowOffsetX: z.number().finite(), shadowOffsetY: z.number().finite(),
}).strict();
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export const DEFAULT_STYLE: CaptionStyle = {
  fontFamily: "Noto Sans", fontSize: 48, referenceHeight: 1080, lineHeight: 1.2,
  padding: 12, maxLines: 3, align: "center", color: "#FFFFFF", background: "#00000000",
  outlineColor: "#000000", outlineWidth: 0, shadowColor: "#00000000", shadowBlur: 0,
  shadowOffsetX: 0, shadowOffsetY: 0,
};
export const PropertyValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
export type PropertyValue = z.infer<typeof PropertyValueSchema>;
const PropertyDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), required: z.boolean().optional(), default: z.string().optional() }).strict(),
  z.object({ type: z.literal("number"), required: z.boolean().optional(), default: z.number().finite().optional(),
    min: z.number().finite().optional(), max: z.number().finite().optional() }).strict(),
  z.object({ type: z.literal("boolean"), required: z.boolean().optional(), default: z.boolean().optional() }).strict(),
]);
export const TemplateSchema = z.object({
  id: IdSchema, version: IdSchema, captionProperty: IdSchema,
  properties: z.record(IdSchema, PropertyDefinitionSchema), requiredAssets: z.array(IdSchema).default([]),
}).strict().superRefine((template, ctx) => {
  if (template.properties[template.captionProperty]?.type !== "string")
    ctx.addIssue({ code: "custom", message: "Caption property must reference a string property" });
  for (const [key, property] of Object.entries(template.properties)) {
    if (property.type === "number" && ((property.min !== undefined && property.max !== undefined && property.min > property.max)
      || (property.default !== undefined && ((property.min !== undefined && property.default < property.min)
        || (property.max !== undefined && property.default > property.max)))))
      ctx.addIssue({ code: "custom", message: `Invalid numeric bounds/default for ${key}` });
  }
});
export type Template = z.infer<typeof TemplateSchema>;
export const AnchorSchema = z.enum(["bottom-center", "top-center", "center", "bottom-left", "bottom-right", "top-left", "top-right"]);
export type Anchor = z.infer<typeof AnchorSchema>;
export const BoxSchema = z.object({ x: nonnegative, y: nonnegative, width: positive, height: positive }).strict();
export type Box = z.infer<typeof BoxSchema>;
export const CanvasSchema = z.object({
  width: positive, height: positive,
  safe: z.object({ top: nonnegative, right: nonnegative, bottom: nonnegative, left: nonnegative }).strict(),
}).strict().refine(c => c.safe.left + c.safe.right < c.width && c.safe.top + c.safe.bottom < c.height,
  "Safe insets must leave positive space");
export type Canvas = z.infer<typeof CanvasSchema>;

export class GraphicsError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "GraphicsError"; }
}
