import { z } from "zod"; import { SEMVER_PATTERN, isSchemaVersionSupported } from "./version.js";
export const ProjectSchema=z.object({schemaVersion:z.string().regex(SEMVER_PATTERN).refine((v)=>isSchemaVersionSupported(v),"unsupported schema version"),id:z.string().min(1),name:z.string().min(1),createdAt:z.string().datetime()});
export type Project=z.infer<typeof ProjectSchema>;
