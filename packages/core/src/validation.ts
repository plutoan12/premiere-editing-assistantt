/**
 * Runtime parsing of serialized Core documents with the schema compatibility
 * policy from the spec: same MAJOR and MINOR <= supported MINOR is accepted,
 * anything else is rejected explicitly. PATCH is ignored.
 */
import type { z } from "zod";
import { ArtifactSchema } from "./artifacts.js";
import { SEMVER_PATTERN } from "./common.js";
import { SequencePlanSchema } from "./edit.js";
import { JobSchema } from "./jobs.js";
import { MediaAssetSchema } from "./media.js";
import { ProjectSchema } from "./project.js";
import { SyncGroupSchema } from "./sync.js";
import { TranscriptSchema } from "./transcript.js";
import { CORE_SCHEMA_VERSION } from "./version.js";

const DOCUMENT_SCHEMAS = {
  project: ProjectSchema,
  mediaAsset: MediaAssetSchema,
  syncGroup: SyncGroupSchema,
  transcript: TranscriptSchema,
  sequencePlan: SequencePlanSchema,
  job: JobSchema,
  artifact: ArtifactSchema,
} as const;

export type CoreDocumentType = keyof typeof DOCUMENT_SCHEMAS;
export const CORE_DOCUMENT_TYPES = Object.keys(DOCUMENT_SCHEMAS) as readonly CoreDocumentType[];
export type CoreDocument<T extends CoreDocumentType> = z.infer<(typeof DOCUMENT_SCHEMAS)[T]>;

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class CoreValidationError extends Error {
  override readonly name: string = "CoreValidationError";
  readonly issues: readonly ValidationIssue[];
  constructor(message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.issues = issues;
  }
}

export class UnsupportedSchemaVersion extends CoreValidationError {
  override readonly name = "UnsupportedSchemaVersion";
  readonly documentVersion: string;
  readonly supportedVersion: string;
  constructor(documentVersion: string, supportedVersion: string) {
    super(
      `unsupported schemaVersion ${documentVersion}: this Core supports ${supportedVersion} (same major, minor <= ${semver(supportedVersion)?.minor ?? "?"})`,
      [{ path: "schemaVersion", message: `unsupported version ${documentVersion}` }],
    );
    this.documentVersion = documentVersion;
    this.supportedVersion = supportedVersion;
  }
}

function semver(version: string): { major: number; minor: number; patch: number } | undefined {
  const m = SEMVER_PATTERN.exec(version);
  if (m === null) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function isSchemaVersionSupported(version: string, supported: string = CORE_SCHEMA_VERSION): boolean {
  const doc = semver(version);
  const sup = semver(supported);
  if (doc === undefined || sup === undefined) return false;
  return doc.major === sup.major && doc.minor <= sup.minor;
}

function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path === "" ? "(root)" : i.path}: ${i.message}`)
    .join("; ");
}

export function parseCoreDocument<T extends CoreDocumentType>(type: T, input: unknown): CoreDocument<T> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new CoreValidationError(`${type}: document must be an object`, [{ path: "", message: "expected object" }]);
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "string") {
    throw new CoreValidationError(`${type}: document has no schemaVersion`, [{ path: "schemaVersion", message: "required" }]);
  }
  if (semver(version) === undefined) {
    throw new CoreValidationError(`${type}: schemaVersion "${version}" is not MAJOR.MINOR.PATCH`, [{ path: "schemaVersion", message: "invalid semver" }]);
  }
  if (!isSchemaVersionSupported(version)) {
    throw new UnsupportedSchemaVersion(version, CORE_SCHEMA_VERSION);
  }
  const result = DOCUMENT_SCHEMAS[type].safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    throw new CoreValidationError(`${type}: ${formatIssues(issues)}`, issues);
  }
  return result.data as CoreDocument<T>;
}
