import {z} from 'zod';
export const HostBindingSchema=z.object({bindingId:z.uuid(),clipId:z.string().min(1),adapterId:z.string().min(1),hostProjectKey:z.string().min(1),hostItemId:z.string().min(1),hostRevision:z.string().min(1)}).strict();
export type HostBinding=z.infer<typeof HostBindingSchema>;
