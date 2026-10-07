import { z } from "zod";
import { CORE_SCHEMA_VERSION } from "./version.js";
import { decodeMediaDocument } from "./media-document.js";
import { ProjectSchema } from "./project.js";

export class CoreValidationError extends Error {}

const EnvelopeSchema=z.object({schemaVersion:z.string(),kind:z.string(),data:z.unknown()});
export function parseCoreDocument(input:unknown){
  const envelope=EnvelopeSchema.parse(input);
  if(envelope.schemaVersion!==CORE_SCHEMA_VERSION) throw new CoreValidationError(`Unsupported schema version: ${envelope.schemaVersion}`);
  if(envelope.kind==="project") return {schemaVersion:CORE_SCHEMA_VERSION,kind:"project" as const,data:ProjectSchema.parse(envelope.data)};
  if(envelope.kind==="media") return decodeMediaDocument(input);
  throw new CoreValidationError(`Unsupported document kind: ${envelope.kind}`);
}
