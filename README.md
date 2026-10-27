# Premiere Editing Assistant

Modular post-production automation platform. Premiere Pro is the first NLE integration; engines stay NLE-independent and the editor keeps final creative judgment.

> The GitHub repository name carries a typo (`assistantt`). The product and package names use the correct spelling: `@pea/core`, `Premiere Editing Assistant`.

## Documents
- Architecture spec: `docs/superpowers/specs/2026-10-03-premiere-editing-assistant-platform-design.md`
- Core contracts plan: `docs/superpowers/plans/2026-10-03-core-contracts.md`

## Non-negotiable rules
- Never modify or delete source media.
- No engine imports Premiere-specific code; Premiere lives under `adapters/premiere`.
- Canonical time is integer/rational, never floating-point seconds.
- Secrets are never committed; only `.env.example` documents environment variables.
- Real production media is never committed; fixtures are generated at test time.
