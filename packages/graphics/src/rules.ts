import { z } from "zod";
import { AnchorSchema, CaptionStyleSchema, GraphicsError, IdSchema } from "./contracts.js";

export const RuleSchema = z.object({
  id: IdSchema, priority: z.number().int().safe(),
  when: z.object({ speakerId: IdSchema.optional(), locale: IdSchema.optional(), tags: z.array(IdSchema).optional() }).strict(),
  templateId: IdSchema.optional(), style: CaptionStyleSchema.partial().optional(), anchors: z.array(AnchorSchema).min(1).optional(),
}).strict();
export type GraphicRule = z.infer<typeof RuleSchema>;
export const RuleContextSchema = z.object({ speakerId: IdSchema.optional(), locale: IdSchema.optional(), tags: z.array(IdSchema) }).strict();
export type RuleContext = z.infer<typeof RuleContextSchema>;
export const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function selectRule(input: readonly GraphicRule[], inputContext: RuleContext) {
  const rules = z.array(RuleSchema).parse(input), context = RuleContextSchema.parse(inputContext);
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new GraphicsError("DUPLICATE_RULE", "Duplicate rule ID");
  const matches = rules.filter(rule => (rule.when.speakerId === undefined || rule.when.speakerId === context.speakerId)
    && (rule.when.locale === undefined || rule.when.locale === context.locale)
    && (rule.when.tags ?? []).every(tag => context.tags.includes(tag)))
    .sort((a, b) => b.priority - a.priority || compareIds(a.id, b.id));
  return { rule: matches[0], matchedIds: matches.map(rule => rule.id) };
}
