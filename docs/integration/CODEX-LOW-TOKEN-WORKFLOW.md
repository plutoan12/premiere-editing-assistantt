# Codex low-token implementation workflow

Goal: ship a working Premiere Editing Assistant with minimal repeated reasoning and no false completion claims.

## Operating rules
- One agent by default. No parallel reviewers unless a specific blocker requires them.
- Read only the changed module, its direct contracts, and relevant tests. Avoid full repository scans.
- Reuse existing Core, Sync, helper, Subtitle, Rough Cut, Graphics, Audio, Delivery, and Organizer code. Do not install dependencies without a demonstrated missing capability.
- Work in one canonical integration branch; inspect PR ancestry before merge or cherry-pick. Never blindly merge overlapping helpers.
- Make the smallest runnable vertical slice first: footage -> Sync -> Subtitle -> Rough Cut -> new Premiere sequence.
- During edits run only targeted tests and typecheck; run the whole suite once at an integration gate.
- Do not repeatedly generate plans, summaries, or new docs. Update a single checklist only when a milestone changes.
- Stop after two identical failed attempts. Report blocker and exact failing command; do not loop.
- Preserve source media and user project. Use a disposable Premiere test project, explicit approval for apply, and readback/Undo/save-reopen checks.
- Do not enable Graphics MOGRT text writes until compatibility is verified.

## Next execution
1. Inspect PR #1, #9/#10/#11/#12, #14, #16 ancestry and choose canonical helper path.
2. Integrate a single Premiere UXP -> authenticated helper -> FFmpeg -> Sync review path.
3. Add Subtitle apply and Rough Cut sequence generation, verify on authorized footage.
4. Run tests and report only: changed paths, pass/fail, remaining blocker.

## Codex prompt
Continue Premiere Editing Assistant on the existing integration branch. Follow this file. Implement the next smallest working slice, not another planning document. Reuse existing modules, do not add dependencies without justification, keep one agent, run targeted tests, and provide a <=5-line final report. Do not claim Premiere host verification unless actually run.
