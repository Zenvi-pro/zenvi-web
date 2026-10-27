/**
 * Too few sources for a cut's pace: shots that bring a file back within
 * `REUSE_GAP_SECONDS` of its last time on screen (bench round 3: 16 of 28
 * gap lists said shots come back within 3 s). The montage tools warn, or
 * refuse with `strict_variety`, and say how many more files the pace needs.
 */

import { REUSE_GAP_SECONDS, reuseStats } from "../reels/plan.js";

export interface VarietyShot {
  fileId: string;
  /** Timeline seconds. */
  start: number;
  end: number;
}

/** What is short, in words (no `Error:` prefix), or null when no file comes back too soon. */
export function varietyProblem(shots: readonly VarietyShot[]): string | null {
  const { closeRepeats, clipsNeeded } = reuseStats(shots);
  // Counted from the shots, not file_ids: a file that fits no shot is given but never on screen.
  const used = new Set(shots.map((s) => s.fileId)).size;
  if (closeRepeats === 0 || used >= clipsNeeded) return null;
  return (
    `${closeRepeats} shot(s) bring a file back within ${REUSE_GAP_SECONDS} s: this pace needs about ${clipsNeeded} different files and the cut uses ${used}. ` +
    `Import ${clipsNeeded - used} more (gather_stock_footage_tool imports several in one call) and rebuild with replace=true.`
  );
}
