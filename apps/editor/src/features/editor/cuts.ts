/**
 * Which cut a motion transition from the library goes on, from what the
 * person pointed at: two selected clips that meet, the cut after (else
 * before) one selected clip, or the cut nearest the playhead. The cuts
 * themselves are the engine's (`trackCuts`).
 *
 * Clips added by double-click land one frame apart (the desktop's
 * placement), which is not a cut: `tinyGapTrack` finds a sequence that is
 * only split by such gaps, so a gesture can close them first.
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

/** Gaps up to this many frames read as "meant to touch". */
const TINY_GAP_FRAMES = 2;

/**
 * The picture track whose clips are separated only by gaps of a frame or
 * two (none longer, so deliberate gaps are left alone), with the most of
 * them; `from` is just after its first clip starts, so closing the gaps
 * does not move the sequence's start.
 */
export function tinyGapTrack(project: Project): { layer: number; gaps: number; from: number } | null {
  const fps = project.fps.num / project.fps.den;
  let best: { layer: number; gaps: number; from: number } | null = null;
  for (const layer of [...project.layers].sort((a, b) => a.number - b.number)) {
    const clips = project.clips.filter((c) => c.layer === layer.number && hasPicture(c)).sort((a, b) => a.position - b.position);
    if (clips.length < 2) continue;
    const frames = clips.slice(1).map((c, i) => Math.round((c.position - (clips[i]!.position + clips[i]!.end - clips[i]!.start)) * fps));
    if (frames.some((g) => g < 0 || g > TINY_GAP_FRAMES)) continue;
    const gaps = frames.filter((g) => g > 0).length;
    if (gaps > 0 && (!best || gaps > best.gaps)) best = { layer: layer.number, gaps, from: clips[0]!.position + 0.5 / fps };
  }
  return best;
}
