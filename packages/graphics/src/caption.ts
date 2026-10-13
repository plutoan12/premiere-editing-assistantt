import { z } from "zod";
import { CaptionStyleSchema, DEFAULT_STYLE, GraphicsError, PropertyValueSchema, TemplateSchema,
  type CaptionStyle, type PropertyValue } from "./contracts.js";
import { captionInsets } from "./layout-metrics.js";

export function resolveTemplate(input: unknown, caption: string, overrides: unknown, availableAssets: readonly string[]) {
  const template = TemplateSchema.parse(input);
  const values = z.record(z.string(), PropertyValueSchema).parse(overrides);
  for (const asset of template.requiredAssets) {
    if (!availableAssets.includes(asset)) throw new GraphicsError("MISSING_ASSET", `Missing template asset: ${asset}`);
  }
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(template.properties, key)) throw new GraphicsError("UNKNOWN_PROPERTY", `Unknown template property: ${key}`);
    if (key === template.captionProperty) throw new GraphicsError("CAPTION_PROPERTY", "Caption property is owned by the caption text");
  }
  const entries: [string, PropertyValue][] = [];
  for (const [key, definition] of Object.entries(template.properties)) {
    const value = key === template.captionProperty ? caption : Object.hasOwn(values, key) ? values[key] : definition.default;
    if (value === undefined) {
      if (definition.required) throw new GraphicsError("MISSING_PROPERTY", `Missing template property: ${key}`);
      continue;
    }
    if (typeof value !== definition.type) throw new GraphicsError("PROPERTY_TYPE", `Wrong type for ${key}: expected ${definition.type}`);
    if (definition.type === "number" && typeof value === "number"
      && ((definition.min !== undefined && value < definition.min) || (definition.max !== undefined && value > definition.max)))
      throw new GraphicsError("PROPERTY_RANGE", `Property ${key} is outside its allowed range`);
    entries.push([key, value]);
  }
  return { template, properties: Object.fromEntries(entries) };
}

export function resolveStyle(defaults: Partial<CaptionStyle>, preset: Partial<CaptionStyle>, override: Partial<CaptionStyle>,
  frameHeight: number, availableFonts: readonly string[]): CaptionStyle {
  const partial = CaptionStyleSchema.partial();
  const style = CaptionStyleSchema.parse({ ...DEFAULT_STYLE, ...partial.parse(defaults), ...partial.parse(preset), ...partial.parse(override) });
  if (!availableFonts.includes(style.fontFamily)) throw new GraphicsError("MISSING_FONT", `Unavailable font: ${style.fontFamily}`);
  if (!Number.isFinite(frameHeight) || frameHeight <= 0) throw new GraphicsError("INVALID_CANVAS", "Invalid frame height");
  const scale = frameHeight / style.referenceHeight;
  return CaptionStyleSchema.parse({ ...style, referenceHeight: frameHeight,
    fontSize: style.fontSize * scale, padding: style.padding * scale, outlineWidth: style.outlineWidth * scale,
    shadowBlur: style.shadowBlur * scale, shadowOffsetX: style.shadowOffsetX * scale, shadowOffsetY: style.shadowOffsetY * scale });
}

/** Host-supplied glyph shaping/measurement. Return advance width in output pixels. */
export type TextMeasurer = (text: string, style: Readonly<CaptionStyle>) => number;
export function layoutCaption(text: string, input: CaptionStyle, maxWidth: number, measure: TextMeasurer) {
  const style = CaptionStyleSchema.parse(input);
  const { left, right, top, bottom } = captionInsets(style);
  const contentWidth = maxWidth - left - right;
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) throw new GraphicsError("TEXT_OVERFLOW", "Caption cannot fit available width");
  const widthOf = (value: string) => {
    let width: number;
    try { width = measure(value, Object.freeze({ ...style })); }
    catch (error) {
      throw new GraphicsError("MEASUREMENT_FAILED", `Text measurement failed: ${error instanceof Error ? error.message : "unknown provider error"}`);
    }
    if (!Number.isFinite(width) || width < 0) throw new GraphicsError("INVALID_MEASUREMENT", "Invalid text measurement");
    return width;
  };
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  for (const paragraph of normalized.split("\n")) {
    let line = "";
    for (const { segment } of segmenter.segment(paragraph)) {
      if (widthOf(line + segment) > contentWidth) {
        if (!line || widthOf(segment) > contentWidth) throw new GraphicsError("TEXT_OVERFLOW", "A grapheme cannot fit available width");
        lines.push(line); line = segment;
      } else line += segment;
    }
    lines.push(line);
  }
  if (lines.length > style.maxLines) throw new GraphicsError("TEXT_OVERFLOW", `Caption exceeds ${style.maxLines} lines`);
  const width = Math.max(...lines.map(widthOf)) + left + right;
  const height = lines.length * style.fontSize * style.lineHeight + top + bottom;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new GraphicsError("INVALID_MEASUREMENT", "Invalid caption bounds");
  return { text: normalized, lines, width, height, contentOffset: { x: left, y: top } };
}
