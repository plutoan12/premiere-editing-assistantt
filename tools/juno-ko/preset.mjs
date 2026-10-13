/** Juno-inspired Korean preview helpers. No SDK calls, media uploads or host writes. */
export const preset = Object.freeze({
  id: 'juno-ko', version: '0.1.0', maxLines: 2,
  fontFamily: 'Noto Sans CJK KR', fontSizeAt1080: 56,
  foreground: '#ffffff', highlight: '#ffdd00', outline: '#101010',
  popScale: 1.1, popSeconds: 0.35,
  nativeMogrtAvailable: false, mogrtWriteVerified: false,
});
const TICKS_PER_SECOND = 254016000000n;
const MAX_TICKS = 9223372036854775807n;
const fail = code => { throw new Error(code); };

export function normalizeCaption(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 16384
      || /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/u.test(input)) fail('INVALID_CAPTION');
  return input.replace(/\r\n?/g, '\n').normalize('NFC');
}

/** measureText must use the same actual font, weight and size as the renderer.
 * Offsets are UTF-16 offsets into normalized text. Never truncates or shrinks.
 * Prefer whitespace breaks; fall back to grapheme boundaries for long words.
 */
export function layoutCaption(input, measureText, maxWidth, maxLines = 2) {
  const text = normalizeCaption(input);
  if (typeof measureText !== 'function' || !Number.isFinite(maxWidth) || maxWidth <= 0
      || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > 10) fail('INVALID_LAYOUT');
  if (typeof Intl.Segmenter !== 'function') fail('SEGMENTER_UNAVAILABLE');
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  const measure = value => {
    const width = measureText(value);
    if (!Number.isFinite(width) || width < 0) fail('INVALID_MEASUREMENT');
    return width;
  };
  const lines = [];
  let offset = 0, tooWide = false;
  for (const paragraph of text.split('\n')) {
    const chars = [...segmenter.segment(paragraph)];
    if (!chars.length) lines.push({ text: '', start: offset, end: offset, width: 0 });
    let from = 0;
    while (from < chars.length) {
      let to = from, lastSpace = -1;
      while (to < chars.length) {
        const end = chars[to].index + chars[to].segment.length;
        if (measure(paragraph.slice(chars[from].index, end)) > maxWidth) break;
        if (/^\s+$/u.test(chars[to].segment)) lastSpace = to + 1;
        to++;
      }
      if (to === from) { to++; tooWide = true; }
      else if (to < chars.length && lastSpace > from) to = lastSpace;
      const start = chars[from].index;
      const end = chars[to - 1].index + chars[to - 1].segment.length;
      const value = paragraph.slice(start, end);
      lines.push({ text: value, start: offset + start, end: offset + end, width: measure(value) });
      from = to;
    }
    offset += paragraph.length + 1;
  }
  const code = tooWide ? 'GLYPH_TOO_WIDE' : lines.length > maxLines ? 'TOO_MANY_LINES' : null;
  return { text, lines, status: code ? 'overflow' : 'ready', code };
}

export function frameTicks(numerator, denominator) {
  if (![numerator, denominator].every(x => Number.isSafeInteger(x) && x > 0)) fail('INVALID_FRAME_RATE');
  const scaled = TICKS_PER_SECOND * BigInt(denominator), n = BigInt(numerator);
  if (scaled % n !== 0n) fail('UNREPRESENTABLE_FRAME_RATE');
  const result = scaled / n;
  if (result < 1n || result > BigInt(Number.MAX_SAFE_INTEGER)) fail('UNREPRESENTABLE_FRAME_RATE');
  return result;
}

/** Text-only TEST draft for the existing PEA plan picker. A CSS preview is NOT a
 * MOGRT. Caller must supply the real asset's ID/version/path; this cannot verify
 * asset existence or font coverage. It never unlocks the native text-write gate.
 */
export function buildTextDraft(input, binding, timing) {
  const text = normalizeCaption(input);
  if (!binding || !timing) fail('BINDING_AND_TIMING_REQUIRED');
  for (const key of ['templateId', 'templateVersion']) {
    const value = binding[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 256
        || /[\x00-\x1f\x7f]/u.test(value)) fail('INVALID_TEMPLATE_IDENTITY');
  }
  const path = binding.templatePath;
  if (typeof path !== 'string' || /[\x00-\x1f\x7f]/u.test(path)
      || !/\.mogrt$/i.test(path) || !(/^\/(?!\/)/.test(path) || /^[A-Za-z]:[\\/]/.test(path))
      || path.split(/[\\/]/).includes('..')) fail('INVALID_TEMPLATE_PATH');
  for (const key of ['width', 'height'])
    if (!Number.isSafeInteger(timing[key]) || timing[key] < 1 || timing[key] > 32768) fail('INVALID_CANVAS');
  if (!Number.isSafeInteger(timing.startFrame) || timing.startFrame < 0
      || !Number.isSafeInteger(timing.durationFrames) || timing.durationFrames <= 0) fail('INVALID_FRAMES');
  const frame = frameTicks(timing.fpsNumerator, timing.fpsDenominator);
  const start = BigInt(timing.startFrame) * frame, duration = BigInt(timing.durationFrames) * frame;
  if (start + duration > MAX_TICKS) fail('TICK_OVERFLOW');
  return {
    schemaVersion: '1.0.0', mode: 'editable-text-draft',
    preview: {
      schemaVersion: '1.0.0', mode: 'template-preview', decisionId: 'juno-ko-text-probe',
      templateId: binding.templateId, templateVersion: binding.templateVersion, templatePath: path,
      startTicks: start.toString(), durationTicks: duration.toString(), frameTicks: frame.toString(),
      canvas: { width: timing.width, height: timing.height },
    },
    edit: { text },
  };
}
