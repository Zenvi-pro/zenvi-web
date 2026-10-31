/** The hit a kinetic cut fires (runtime/kinetic.ts); DOM-free so node-side checks can plan hits too. */

/** A hit at `t` s: `strength` 1 for a cut, 0.5-0.6 for an off-beat cut, 1.3-1.4 for the climax; `shake` in design px. */
export interface Hit {
  t: number;
  strength: number;
  shake?: number;
  /** Scales the hit's flash (default 1); 0 punches without a flash, to keep flashes 3 a second or fewer (WCAG 2.3.1). */
  flash?: number;
}
