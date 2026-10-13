import { z } from "zod";
export const ConfidenceSchema=z.number().min(0).max(1);
export const ProvenanceSchema=z.object({provider:z.string().min(1),model:z.string().optional(),version:z.string().optional(),promptVersion:z.string().optional()});
export const AnalysisTagSchema=z.object({key:z.string().min(1),value:z.string(),confidence:ConfidenceSchema.optional(),provenance:ProvenanceSchema.optional()});
export type Confidence=z.infer<typeof ConfidenceSchema>; export type Provenance=z.infer<typeof ProvenanceSchema>; export type AnalysisTag=z.infer<typeof AnalysisTagSchema>;
