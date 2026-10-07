# Graphics Engine verification — 2026-10-03

This is a chronological record. Latest status: the final production panel passed the
[Premiere 26.5.2 host replay on 2026-10-08](#final-production-panel-replay--2026-10-08).
Earlier unrun/blocked statements describe the state at those earlier checkpoints.

## Delivered

- `packages/graphics/`: template property/resource validation, caption presets and
  grapheme-safe layout, rule selection, exact source-to-sequence time mapping,
  collision-aware placement, partial request results and versioned JSON.
- `adapters/premiere/`: pure validated MOGRT handoff-plan compiler. No host calls.
- Public API and integration guide: `packages/graphics/README.md`.
- Base: Core PR #1 commit `9f2119ce55bd090c86e84b058725776a9405228c`.
  Work is in the managed `graphics-engine` worktree, separate from the original checkout.
  Core and Sync source/configuration are unchanged by Graphics. Changes were uncommitted
  and unpushed at the original verification; see the publication recheck below.

## Commands and evidence

| Command | Outcome |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run` before Graphics work | Exit 0; 9 files, 17 tests passed |
| Core and Sync direct TypeScript checks before work | Both exit 0 |
| Initial new-feature test runs | Exit 1 because new modules did not exist yet |
| Planner integration before caller fix | 9 failed; strict size parser received extra layout fields |
| Review regressions before fixes | 4 failed: measurement error, diagnostic ID collision, invalid dimensions, erased hard breaks |
| `node node_modules/vitest/vitest.mjs run` after fixes | Exit 0; 13 files, 65 tests passed (17 baseline + 48 new) |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json` | Exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/sync/tsconfig.json` | Exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/graphics/tsconfig.json` | Exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p adapters/premiere/tsconfig.json` | Exit 0 |
| `git diff --check` | Exit 0 |

The first `pnpm test` / `pnpm typecheck` invocations automatically installed existing
manifest dependencies before running checks, then exited 1 at an ignored esbuild build
script gate. The intended tests/typecheck did not execute in those invocations. This
unexpected installation was disclosed. Generated workspace settings were restored and
the generated lockfile moved out of the deliverable; no build-script approval was given.
All subsequent checks invoked the installed binaries directly, with no further installs.

## Review and remaining limits

One independent read-only review found three important issues. All were reproduced with
regression tests and fixed: imported layout inconsistencies, diagnostic ID collisions,
and host measurement exceptions aborting unrelated requests. Hard-break and grapheme
boundaries are now checked when importing plans. No re-review was claimed; fixes were
verified by the full suite and typechecks.

The original review deferred a mismatch between runtime bigint ticks and the wire
reader's 100-digit limit. This is resolved by the follow-up below.

Real Premiere tests were not run: this base has no implemented host bridge or actual
test project. SDK behavior, template/font inventories, real-font measurements, sequence
metadata checks and rendered fidelity remain unverified. Compiler results are `planned`
or `unsupported`, never `applied`.

No lint/build commands existed at the base; none were invented. No production media,
secrets, project files or external systems were changed by Graphics logic. No push,
PR creation, merge or deployment was performed.

## Implementation decisions

1. Use the available Core PR commit in an isolated worktree. This avoids modifying other
   module work, but creates an integration dependency on the unmerged Core implementation.
2. Wrap existing GraphicDecision in GraphicsPlan instead of changing Core. Downstream
   consumers must support the new versioned layout/typed-property contract.
3. Compile Premiere plans without assuming an Adobe API. A real bridge must implement
   the contract and pass manual rendering checks before host writes are enabled.

For the shortest real-host check once a bridge is available, use one two-line Korean/
English caption in a known MOGRT at 30000/1001, verify text/numeric/boolean properties,
timing, safe-area placement and font metrics, then repeat with overlapping captions and
a missing asset to verify the previous valid project/artifact remains intact.

## Publication recheck — 2026-10-07

The user explicitly requested GitHub publication. The `feat/graphics-engine` branch
was advanced to Core PR #1 head `131f0505199349f4807953f78d8512f81bc7e1db` before
committing Graphics. The intended PR base is `feat/core-contracts`, keeping the review
focused on Graphics. Core PR #1 remains unmerged into main.

- Full direct Vitest run: exit 0, 19 files and 112 tests passed.
- Core, Graphics and Premiere adapter direct TypeScript checks: exit 0.
- Sync TypeScript check: exit 2, TS2307 for `node:assert/strict` in four existing Sync
  tests. This checkout lacks the newly declared `@types/node` dependency; no additional
  dependency installation was performed. Sync source/configuration matches the updated
  Core branch exactly. This is a failed check, not a passing check.
- `git diff --check`: exit 0.
- Real Premiere host checks remain unrun. At publication the 100-digit wire tick issue
  was still deferred; it is resolved by the follow-up below.

## Follow-up — exact bigint round-trip

- Reproduced the reader/writer mismatch separately for start and duration ticks using
  `10n ** 100n + 123456789n`; both tests failed at the decoder's 100-character cap.
- Removed that decoder-only limit, preserving canonical unsigned decimal validation and
  the Core time validators. No format/schema version change is required.
- Added rejection cases for exponent notation, leading zeroes, signs, decimal points,
  empty strings and whitespace.
- Full direct Vitest run: exit 0, 19 files and **120 tests passed**.
- Graphics and Premiere adapter direct TypeScript checks and diff whitespace check: exit 0.
- GitHub CI on the original published commit `ebf140a` completed `pnpm test` and
  `pnpm typecheck` successfully: https://github.com/plutoan12/premiere-editing-assistantt/actions/runs/37626786033.
  This confirms the previously reported Sync type failure is specific to the stale local
  dependency setup. The follow-up commit's CI result is reported on PR #15.
- Real Premiere rendering/host integration remains the only unrun integration layer;
  no host API call or project write was added by this correction.

## UXP template preview — 2026-10-07

Added an actual host boundary and development panel. `createMogrtPreviewRequest`
converts an engine decision to exact Premiere ticks. `previewPremiereMogrt` creates a
new sequence and inserts/trims the ORIGINAL template. It verifies the sequence rate,
frame size, clip start and clip end before returning `preview-created`. Every outcome
has `graphicsApplied: false`; caption text/style/emphasis/placement/property overrides
remain unapplied. The prior compiler still returns only planned/unsupported.

### Automated verification

- Test-first host boundary: 19 new tests failed because the function did not exist,
  then passed after implementation. Coverage includes malformed requests, wrong project,
  occupied destination, false transaction, unknown import failure, ignored trim and
  concurrent preview attempts. Premiere calls are modeled by a structural API fake;
  these tests do not prove Adobe behavior.
- Plan-to-preview conversion: 3 tests for exact NTSC ticks, exact decision/version binding
  and the host bigint limit. Engine bigint capacity itself remains unchanged.
- Full direct Vitest run: exit 0, **20 files / 142 tests passed**.
- Graphics and Premiere adapter TypeScript checks: exit 0.
- Panel development build using the existing TypeScript installation: exit 0.
- Independent read-only review found no critical/important issue. Its minor finding
  about direct host objects in the property inspector was addressed by distinguishing
  `host-object` from unavailable values; no full-rendering support is inferred.

### Actual Premiere exploration

Premiere Pro **26.5.2** on macOS, local UXP Developer Tools. A throwaway probe was loaded
successfully without changing developer/security settings. It created a separate test
project and two new test sequences; no pre-existing media sequence was edited.

- Basic Lower Third: returned one inserted item, start ticks `0`, end ticks
  `1239566328000`. Components included Opacity, Motion and Graphic Group, with no exposed
  text component.
- Gaming Lower Third Left (AE): returned one inserted item, start ticks `0`, end ticks
  `2034160128000`. The Capsule component was initially absent and appeared in a later
  read after loading. It had 14 parameters; title and subtitle keyframe values were null.
  Numeric values such as animation speed were readable.
- The default test sequence reported frame ticks `10594584000`, width 1920, height 1080.

These observations verify insertion and property inspection only. They do **not** verify
caption rendering, typography, planned placement, pixel fidelity, or the final module's
settings/trim/readback sequence. Adobe template binaries and local project files are
not redistributed in the repository.

### Replay interruption — 2026-10-07

Another task briefly used the same development-tool UI, so its open dialog was left
alone. Before the final replay, computer access reported that the **Mac is locked and
requires manual unlock**. The final production panel and adapter were therefore NOT
claimed to pass live smoke. Initial exploration above ran before the lock.

The planned replay was to build/load `apps/premiere-graphics-panel/dist/manifest.json`,
choose a disposable project and Basic Lower Third, then run the default preview. Expected:

- New sequence only, 1920×1080, frame ticks `8475667200` (30000/1001 fps).
- Start ticks `508540032000` (frame 60), end ticks `762810048000` (frame 90).
- `preview-created`, `graphicsApplied:false`, and the unapplied-field list.
- Export the receipt and visually review the template. Repeat with the AE template
  after loading finishes. Treat failures as needs-review; inspect remaining edits.

The panel does not save projects automatically. Host import and trim are separate
undo operations; the implementation does not claim atomic rollback. Template identity
and version are selected by the caller/user, not inferred from the filename. The
physical frame rate is configured, while drop-frame timecode display labels are not.

## Final production panel replay — 2026-10-08

After unlocking, the unchanged production code at `ede9a2ef5265a885d5b4cc1f9256e3f068601d99`
was rebuilt and loaded as **PEA Graphics Preview** (`local.pea.graphics.preview`) through
UXP Developer Tools. The final panel's native template picker and preview button ran
against the separate Graphics test project in Premiere Pro **26.5.2**, macOS. The shared
Premiere UI was used after the Sync task reported pausing its screen interactions.

Both default preview requests passed the actual adapter's settings, empty-track,
insertion, trim and readback checks. Independent UXP reads then confirmed:

| Template | Result | Frame ticks | Canvas | Start ticks | End ticks |
| --- | --- | --- | --- | --- | --- |
| Basic Lower Third | `preview-created` | `8475667200` | 1920×1080 | `508540032000` | `762810048000` |
| Gaming Lower Third Left (AE) | `preview-created` | `8475667200` | 1920×1080 | `508540032000` | `762810048000` |

This is 30000/1001 fps, start frame 60 and end frame 90. Each run created one new
sequence with one graphic item. Both receipts retained `graphicsApplied:false` and
all five unapplied fields. The preview button became disabled after each receipt.

- The program monitor visibly displayed each original template at an interior position
  (`635675040000` ticks). This was a visual smoke check, not pixel-reference comparison.
- The production property-inspection handler completed for both templates. In this
  later read, Basic Lower Third exposed two `AE.ADBE Text` components; both source-text
  values were `unavailable`. This supersedes the earlier observation of no text components.
- The AE Capsule exposed 14 parameters. Title/subtitle values were `unavailable`,
  animation speed/direction were `number`, and its five color parameters were `host-object`.
  No text-editing or color-editing support is inferred from this inspection.
- The panel's export handler and native save dialog wrote the Basic receipt, which was
  read back as valid JSON. UXP Developer Tools was used to invoke the existing inspection/
  export handlers and capture independent readbacks; production code was not modified.
- The disposable project was explicitly saved by the verification harness as
  `dist/pea-graphics-host-smoke.prproj`. The production panel itself does not auto-save.
  Test projects, Adobe templates and local absolute paths are excluded from Git.

The [normalized host evidence](evidence/2026-10-08-graphics-host-smoke.json) records the
actual receipts, settings and component summaries without local project identifiers.
No production-code fix or dependency installation was required for this replay.

Reverification before the host run: **142 tests / 20 files passed**; Graphics and
Premiere adapter typechecks, panel build and whitespace checks passed. The existing
GitHub CI runs for `ede9a2e` also passed full workspace tests/typechecks and the panel build.

Remaining limits: loading a custom request JSON through the panel was not replayed in
the real host; its engine conversion/validation is covered by automated tests. Host
negative cases remain simulated tests. Planned caption text, typography, emphasis,
placement and template-property edits still require a tested renderer and are not
implemented by this preview. Drop-frame display labels and pixel fidelity were not tested.
