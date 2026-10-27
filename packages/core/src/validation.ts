import { z } from "zod";
import { CORE_SCHEMA_VERSION, isSchemaVersionSupported, parseSemver } from "./version.js";
import { decodeMediaDocument } from "./media-document.js";
import { ProjectSchema } from "./project.js";

export class CoreValidationError extends Error {
  override readonly name: string = "CoreValidationError";
}

/** Thrown for a document whose schemaVersion this Core does not accept. Names both versions. */
export class UnsupportedSchemaVersion extends CoreValidationError {
  override readonly name = "UnsupportedSchemaVersion";
  readonly documentVersion: string;
  readonly supportedVersion: string;
  constructor(documentVersion: string, supportedVersion: string = CORE_SCHEMA_VERSION) {
    const sup = parseSemver(supportedVersion);
    super(
      `Unsupported schema version: ${documentVersion} (this Core supports ${supportedVersion}: major ${sup?.major ?? "?"}, minor <= ${sup?.minor ?? "?"})`,
    );
    this.documentVersion = documentVersion;
    this.supportedVersion = supportedVersion;
  }
}

export function assertSchemaVersionSupported(version: unknown): string {
  if (typeof version !== "string") throw new CoreValidationError("document has no schemaVersion");
  if (!isSchemaVersionSupported(version)) throw new UnsupportedSchemaVersion(version);
  return version;
}

const EnvelopeSchema = z.object({
  schemaVersion: z.string(),
  kind: z.string(),
  data: z.unknown(),
});
export function parseCoreDocument(input: unknown) {
  const envelope = EnvelopeSchema.parse(input);
  assertSchemaVersionSupported(envelope.schemaVersion);
  if (envelope.kind === "project")
    return {
      schemaVersion: CORE_SCHEMA_VERSION,
      kind: "project" as const,
      data: ProjectSchema.parse(envelope.data),
    };
  if (envelope.kind === "media") return decodeMediaDocument(input);
  throw new CoreValidationError(`Unsupported document kind: ${envelope.kind}`);
}
