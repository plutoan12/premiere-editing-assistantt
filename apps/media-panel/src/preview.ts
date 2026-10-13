import {
  buildOrganizationPlan,
  classify,
  filenameFromUri,
  type CatalogState,
  type RuleSet,
} from "@pea/media-organizer";
export interface PreviewRow {
  filename: string;
  uri: string;
  pathSegments: string[];
  issues: string[];
}
/** Prepare once per accepted catalog; typing a query only selects cached rows. */
export function preparePreview(
  state: CatalogState,
  rules: RuleSet,
): Map<string, PreviewRow> {
  const targets = state.assets.map((a) => ({
    kind: "asset" as const,
    id: a.asset.id,
  }));
  const plan = buildOrganizationPlan(
    state,
    targets,
    rules,
    [],
    () => "9e89524c-01b8-4375-aad1-b28f3a8785bb",
  );
  const paths = new Map(
    plan.assignments.map((a) => [a.target.id, a.pathSegments]),
  );
  const issues = new Map(plan.issues.map((i) => [i.target.id, [i.code]]));
  return new Map(
    state.assets.map((asset) => [
      asset.asset.id,
      {
        filename: filenameFromUri(asset.asset.uri),
        uri: asset.asset.uri,
        pathSegments:
          paths.get(asset.asset.id) ??
          classify({ kind: "asset", id: asset.asset.id }, state, rules)
            .pathSegments,
        issues: issues.get(asset.asset.id) ?? [],
      },
    ]),
  );
}
