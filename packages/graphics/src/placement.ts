import { z } from "zod";
import type { TimeRange } from "@pea/core";
import { AnchorSchema, BoxSchema, CanvasSchema, type Anchor, type Box, type Canvas } from "./contracts.js";
import { GraphicsRangeSchema, rangesOverlap } from "./time.js";

export const ObstacleSchema = z.object({ box: BoxSchema, range: GraphicsRangeSchema }).strict();
export type Obstacle = z.infer<typeof ObstacleSchema>;
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
export function boxInsideSafeArea(box: Box, canvas: Canvas): boolean {
  return box.x >= canvas.safe.left && box.y >= canvas.safe.top
    && box.x + box.width <= canvas.width - canvas.safe.right
    && box.y + box.height <= canvas.height - canvas.safe.bottom;
}
export function placeGraphic(input: {
  canvas: Canvas; size: { width: number; height: number }; range: TimeRange;
  anchors: readonly Anchor[]; obstacles: readonly Obstacle[];
}): Box | null {
  const canvas = CanvasSchema.parse(input.canvas), range = GraphicsRangeSchema.parse(input.range);
  const size = BoxSchema.pick({ width: true, height: true }).parse(input.size);
  const anchors = z.array(AnchorSchema).min(1).parse(input.anchors);
  const obstacles = z.array(ObstacleSchema).parse(input.obstacles);
  for (const anchor of anchors) {
    const x = anchor.endsWith("left") ? canvas.safe.left
      : anchor.endsWith("right") ? canvas.width - canvas.safe.right - size.width
      : canvas.safe.left + (canvas.width - canvas.safe.left - canvas.safe.right - size.width) / 2;
    const y = anchor.startsWith("top") ? canvas.safe.top
      : anchor.startsWith("bottom") ? canvas.height - canvas.safe.bottom - size.height
      : canvas.safe.top + (canvas.height - canvas.safe.top - canvas.safe.bottom - size.height) / 2;
    const box = { x, y, ...size };
    if (boxInsideSafeArea(box, canvas) && !obstacles.some(obstacle => rangesOverlap(range, obstacle.range) && boxesOverlap(box, obstacle.box))) return box;
  }
  return null;
}
