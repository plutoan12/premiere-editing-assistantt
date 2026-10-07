# Caption rendering follow-up — 2026-10-08

The user requested the next step after the original-template preview passed live
verification: apply caption text, styling and placement in Premiere. The current
preview remains usable; its `graphicsApplied:false` result is still accurate.

## Confirmed compatibility boundary

- The installed application is Premiere Pro **26.5.2**. Its bundle version was checked
  again during this investigation.
- In the preceding live run, Basic Lower Third's two source-text values and Gaming
  Lower Third Left's title/subtitle values were unavailable to the UXP inspector.
- Adobe's official type changelog introduces `MogrtText` and `MogrtComment` under
  **27.0.0-beta.22**, dated 2026-09-14. The official sample groups MOGRT text inspection
  under 27.0.0. Those newer examples cannot establish support in the installed 26.5.2.
- The newer `MogrtText` declaration includes text/font setters, with template-author
  editability checks. `setText` collapses mixed text runs to one run, so it cannot alone
  preserve the engine's per-span emphasis. A font setter alone also does not implement
  measured wrapping, outlines, shadows or safe-area placement.

These findings establish the documented API version gap. They are not a claim that
every possible legacy or alternate Premiere integration is impossible. No 27.x host
test, upgrade, dependency installation or new caption write was performed here.

## Implementation choice awaiting user preference

| Route | User-visible result | Work still required |
| --- | --- | --- |
| Transparent caption graphics on 26.5.2 | Text/style/placement rendered into a separate image clip; text changes regenerate the asset | Real font measurement and rasterization, alpha output, import/timing verification; explicitly identify the asset as a rendered caption |
| Editable MOGRT text | Keep text and supported font controls editable inside the template | A host exposing the newer API, template-specific bindings and editability checks, full readback/visual tests; separate handling for unsupported style/emphasis/placement |

No route has been silently selected. Image rendering changes the editing workflow;
installing/upgrading Premiere is also outside the current implementation action.
The panel must not claim full-plan support merely because a newer text constructor
exists. Core and the pure GraphicsPlan contracts remain unchanged.

## Primary evidence

- [Adobe type changelog at the inspected commit](https://github.com/adobe/premierepro-types/blob/c8f108941197c1d987f08b9916c0d18a2e252699/CHANGELOG.md)
- [Adobe MogrtText / ComponentParam declarations at the same commit](https://github.com/adobe/premierepro-types/blob/c8f108941197c1d987f08b9916c0d18a2e252699/src/premierepro.d.ts)
- [Adobe sample: 27.0.0 MOGRT text handlers](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/main/sample-panels/premiere-api/index.ts)
- [Existing 26.5.2 host receipts](evidence/2026-10-08-graphics-host-smoke.json)
