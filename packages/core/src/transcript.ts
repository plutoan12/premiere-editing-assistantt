import { z } from "zod"; import { TimeRangeSchema } from "./time.js";
export const SpeakerSchema=z.object({id:z.string().min(1),label:z.string().min(1)});
export const TranscriptSegmentSchema=z.object({id:z.string().min(1),mediaAssetId:z.string().min(1),range:TimeRangeSchema,text:z.string(),speakerId:z.string().optional()});
export const TranscriptSchema=z.object({id:z.string().min(1),segments:z.array(TranscriptSegmentSchema)});
export type Speaker=z.infer<typeof SpeakerSchema>; export type TranscriptSegment=z.infer<typeof TranscriptSegmentSchema>; export type Transcript=z.infer<typeof TranscriptSchema>;
