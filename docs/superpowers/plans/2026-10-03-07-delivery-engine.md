# Delivery Engine Implementation Plan

**Goal:** Turn an approved master into validated platform/language variants and export manifests.

## Tasks
1. DeliveryVariant presets and custom dimensions.
2. Reframe decision model with subject/safe-zone inputs.
3. Localization inheritance from master transcript/graphics lineage.
4. Version naming and collision-safe output paths.
5. ExportManifest contract: codec/profile/resolution/audio/caption options.
6. Variant validation before adapter/export.
7. Master immutability checks.
8. Public API and CI.

**Tests:** 16:9→9:16, 1:1, missing localized caption, filename collision, unsupported dimensions, variant generated from stale master artifact.

**Completion:** variants reference a specific approved master version and never mutate it.
