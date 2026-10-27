/**
 * Version of the serialized Core contracts (semver).
 *
 * Compatibility policy (spec "Schema versioning"): a parser built for
 * MAJOR.MINOR.x accepts documents with the same MAJOR and a MINOR less than
 * or equal to its own, rejects everything else explicitly, and ignores PATCH.
 */
export const CORE_SCHEMA_VERSION = "1.0.0" as const;
