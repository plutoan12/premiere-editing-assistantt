# Graphics Engine implementation

Approved scope: MOGRT metadata/property validation, caption styling, deterministic rules,
time-aware placement, and a Premiere application plan. Base: Core PR #1 commit
`9f2119ce55bd090c86e84b058725776a9405228c` (not merged into main).

## Boundaries and decisions
- Preserve Core. A versioned GraphicsPlan wraps existing GraphicDecision with typed
  properties, measured caption layout, placement and selection provenance.
- Frame-aligned rational time only. Explicit media-to-sequence mapping is required;
  unsupported frame-rate changes and partially out-of-clip captions fail explicitly.
- Use an injected text measurer and an explicit installed-font/asset inventory. No fake
  font metrics, silent font fallback, vision model or Premiere SDK assumptions.
- Rules choose one winner by descending priority, then ascending stable ID. Empty
  captions are skipped. Failed individual requests yield issues; other requests survive.
- Placement uses ordered anchors, padded measured bounds, half-open time intervals,
  safe insets and timed obstacles. No fit yields an issue, never an overlapping fallback.
- Premiere adapter only compiles validated plans with explicit template/property/style
  capabilities. It does not call a host API or report graphics as applied.
- No Core changes, source-media writes, commit/push/merge, additional dependency install,
  or real Premiere project writes are authorized by this implementation.

## Tasks
1. Template validation and caption style/layout; focused tests then implementation.
2. Exact time mapping, deterministic rule selection and collision-aware placement.
3. Public planning API, strict versioned serialization and partial failure behavior.
4. Premiere plan compiler, documentation and final regression/typecheck/review.

## Verification
Use installed Vitest and TypeScript directly, avoiding pnpm automatic installation:
`node node_modules/vitest/vitest.mjs run`
`node node_modules/typescript/bin/tsc --noEmit -p packages/graphics/tsconfig.json`
Also run Core, Sync and Premiere adapter typechecks. No build/lint script exists at base.
Test missing resources/types, style precedence, Korean/grapheme wrapping, time mapping,
fractional frame rates, rule ties, temporal collisions, portrait/landscape safe areas,
serialization, invalid version/data, partial errors, and adapter property mapping.

## Baseline evidence
17/17 existing tests pass; Core and Sync typechecks exit 0 before edits.
`pnpm test` and `pnpm typecheck` unexpectedly auto-installed dependencies and exited 1
at an ignored esbuild install-script gate; neither command ran its intended checks.
Generated workspace settings were restored, and the generated lockfile was kept outside
the deliverable. No install script approval was granted. Direct installed runners work.

## Progress
- Pre-flight: Core decision lacks layout/typed properties. Keep these in GraphicsPlan;
  do not encode them in string variables. No private module imports.
- Task 1: complete. Template/style/layout tests: 13 passed; typecheck exit 0.
- Task 2: complete. Time/rules/placement tests: 12 passed; typecheck exit 0.
- Task 3: complete. Planner/serialization tests: 10 passed; typecheck exit 0.
- Task 4: adapter compiler tests: 9 passed. Full baseline + new suite: 61 passed.
  Graphics and adapter typechecks exit 0. Independent review completed; fixes below.
- Initial task test runs failed because the corresponding new modules did not exist.
  Planner integration exposed passing a full layout to a strict size validator; fixed
  the caller to pass only width/height, then all planner tests passed.
- Ruling: use the available Core PR commit in an isolated worktree — main has no
  implementation. Cost: integration remains dependent on that unmerged Core work.
- Ruling: preserve Core with a versioned GraphicsPlan wrapper — layout and typed
  properties cannot fit the current GraphicDecision. Cost: consumers must support it.
- Ruling: provide a pure Premiere plan compiler with explicit capabilities — no working
  Premiere bridge exists in this base. Cost: actual application/rendering remains unverified.
- Final review: fresh read-only reviewer found no critical issues and three important
  defects. Regressions reproduced all three, plus hard-break/grapheme corruption:
  - Fixed imported caption height/effect offsets and hard-line/grapheme validation.
  - Fixed diagnostic ID allocation to reserve real request IDs first.
  - Fixed measurement-provider exceptions to become per-request MEASUREMENT_FAILED issues.
  Each regression was observed failing before correction. Final suite: 65/65 passed;
  Graphics and Premiere adapter typechecks exited 0.
- Final: minor (deferred): runtime permits ticks longer than 100 decimal digits, but the
  JSON reader caps them at 100; such extreme values may serialize but cannot round-trip.
  Ordinary production time values are far below this bound; align these limits in a
  subsequent Core/serialization contract review.
- Final: Ruling: reviewer deferred actual Premiere SDK behavior, render fidelity, font
  metrics, resource inventories and live sequence checks — these require the future
  host bridge and an actual Premiere test project. Cost: no real-host application claim
  can be made from this implementation's unit/integration tests.
- Publication update (2026-10-07): user explicitly authorized GitHub publication.
  The publication branch `feat/graphics-engine` now includes Core PR #1 head `131f050`.
  Full suite passes 112/112; Core/Graphics/adapter typechecks pass. Sync typecheck fails
  because local Node type declarations are missing (TS2307); no package was installed.
  Commit/push/PR publication is authorized by this later instruction; main merge is not.
