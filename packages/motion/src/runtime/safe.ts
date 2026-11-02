/** Title-safe insets (TASTE.md §3), DOM-free: blocks, scenes and the Node side's scene audit share them. */

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Title-safe insets of a design frame. */
export function safeArea(width: number, height: number): Rect {
  if (height > width * 1.2) return { top: Math.round(height * 0.12), bottom: Math.round(height * 0.2), left: Math.round(width * 0.1), right: Math.round(width * 0.1) };
  return { top: Math.round(height * 0.1), bottom: Math.round(height * 0.1), left: Math.round(width * 0.1), right: Math.round(width * 0.1) };
}
