export const CORE_SCHEMA_VERSION = "1.0.0" as const;

export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseSemver(version: string): { major: number; minor: number; patch: number } | undefined {
  const m = SEMVER_PATTERN.exec(version);
  if (m === null) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Schema compatibility policy (platform spec, "Schema versioning"): a parser
 * built for MAJOR.MINOR.x accepts documents with the same MAJOR and a MINOR
 * less than or equal to its own; PATCH is ignored. Everything else is rejected
 * explicitly and never interpreted as the current version.
 */
export function isSchemaVersionSupported(version: string, supported: string = CORE_SCHEMA_VERSION): boolean {
  const doc = parseSemver(version);
  const sup = parseSemver(supported);
  if (doc === undefined || sup === undefined) return false;
  return doc.major === sup.major && doc.minor <= sup.minor;
}
