# Graphics Engine Implementation Plan

**Goal:** Apply repeatable caption/graphic systems and recommend only known templates.

## Tasks
1. TemplateCatalog contract for MOGRT IDs, parameters, safe zones and supported aspect ratios.
2. CaptionStyle rules based on speaker/emphasis/category.
3. Deterministic graphic trigger rules.
4. Optional AI recommendation restricted to catalog IDs.
5. Placement engine with safe-zone and overlap/collision checks.
6. Duration rules and minimum readability timing.
7. Aspect-ratio-aware placement variants.
8. Prompt `graphics/recommend-v1.md` + schema.
9. Public API and CI.

**Tests:** unavailable template ID, two graphics colliding, lower-third over captions, 16:9→9:16 safe-zone change, long Korean/Japanese text.

**Completion:** engine cannot invent a MOGRT/template reference and can run deterministic styling without an LLM.
