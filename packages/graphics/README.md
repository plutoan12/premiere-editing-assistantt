# Graphics Engine

`@pea/graphics` implements deterministic caption-to-graphic planning independently of
Premiere. It depends on the public `@pea/core` contracts from Core PR #1. Implementation
started at `9f2119ce55bd090c86e84b058725776a9405228c`; the publication branch includes
the updated Core/Sync base `131f0505199349f4807953f78d8512f81bc7e1db`.

## Public entry points

| API | Purpose |
| --- | --- |
| `planGraphics(input, measureText)` | Validate, map source time, select rules/templates, lay out and place captions |
| `resolveTemplate` | Validate manifest, asset availability, defaults and typed property overrides |
| `resolveStyle`, `layoutCaption` | Resolve style precedence and measure grapheme-safe line wrapping |
| `mapCaptionRange` | Map a caption inside one source clip into exact sequence frames |
| `selectRule`, `placeGraphic` | Deterministic rule selection and timed collision avoidance |
| `validateGraphicsPlan` | Check runtime plan, geometry, time, caption consistency and collisions |
| `serializeGraphicsPlan`, `parseGraphicsPlan` | Versioned JSON with lossless decimal-string ticks |

Import public types such as `GraphicsInput`, `GraphicRequest`, `GraphicsPlan`,
`CaptionStyle`, `Template`, `TextMeasurer`, and `ClipMapping` from `@pea/graphics`.
Both the planner and deserializer validate untrusted input at runtime.

## Input contract

A plan needs sequence `frameRate`, pixel `canvas` plus four safe insets, a `templates`
catalog and `defaultTemplateId`, confirmed `availableFonts`/`availableAssets`, and
`requests`. Each request carries a unique ID, a Core `TranscriptSegment`, and an
explicit `mapping` with media ID, source range, sequence destination and source frame
rate. Different instances of the same media clip need their own mapping/request IDs.
Optional request fields are `priority`, `locale`, `tags`, `templateId`, `style`,
`properties`, `emphasis`, and ordered `anchors`.

The host supplies `measureText(text, resolvedStyle) -> widthInPixels`, using the actual
selected font and shaping engine. There is deliberately no approximate production
font measurer. The tiny synthetic metrics in tests are test fixtures only. Measurement
must be deterministic and side-effect free. Account for shaping/glyph overhang in the
reported width and configure adequate line height for the selected font. The host
must verify the final text against MOGRT rendering before applying the plan.

Styles merge defaults → preset → winning rule → request override. Font size, padding,
outline and shadow values are specified at `referenceHeight`, then scaled to the output
canvas height. Resolved styles use pixel values and output `referenceHeight` equals
canvas height. Line height is a font-size multiplier. Missing fonts fail explicitly.
Wrapping preserves Unicode graphemes and hard line breaks; it does not perform
language-specific word wrapping, hyphenation, truncation or automatic font shrinking.
Color-only emphasis uses ordered, non-overlapping grapheme offsets in normalized text
(CRLF/CR become LF; newline counts as a grapheme). It does not alter font metrics.

Templates require ID, version, caption property name, property definitions and optional
required asset IDs. Property types are string, finite number and boolean. Numeric
properties support min/max; properties support typed defaults and required flags.
The caption property must be a declared string property and cannot be overridden by
the caller. Asset inventories are provided by the host; the engine never reads files.

## Time, rules and placement

Canonical time remains Core bigint ticks with explicit rational timebase. Only exact
frame-aligned mappings are supported. Different source/sequence frame rates, altered
drop-frame identity, retiming, subframes, nonpositive durations and captions partly
outside the source clip are rejected. Upstream must split/re-time such captions with
word-aware timing; this engine never silently clips text or rounds time.

All rule conditions must match. Highest priority wins; ties use ascending rule ID
(locale-independent comparison). Only that rule contributes settings. Selection records
all matching IDs and the winner. Request template/style/anchors may override the rule.
Placement processes requests by descending request priority then ascending ID. Results
are sorted by ID, so input order cannot change valid-request results.

Layout includes padding, outline and conservative shadow extents. Collision bounds are
pixel rectangles with a top-left origin. Ordered anchors are bottom-center, top-center,
center, bottom-left/right and top-left/right. Default candidates are bottom-center,
top-center, center. User-provided timed obstacles can represent existing titles or
tracked subjects; no vision model runs. Collision tests use half-open time intervals
and rectangles: touching edges or consecutive display intervals do not collide.
No fitting candidate yields `NO_PLACEMENT`, never an overlapping fallback.

## Output and failure handling

`GraphicsPlan` schema version `1.0.0` wraps unchanged Core `GraphicDecision` values with
typed properties, exact template version, measured caption/style/emphasis, placement
and rule provenance. Core `variables` contains only the actual string properties;
numbers and booleans live in the explicit typed properties map, never encoded JSON.

Invalid shared configuration (e.g. duplicate template/rule/request IDs) throws.
Individual request failures become actionable `issues`; valid requests continue.
Whitespace-only captions yield informational `EMPTY_CAPTION` issues. The planner
never mutates input, source media, project state or artifacts. The orchestrator keeps
the previous valid artifact until it accepts and validates a candidate. Partial plans
must not replace a complete artifact without an explicit acceptance policy.

Serialized ticks are decimal strings; numeric ticks, future schema versions and invalid
layouts are rejected. JSON does not prove a font/template exists on a host: inventories
and actual rendering must be checked again when the host consumes the plan.

## Premiere handoff

`@pea/premiere-adapter` exports `compilePremiereGraphicsPlan(plan, context)`.
The context supplies an existing sequence inventory, available absolute local `.mogrt`
paths, exact template-version bindings, typed host property mappings and explicit host
capabilities for MOGRT/layout/emphasis. All typed properties must be mapped. Property
units are preserved; template-specific unit conversions are the bridge's responsibility.

The compiler returns `planned` operations using this repository's bridge contract, or
`unsupported` if required capabilities are absent. It performs **no Adobe SDK calls**,
template imports or project writes. `allowPartial: true` is required to compile a plan
that contains errors. Host feature flags are declared capabilities, not detected support.

Actual Premiere application remains a separate integration: a bridge must implement
the command contract, discover resources/capabilities, measure fonts, verify sequence
identity/timebase/dimensions, apply styles/positions, and validate rendered output.
Do not interpret adapter unit tests as an actual Premiere integration test.

## Verification

With workspace dependencies already available:

```sh
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit -p packages/graphics/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p adapters/premiere/tsconfig.json
```

Package scripts also expose `test` and `typecheck`. Some pnpm versions auto-install
missing dependencies before running scripts; use direct runners if installation is not
authorized. No build or lint script was present at the implementation base.

Before enabling host writes, manually verify: actual MOGRT text/numeric/boolean bindings,
installed fonts, Korean/English/emoji shaping, lines/emphasis/outline/shadow bounds,
portrait/landscape safe areas, simultaneous elements, fractional frame rates/drop-frame
identity and failed application preserving the previous project/artifact.
