/**
 * Which cut a motion transition from the library goes on, from what the
 * person pointed at: two selected clips that meet, the cut after (else
 * before) one selected clip, or the cut nearest the playhead. The cuts
 * themselves are the engine's (`trackCuts`).
 */
import { trackCuts, type Clip, type MotionCut, type Project } from "@zenvi/engine";

function hasPicture(clip: Clip): boolean {
  return clip.reader?.has_video !== false;
}

export function pictureCuts(project: Project): MotionCut[] {
  return project.layers.flatMap((l) => trackCuts(project, l.number)).filter((c) => hasPicture(c.outClip) && hasPicture(c.inClip));
}

export function targetCut(project: Project, selectedClipIds: readonly string[], time: number): MotionCut | null {
  const cuts = pictureCuts(project);
  if (cuts.length === 0) return null;
  const selected = new Set(selectedClipIds);
  if (selected.size >= 2) {
    const between = cuts.find((c) => selected.has(c.outClip.id) && selected.has(c.inClip.id));
    if (between) return between;
  }
  if (selected.size >= 1) {
    const first = selectedClipIds[0]!;
    const own = cuts.find((c) => c.outClip.id === first) ?? cuts.find((c) => c.inClip.id === first);
    if (own) return own;
  }
  return cuts.reduce((best, c) => (Math.abs(c.cut - time) < Math.abs(best.cut - time) ? c : best));
}
