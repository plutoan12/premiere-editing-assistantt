# Premiere Editing Assistant

Modular post-production automation platform. Premiere Pro is the first NLE integration; engines stay NLE-independent and the editor keeps final creative judgment.

> The GitHub repository name carries a typo (`assistantt`). The product and package names use the correct spelling: `@pea/core`, `Premiere Editing Assistant`.

## Documents
- Architecture spec: `docs/superpowers/specs/2026-10-03-premiere-editing-assistant-platform-design.md`
- Decision records: `docs/adr/`
- Core contracts plan: `docs/superpowers/plans/2026-10-03-core-contracts.md`

## Getting started
Requires Node 22 (`.nvmrc`) and pnpm 10 (`packageManager` in `package.json`; `corepack enable` installs it).

```sh
pnpm install
pnpm lint        # ESLint incl. layer-boundary rules
pnpm typecheck   # root tests + every package
pnpm test        # Vitest: packages/* and tests/
pnpm schemas:generate   # regenerate schemas/v1 from the Zod definitions
```

CI runs the same four commands and fails if `schemas/v1` drifts from the Zod definitions.

## Layout
```text
packages/core/      @pea/core: canonical contracts, exact time model, job/artifact lifecycle, provider interfaces
schemas/v1/         JSON Schema generated from @pea/core (do not edit by hand)
tests/              cross-package contract tests
docs/               spec, ADRs, implementation plans
```
Engines (`packages/sync`, `packages/subtitle`, ...), `adapters/premiere`, `apps/premiere-panel` and `apps/sidecar` follow in later plans.

## Non-negotiable rules
- Never modify or delete source media.
- No engine imports Premiere-specific code; Premiere lives under `adapters/premiere`. ESLint enforces the layer boundaries.
- Canonical time is integer ticks at a rational timebase, never floating-point seconds. Drop-frame is a `Timecode` display property only.
- Every serialized document carries `schemaVersion`; unknown versions fail explicitly.
- Jobs follow `queued -> running -> completed | failed | cancelled`; a retry is a new Job. Artifacts are promoted only after validation.
- Secrets are never committed; only `.env.example` documents environment variables.
- Real production media is never committed; fixtures are generated at test time.
