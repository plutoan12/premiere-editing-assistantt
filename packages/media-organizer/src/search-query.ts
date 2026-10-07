import {z} from 'zod';
export const SearchQuerySchema=z.object({text:z.string(),filters:z.object({captureDate:z.string().optional(),deviceId:z.string().optional(),mediaKind:z.enum(['video','audio','image','other']).optional(),tags:z.array(z.string()).optional(),favorite:z.boolean().optional(),availability:z.enum(['online','offline','unknown']).optional()}).strict()}).strict();
export type SearchQuery=z.infer<typeof SearchQuerySchema>;
export const SavedSearchSchema=z.object({id:z.uuid(),name:z.string().min(1),query:SearchQuerySchema}).strict();
export type SavedSearch=z.infer<typeof SavedSearchSchema>;
