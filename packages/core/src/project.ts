import { z } from "zod";
import { IsoDateTimeSchema, NleRefsSchema, PositiveRationalSchema, SchemaVersionSchema } from "./common.js";
import { EntityIdSchema, newEntityId } from "./ids.js";
import { rational, type FrameRate } from "./time.js";
import { CORE_SCHEMA_VERSION } from "./version.js";

export const ProjectSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: EntityIdSchema,
  name: z.string().min(1),
  /** Default sequence frame rate. Media keeps its own rate; nothing converts silently. */
  frameRate: PositiveRationalSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  nleRefs: NleRefsSchema.optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export interface CreateProjectInput {
  readonly name: string;
  readonly frameRate: FrameRate;
  readonly nleRefs?: Readonly<Record<string, string>>;
}

export function createProject(input: CreateProjectInput, now: () => Date = () => new Date()): Project {
  const stamp = now().toISOString();
  return ProjectSchema.parse({
    schemaVersion: CORE_SCHEMA_VERSION,
    id: newEntityId(),
    name: input.name,
    frameRate: rational(input.frameRate.numerator, input.frameRate.denominator),
    createdAt: stamp,
    updatedAt: stamp,
    ...(input.nleRefs === undefined ? {} : { nleRefs: input.nleRefs }),
  });
}
