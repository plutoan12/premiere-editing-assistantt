import type { CaptionStyle } from "./contracts.js";

/** Shared effect bounds for layout generation and imported-plan validation. */
export function captionInsets(style: CaptionStyle) {
  const edge = style.padding + style.outlineWidth + style.shadowBlur;
  return {
    left: edge + Math.max(0, -style.shadowOffsetX), right: edge + Math.max(0, style.shadowOffsetX),
    top: edge + Math.max(0, -style.shadowOffsetY), bottom: edge + Math.max(0, style.shadowOffsetY),
  };
}

/** Every explicit paragraph must be represented, and soft wraps must split graphemes safely. */
export function preservesLineBreaks(text: string, lines: readonly string[]): boolean {
  let lineIndex = 0;
  const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      if (lines[lineIndex++] !== "") return false;
      continue;
    }
    const boundaries = new Set(Array.from(segmenter.segment(paragraph), part => part.index + part.segment.length));
    let offset = 0;
    while (offset < paragraph.length) {
      const line = lines[lineIndex++];
      if (!line || !paragraph.startsWith(line, offset)) return false;
      offset += line.length;
      if (!boundaries.has(offset)) return false;
    }
  }
  return lineIndex === lines.length;
}
