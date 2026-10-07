/**
 * Project duration. The desktop keeps `project.duration` at least 300 s and
 * at least 10 s past the last item, growing it (never shrinking it) after
 * edits, as untracked UI state (timeline.py `_extend_timeline_to_fit_items`,
 * `resizeTimeline` → `update_untracked(["duration"], …)`).
 */

import type { ProjectDocument } from "../history/document.js";
import type { Project } from "../model/types.js";
import { timelineEnd } from "./queries.js";

/** Minimum project duration, seconds (timeline.py `_extend_timeline_to_fit_items`). */
export const MIN_PROJECT_DURATION = 300;
/** Room kept after the last item, seconds. */
export const DURATION_PADDING = 10;

/**
 * The duration the desktop would give the project after an edit: the
 * current duration, grown to `max(300, end of last item + 10)` when that is
 * longer (by more than 1 ms).
 */
export function projectDuration(project: Project): number {
  const desired = Math.max(MIN_PROJECT_DURATION, timelineEnd(project) + DURATION_PADDING);
  const current = typeof project.duration === "number" && Number.isFinite(project.duration) ? project.duration : 0;
  return desired > current + 1e-3 ? desired : current;
}

/**
 * Grow `doc.project.duration` to fit its items (untracked, like the desktop).
 * Returns true when it changed.
 */
export function fitDuration(doc: ProjectDocument): boolean {
  const next = projectDuration(doc.project);
  if (next === doc.project.duration) return false;
  doc.setUntracked(["duration"], next);
  return true;
}

/**
 * Keep the duration fitted after every edit, undo and redo. Returns the
 * unsubscribe function.
 */
export function autoFitDuration(doc: ProjectDocument): () => void {
  return doc.subscribe((event) => {
    if (event.source === "untracked") return;
    fitDuration(doc);
  });
}
