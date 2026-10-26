/**
 * Playback resolution that follows render cost: when frames take longer than
 * a frame lasts, the next ones are planned in a smaller box (as a smaller
 * preview window would be, `Timeline::SetMaxSize`) and scaled up on screen;
 * when they are cheap again, the box grows back. Cost follows the pixel
 * count, so a step from `s` to `t` multiplies it by about (t/s)².
 */

/** Scales of the canvas box playback may use, largest first. */
export const PLAYBACK_SCALES = [1, 0.75, 0.5, 0.375] as const;

/** Frames measured after a change before deciding again (decoders and caches settle). */
const SETTLE_FRAMES = 2;
/** Smoothing of the per-frame cost. */
const WEIGHT = 0.3;

export class AdaptiveScale {
  private index = 0;
  private average: number | null = null;
  private measured = 0;

  /** The scale to plan the next playback frame at. */
  get scale(): number {
    return PLAYBACK_SCALES[this.index]!;
  }

  /** A playback frame at `scale` took `ms`; a frame lasts `budgetMs`. */
  record(ms: number, budgetMs: number): void {
    if (!(ms >= 0) || !(budgetMs > 0)) return;
    this.average = this.average === null ? ms : this.average + WEIGHT * (ms - this.average);
    this.measured += 1;
    if (this.measured < SETTLE_FRAMES) return;
    const average = this.average;
    const scale = this.scale;
    if (average > budgetMs * 1.15 && this.index < PLAYBACK_SCALES.length - 1) {
      // The largest scale predicted to fit, at least one step down.
      const fits = scale * Math.sqrt(budgetMs / average);
      let next = this.index + 1;
      while (next < PLAYBACK_SCALES.length - 1 && PLAYBACK_SCALES[next]! > fits) next += 1;
      this.set(next);
    } else if (this.index > 0) {
      const up = PLAYBACK_SCALES[this.index - 1]!;
      // Grow only when the bigger box is predicted to stay well inside the budget.
      if (average * (up / scale) ** 2 < budgetMs * 0.8) this.set(this.index - 1);
    }
  }

  private set(index: number): void {
    this.index = index;
    this.average = null;
    this.measured = 0;
  }
}
