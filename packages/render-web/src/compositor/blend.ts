/**
 * libopenshot `CompositeType` → Canvas2D `globalCompositeOperation`.
 *
 * libopenshot's codes are `QPainter::CompositionMode` values (`Enums.h`,
 * libopenshot-semantics §2.8). Canvas2D implements the same Porter-Duff and
 * W3C blend formulas; the unbounded Porter-Duff modes (copy, source-in, …)
 * affect the whole frame outside the layer, as libopenshot's full-canvas
 * clip image does. Qt computes in 8-bit integers, so expect ±1 LSB.
 */

/** How to composite one layer. */
export type LayerComposite =
  | { kind: "draw"; operation: GlobalCompositeOperation }
  /** QPainter Destination: the layer changes nothing. */
  | { kind: "skip" }
  /** QPainter Clear: the frame becomes transparent whatever the layer holds. */
  | { kind: "clear" };

const OPERATIONS: Record<number, GlobalCompositeOperation> = {
  0: "source-over",
  1: "destination-over",
  3: "copy",
  5: "source-in",
  6: "destination-in",
  7: "source-out",
  8: "destination-out",
  9: "source-atop",
  10: "destination-atop",
  11: "xor",
  12: "lighter",
  13: "multiply",
  14: "screen",
  15: "overlay",
  16: "darken",
  17: "lighten",
  18: "color-dodge",
  19: "color-burn",
  20: "hard-light",
  21: "soft-light",
  22: "difference",
  23: "exclusion",
};

/** The compositing for `composite`; unknown codes draw normally (source-over). */
export function layerComposite(composite: number | undefined): LayerComposite {
  if (composite === 2) return { kind: "clear" };
  if (composite === 4) return { kind: "skip" };
  const operation = composite === undefined ? undefined : OPERATIONS[composite];
  return { kind: "draw", operation: operation ?? "source-over" };
}
