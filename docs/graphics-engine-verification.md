# Graphics Engine verification — 2026-10-03

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
