# @pea/media-organizer

Editor-independent Media Organizer engine for the editing assistant workspace.
It reuses `@pea/core` media/time/job contracts and MiniSearch 7.2.0.

## Implemented

- Verified media registration with full SHA-256, stable UUIDs, per-item results,
  cancellation checkpoints, failed-job retry, and resumable scan IDs.
- Catalog reference validation and compare-and-swap commits. `createMemoryCatalog`
  is an in-memory reference store, not a durable production database.
- Separate assets, clips and editor bindings. Same filename/hash does not merge
  independent sources or clips. Still images can exist without invented durations.
  When one registered location changes content, only that verified location is
  retained for the new revision and becomes the canonical URI. Other copies can
  be registered separately; original files are never moved or deleted.
- Probe observations, explicit user overrides, notes, tags and favorites.
  Reanalysis preserves user values. Changed content marks previous clip ranges and
  ranged annotations for review; it does not rewrite them to fit new media.
  Failed or unstable analysis retains the previous artifact but marks the source
  unverified, blocking organization until a complete stable analysis succeeds.
- Explainable date/device/media-kind classification and bounded filename patterns.
  Missing dates/devices and conflicting observations require review. Camera model
  names and file modification dates are not treated as device IDs or capture dates.
  Probe/host dates without an explicit timezone retain their observed value with
  `needs_review`; confirm them with a user override before applying a date rule.
- Korean NFC/NFD normalization, filename/tag/note/metadata search, AND filters,
  saved queries and rebuildable indexes. This is lexical search, not semantic AI.
- Reviewed organization plans, editor capability contracts, stale-context checks,
  observation-based retry selection and receipt reconciliation.
  Whole-item plan tags include only confirmed annotations without a range.
  Ranged and review-required tags remain intact in the catalog.
- Versioned JSON exchange with exact bigint times and verified explicit relinking.

## Integration

Use the public `@pea/media-organizer` entry point. Supply a UUID `ids` function,
read-only `files.stat` / `files.sha256`, a normalized Core `MediaProbeProvider`,
`providerVersion`, `settingsKey`, and a `CatalogStore` to `ingest`.
The `probe` result must match the exported `ProbeRecordSchema`; it is not raw
MediaInfo/ffprobe output. Hash providers must read all file bytes.

```ts
import {
  ingest, setMetadataOverride, defaultRuleSet, buildOrganizationPlan,
  createSearchIndex, exportCatalog,
} from '@pea/media-organizer';

// deps implements IngestDependencies; inputs contains caller-issued scan UUIDs.
const result = await ingest(inputs, deps, { signal });
let state = await deps.store.read();
const target = { kind: 'asset' as const, id: state.assets[0].asset.id };
state = setMetadataOverride(state, target, 'deviceId', 'CAM_A');
state = await deps.store.commit(state.revision, state);
const index = createSearchIndex();
await index.rebuild(state);
const matches = index.search({ text: '서울 인터', filters: { deviceId: 'CAM_A' } });
const preview = buildOrganizationPlan(state, [target], defaultRuleSet(ids()), [], ids);
const json = exportCatalog(state);
```

Persist the selected rule set before saving a reviewed organization/host plan.
`saveReviewedPlan` records both together against the resulting catalog revision.
An adapter must validate its own `adapterSchemaVersion` and action schema, read
current host state, call `preflight`, perform supported operations, then obtain
fresh observations for `reconcileReceipt`. Exporting a file is not proof that the
editor imported it. After receipts or other catalog changes are saved, read a new
context before any further host work; stale plans require renewed review.
`retryableOperationIds` identifies immediately eligible operations only: dependencies
must already be observed at their target, not merely queued for retry.

Reuse a scan ID only for the exact same URI/range/explicit asset request. Use
`existingAssetId` for explicit reanalysis. A completed scan can reuse its verified
result when the file stamp, provider version, settings, asset file revision and
current analysis artifact ID all match. Legacy scans without this linkage are
reanalyzed. A cache hit also refreshes availability when a missing file returns.
Timestamp checks are not a lock against concurrent writers. A moved location
requires a fresh scan. `sourceState: 'unverified'` blocks both cache reuse and
organization; reanalysis clears it, but previously invalidated clip ranges still
require review. `acceptedUnknowns` cannot bypass source or date confirmation.
To retry a failed Job in place, supply `retryJobId`; completed/cancelled Jobs start
a new Job. Partial item failures still produce a completed Job when its results
were safely stored. Storage failures never produce success.
Successful item states distinguish `registered` (new asset), `updated` (existing
asset contents replaced), and `unchanged` (same contents or verified cache reuse).
`updated` is persisted in scan and Job results and survives JSON exchange; a later
cache reuse reports `unchanged`. Consumers of result states must handle `updated`.

`importCatalog` validates without modifying a store. Unsupported catalog/Core
versions are rejected. Adapter action payloads remain JSON and are not authorized
for execution by importing them. User text containing numbers is never coerced to
bigint. The Core parser adds the `media` document kind while preserving `project`;
older Core readers reject the new kind.

Filename patterns support literals, `{digits}` (1–32 ASCII digits), `{letters}`
(1–32 ASCII letters), and `{date}` (valid YYYY-MM-DD), with 1-based capture groups.
Patterns are limited to 128 characters and input names to 2,048. They match the
whole filename without its final extension. Date fields require a date group.

## Verification

From the workspace root, using the packageManager version in root package.json:

```sh
pnpm test
pnpm typecheck
pnpm --filter @pea/media-organizer exec vitest bench --run src/search.bench.ts
```

Tests include a complete read-only ingest/classify/search/review/exchange workflow,
a browser-target bundle, malformed documents, failure/retry paths, and two simulated
editor capabilities. The 500-item synthetic benchmark records 20 warm-up queries
and 200 measured queries separately from Vitest's throughput benchmark.

## Remaining product work

The Premiere UXP adapter/panel, production SQLite store and migrations, real media
probe/hash providers, thumbnails and OS packaging are not implemented here.
Browser bundling does not certify UXP runtime support. Test editors are fixtures,
not Final Cut Pro or Resolve adapters. Actual editor mutations, Undo and crash
recovery require host integration tests before release.

Source/reuse rationale: `docs/research/2026-10-03-media-organizer-code-reuse.md`.
MiniSearch's MIT notice is preserved in the root `THIRD_PARTY_NOTICES.md`.
