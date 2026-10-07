import { z } from "zod";
import { type CatalogState } from "./catalog.js";
import {
  MetadataFieldSchema,
  type CatalogTarget,
  type MetadataCandidate,
  type ResolvedMetadata,
  assetForTarget,
  effectiveRecord,
  resolveMetadata,
  validDate,
} from "./metadata.js";
export const RuleSetSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    orderedFields: z
      .array(z.enum(["captureDate", "deviceId", "mediaKind"]))
      .refine((a) => new Set(a).size === a.length),
    rootLabel: z.string().min(1),
    pathMappings: z.array(
      z
        .object({ prefix: z.string().min(1), deviceId: z.string().min(1) })
        .strict(),
    ),
    filenameRules: z.array(
      z
        .object({
          pattern: z.string().min(1).max(128),
          field: MetadataFieldSchema,
          group: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
export type RuleSet = z.infer<typeof RuleSetSchema>;
export type Classification = {
  target: CatalogTarget;
  pathSegments: string[];
  status: ResolvedMetadata["status"];
  reasons: string[];
  requiresReview: boolean;
};
export function defaultRuleSet(id: string): RuleSet {
  return RuleSetSchema.parse({
    id,
    version: 1,
    orderedFields: ["captureDate", "deviceId", "mediaKind"],
    rootLabel: "Media Organizer",
    pathMappings: [],
    filenameRules: [],
  });
}
type Token =
  | { kind: "literal"; value: string }
  | { kind: "digits" | "letters" | "date" };
function parsePattern(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; ) {
    if (pattern[i] === "{") {
      const end = pattern.indexOf("}", i),
        kind = pattern.slice(i + 1, end);
      if (end < 0 || !["digits", "letters", "date"].includes(kind))
        throw new Error("unsupported filename pattern");
      tokens.push({ kind: kind as "digits" | "letters" | "date" });
      i = end + 1;
    } else {
      let end = i + 1;
      while (end < pattern.length && pattern[end] !== "{") end++;
      const value = pattern.slice(i, end);
      if (value.includes("}")) throw new Error("unsupported filename pattern");
      tokens.push({ kind: "literal", value });
      i = end;
    }
  }
  return tokens;
}
/** Memoized matching bounds work by tokens × input positions × 32, without regex backtracking. */
function match(tokens: Token[], value: string): string[] | undefined {
  if (value.length > 2048) return undefined;
  const failed = new Set<string>();
  function visit(ti: number, pos: number): string[] | undefined {
    if (ti === tokens.length) return pos === value.length ? [] : undefined;
    const key = `${ti}:${pos}`;
    if (failed.has(key)) return undefined;
    const token = tokens[ti];
    if (token.kind === "literal") {
      if (value.startsWith(token.value, pos)) {
        const rest = visit(ti + 1, pos + token.value.length);
        if (rest) return rest;
      }
    } else {
      const max = token.kind === "date" ? 10 : Math.min(32, value.length - pos);
      for (let len = max; len >= 1; len--) {
        const part = value.slice(pos, pos + len);
        const valid =
          token.kind === "date"
            ? len === 10 && validDate(part)
            : token.kind === "digits"
              ? /^[0-9]+$/.test(part)
              : /^[A-Za-z]+$/.test(part);
        if (valid) {
          const rest = visit(ti + 1, pos + len);
          if (rest) return [part, ...rest];
        }
      }
    }
    failed.add(key);
    return undefined;
  }
  return visit(0, 0);
}
export function filenameFromUri(uri: string): string {
  const name = uri.slice(uri.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
export function ruleCandidates(
  target: CatalogTarget,
  state: CatalogState,
  input: RuleSet,
): MetadataCandidate[] {
  const rules = RuleSetSchema.parse(input),
    asset = assetForTarget(target, state),
    out: MetadataCandidate[] = [];
  const provenance = {
    provider: `rules:${rules.id}`,
    version: String(rules.version),
  };
  for (const map of rules.pathMappings) {
    const prefix = map.prefix.replace(/\/+$/, "");
    if (
      asset.locations.some(
        (uri) => uri === prefix || uri.startsWith(prefix + "/"),
      )
    )
      out.push({
        field: "deviceId",
        value: map.deviceId,
        source: "folderRule",
        provenance,
      });
  }
  const name = filenameFromUri(asset.asset.uri).replace(/\.[^.]+$/, "");
  for (const rule of rules.filenameRules) {
    const tokens = parsePattern(rule.pattern),
      groups = tokens.filter((x) => x.kind !== "literal");
    if (
      rule.group > groups.length ||
      (rule.field === "captureDate" && groups[rule.group - 1]?.kind !== "date")
    )
      throw new Error("invalid filename pattern group");
    const values = match(tokens, name);
    if (values)
      out.push({
        field: rule.field,
        value: values[rule.group - 1],
        source: "filenameRule",
        provenance,
      });
  }
  return out;
}
export function classify(
  target: CatalogTarget,
  state: CatalogState,
  input: RuleSet,
): Classification {
  const rules = RuleSetSchema.parse(input),
    derived = ruleCandidates(target, state, rules);
  const values = rules.orderedFields.map((field) => {
    const record = effectiveRecord(target, state, field);
    record.candidates.push(...derived.filter((x) => x.field === field));
    return { field, ...resolveMetadata(record) };
  });
  const labels: Record<string, string> = {
    video: "Video",
    audio: "Audio",
    image: "Image",
    other: "Other",
  };
  const pathSegments = [
    rules.rootLabel,
    ...values.map((x) =>
      x.value
        ? x.field === "mediaKind"
          ? labels[x.value]
          : x.value
        : x.field === "captureDate"
          ? "촬영일 미확인"
          : x.field === "deviceId"
            ? "기기 미확인"
            : "Other",
    ),
  ];
  const status = values.some((x) => x.status === "conflict")
    ? "conflict"
    : values.some((x) => x.status === "needs_review")
      ? "needs_review"
      : values.some((x) => x.status === "missing")
        ? "missing"
        : values.some((x) => x.status === "user_confirmed")
          ? "user_confirmed"
          : "rule_match";
  return {
    target,
    pathSegments,
    status,
    reasons: values.flatMap((x) => x.reasons),
    requiresReview:
      status === "conflict" ||
      status === "missing" ||
      status === "needs_review",
  };
}
