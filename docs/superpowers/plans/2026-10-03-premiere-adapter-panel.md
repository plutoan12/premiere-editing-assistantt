# Premiere Adapter & Panel Implementation Plan

**Goal:** Translate canonical engine results into Premiere-facing operations while keeping Premiere out of engine code.

## Adapter tasks
1. Capability boundary and adapter version detection.
2. Project/media stable-ID mapping.
3. Bin/metadata/marker application.
4. Sequence creation from SequencePlan.
5. Caption/subtitle application.
6. MOGRT/template parameter mapping.
7. AudioDecision mapping.
8. Delivery/export handoff.
9. Dry-run operation list before applying.
10. Fixture integration tests and unsupported-operation errors.

## Panel tasks
1. Job dashboard and module launcher.
2. Ingest/Sync/Organize/Subtitle/Rough Cut/Graphics/Audio/Delivery staged navigation.
3. Review screen for proposed edits.
4. Partial-failure/retry/cancel UI.
5. Settings: providers, cache, budgets, templates, export presets.
6. Local secret storage strategy; never persist keys in project files.
7. End-to-end fixture workflow.

**Completion:** engines compile/test with zero Premiere imports; panel can run modules independently; adapter supports dry-run and explicit apply.
