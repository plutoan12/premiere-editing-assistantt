import { z } from "zod"; import { CORE_SCHEMA_VERSION } from "./version.js";
export const ProjectSchema=z.object({schemaVersion:z.literal(CORE_SCHEMA_VERSION),id:z.string().min(1),name:z.string().min(1),createdAt:z.string().datetime()});
export type Project=z.infer<typeof ProjectSchema>;
