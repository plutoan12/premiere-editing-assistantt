import { z } from "zod"; import { TimeRangeSchema, MediaTimeSchema } from "./time.js";
export const EditDecisionSchema=z.object({id:z.string(),clipId:z.string(),sourceRange:TimeRangeSchema,destination:MediaTimeSchema});
export const SequencePlanSchema=z.object({id:z.string(),name:z.string(),decisions:z.array(EditDecisionSchema)});
export const GraphicDecisionSchema=z.object({id:z.string(),templateId:z.string(),range:TimeRangeSchema,variables:z.record(z.string(),z.string()).default({})});
export const AudioDecisionSchema=z.object({id:z.string(),kind:z.enum(["gain","duck","cleanup","marker"]),range:TimeRangeSchema,value:z.number().optional()});
export const DeliveryVariantSchema=z.object({id:z.string(),name:z.string(),width:z.number().int().positive(),height:z.number().int().positive(),locale:z.string().optional()});
export type EditDecision=z.infer<typeof EditDecisionSchema>; export type SequencePlan=z.infer<typeof SequencePlanSchema>; export type GraphicDecision=z.infer<typeof GraphicDecisionSchema>; export type AudioDecision=z.infer<typeof AudioDecisionSchema>; export type DeliveryVariant=z.infer<typeof DeliveryVariantSchema>;
