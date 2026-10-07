# PEA Graphics Preview (development)

Premiere Pro 26.2+ UXP panel. The supported operation is **original-template preview**:
create a new sequence, configure its frame size/rate, insert a chosen MOGRT, trim its
end, and read the actual start/end ticks back. Existing sequence contents are not used
as the insertion target. The panel does not save the project automatically.

Caption text, styling, emphasis, planned placement and template-property overrides are
**not applied**. Every receipt has `graphicsApplied: false` and lists these omissions.
The panel must not be described as the full GraphicsPlan renderer. On local Premiere
26.5.2, Basic Lower Third exposed two text components after loading, but their source-text
values were unavailable to this inspector. An AE Gaming Lower Third also exposed
unavailable title/subtitle values after its Capsule component finished loading.

The final panel was verified in Premiere 26.5.2 with both templates: sequence settings,
insertion, exact start/end readback, property inspection and visible original graphics.
Receipt export was also verified. See the [host verification record](../../docs/graphics-engine-verification.md#final-production-panel-replay--2026-10-08).

## Build and load

From the repository root (after the normal workspace dependency setup):

```sh
node apps/premiere-graphics-panel/build.cjs
```

This uses the existing TypeScript dependency, with no extra bundler or Adobe SDK package.
Load `dist/manifest.json` from this panel directory using Adobe UXP Developer Tools.
The output is a development folder, not a signed CCX installer. The only requested
permission is file access through pickers; no network permissions are requested.

1. Open a disposable test project in Premiere.
2. In PEA Graphics Preview, choose a `.mogrt` using **MOGRT 선택**.
3. Choose **새 시퀀스에서 미리보기**. The default example uses 1920×1080 at
   30000/1001 fps, starts at frame 60 and lasts 30 frames.
4. Verify the picture and timing in the new `PEA Preview · …` sequence. Use
   **템플릿 속성 확인** after AE loading settles, and **결과 저장** for the receipt.
5. A `needs-review` result can mean partial edits remain. Inspect its sequence ID and
   Premiere history before starting another preview. There is no automatic retry or
   rollback; MOGRT import and subsequent transactions are separate undo steps.

The button is disabled after a result to prevent accidental repeated insertion. Selecting
another template or plan explicitly starts a new preview. A file's template version cannot
be inferred from its filename: select the correct asset for the plan's template/version.

## Connecting a GraphicsPlan

The public adapter turns a validated engine decision into the intentionally limited wire
request that **미리보기 계획 불러오기** accepts:

```ts
import { createMogrtPreviewRequest } from '@pea/premiere-adapter';
const request = createMogrtPreviewRequest(plan, 'caption-a', exactVersionBinding);
// Serialize request as JSON and load it in the panel, then select the matching MOGRT.
```

`exactVersionBinding` uses the existing compiler binding contract: templateId,
templateVersion, absolute templatePath and propertyMap. The preview does not consume
propertyMap as edits. After a plan is loaded, template selection is reset. The panel
captures the project identity when the template is selected and rejects a project switch.

The request contains canonical decimal ticks (`startTicks`, `durationTicks`, `frameTicks`).
Conversion uses 254016000000 ticks/second and exact bigint division. The host boundary
rejects fractional frames, unsupported rational conversions, zero duration and values
outside signed 64-bit ticks, even though the engine can represent larger bigint values.
Frame dimensions are integral pixels and ticks per frame must fit a safe JS integer for
Adobe's FrameRate setter. Timecode display/drop-frame labels are not configured; physical
frame timing is preserved and checked against the created sequence's timebase.

## API references

- [SequenceEditor: MOGRT insertion](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor)
- [TickTime: string ticks](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/ticktime)
- [SequenceSettings](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequencesettings)
- [Project transactions](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project)

Full text/layout rendering still requires a tested template-specific renderer and a
supported text API. The existing `compilePremiereGraphicsPlan` capability gate remains
unchanged; this preview panel does not declare `captionLayout` or `emphasis` support.
