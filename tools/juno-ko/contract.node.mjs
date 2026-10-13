import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCaption, layoutCaption, buildTextDraft, frameTicks, preset } from './preset.mjs';

const measure = (text) => [...new Intl.Segmenter('ko', {granularity:'grapheme'}).segment(text)].length * 10;
const binding = {templateId:'manual-test', templateVersion:'1.0.0', templatePath:'/tmp/example.mogrt'};
const timing = {width:1920, height:1080, fpsNumerator:30000, fpsDenominator:1001, startFrame:60, durationFrames:90};

test('normalizes Korean composed characters without dropping emoji', () => {
  assert.equal(normalizeCaption('한글 👩🏽‍💻'), '한글 👩🏽‍💻');
});
test('normalizes CRLF and CR, preserving explicit newlines', () => {
  assert.equal(normalizeCaption('첫 줄\r\n둘째\r셋째'), '첫 줄\n둘째\n셋째');
});
test('rejects empty/control/nonstring input', () => {
  for (const input of ['', '   ', 'x\u0000', 'x\t', null, 3]) assert.throws(() => normalizeCaption(input));
});
test('limits caption size before measuring', () => assert.throws(() => normalizeCaption('가'.repeat(16385))));
test('wraps at whitespace when possible and preserves every character', () => {
  const r = layoutCaption('오늘은 정말 좋은 날', measure, 80, 2);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines.map(x => x.text).join(''), r.text);
  assert.ok(r.lines.every(x => measure(x.text) <= 80));
});
test('preserves hard line breaks and offsets', () => {
  const r = layoutCaption('첫 줄\n둘째 줄', measure, 100, 2);
  assert.deepEqual(r.lines.map(x => x.text), ['첫 줄','둘째 줄']);
  for (const line of r.lines) assert.equal(r.text.slice(line.start, line.end), line.text);
});
test('never splits an emoji ZWJ cluster', () => {
  const r = layoutCaption('가👩🏽‍💻나', measure, 20, 2);
  assert.deepEqual(r.lines.map(x => x.text), ['가👩🏽‍💻','나']);
});
test('marks too many lines as overflow without truncating text', () => {
  const text = '가'.repeat(20);
  const r = layoutCaption(text, measure, 30, 2);
  assert.equal(r.status, 'overflow');
  assert.equal(r.lines.map(x => x.text).join(''), text);
  assert.equal(r.code, 'TOO_MANY_LINES');
});
test('reports unrenderable single glyph width', () => {
  const r = layoutCaption('가', measure, 5, 2);
  assert.equal(r.status, 'overflow');
  assert.equal(r.code, 'GLYPH_TOO_WIDE');
});
test('rejects invalid measurement and layout limits', () => {
  for(const width of [0,-1,NaN,Infinity]) assert.throws(() => layoutCaption('가',measure,width,2));
  assert.throws(() => layoutCaption('가',() => NaN,100,2));
  assert.throws(() => layoutCaption('가',() => -1,100,2));
  assert.throws(() => layoutCaption('가',measure,100,0));
});
test('timebase uses exact fractional-fps ticks', () => {
  assert.equal(frameTicks(30000,1001),8475667200n);
  assert.equal(frameTicks(24000,1001),10594584000n);
});
test('rejects approximate/nonrepresentable frame rates', () => {
  for (const [n,d] of [[29.97,1],[0,1],[30,0],[NaN,1],[11,3]]) assert.throws(() => frameTicks(n,d));
});
test('draft matches the existing editable-text-draft wire contract', () => {
  const d = buildTextDraft('안녕\n한글 👩🏽‍💻',binding,timing);
  assert.equal(d.mode,'editable-text-draft');
  assert.equal(d.preview.mode,'template-preview');
  assert.equal(d.preview.startTicks,'508540032000');
  assert.equal(d.preview.durationTicks,'762810048000');
  assert.equal(d.edit.text,'안녕\n한글 👩🏽‍💻');
  assert.deepEqual(Object.keys(d.edit),['text']);
  assert.deepEqual(Object.keys(d).sort(),['edit','mode','preview','schemaVersion']);
});
test('does not invent MOGRT identity, version or asset path', () => {
  for (const key of ['templateId','templateVersion','templatePath']) assert.throws(() => buildTextDraft('가',{...binding,[key]:''},timing));
});
test('rejects relative, traversal, UNC and control-character asset paths', () => {
  for (const p of ['x.mogrt','/tmp/../x.mogrt','//host/a.mogrt','/tmp/a.json','/tmp/a\n.mogrt']) assert.throws(() => buildTextDraft('가',{...binding,templatePath:p},timing));
});
test('accepts an explicit local Windows MOGRT path', () => {
  assert.equal(buildTextDraft('가',{...binding,templatePath:'C:\\test\\x.mogrt'},timing).preview.templatePath,'C:\\test\\x.mogrt');
});
test('rejects fractional frames, zero duration and invalid dimensions', () => {
  for (const patch of [{startFrame:0.5},{durationFrames:0},{durationFrames:-1},{height:0},{width:32769},{width:1.1}]) assert.throws(() => buildTextDraft('가',binding,{...timing,...patch}));
});
test('rejects tick overflow and never emits numeric ticks', () => {
  assert.throws(() => buildTextDraft('가',binding,{...timing,startFrame:Number.MAX_SAFE_INTEGER}));
  const d = buildTextDraft('가',binding,timing);
  for(const k of ['startTicks','durationTicks','frameTicks']) assert.equal(typeof d.preview[k],'string');
});
test('caller mutations cannot change a generated request', () => {
  const t={...timing}, b={...binding}; const d=buildTextDraft('가',b,t);
  t.width=1; b.templateId='changed';
  assert.equal(d.preview.canvas.width,1920); assert.equal(d.preview.templateId,'manual-test');
});
test('preset is Korean-first, limited to preview, and does not bundle a MOGRT', () => {
  assert.equal(preset.id,'juno-ko'); assert.equal(preset.maxLines,2);
  assert.equal(preset.nativeMogrtAvailable,false);
  assert.equal(preset.mogrtWriteVerified,false);
});
