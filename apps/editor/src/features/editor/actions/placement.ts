/**
 * Where the editor's "Add to timeline" gesture (bin double-click, the +
 * button, dropping files to start) puts a file when the person did not
 * choose a spot.
 *
 * The time follows the desktop's `_do_add` defaults (zenvi-core
 * tool_handlers.py, ported in the engine's `add_clip_to_timeline_tool`):
 * audio-only files at 0 s, video and images one frame after the last clip
 * on the selected clip's track (else the bottom track). Unlike the
 * Assistant's tool, the gesture never stacks a clip on top of another one:
 * it takes the lowest track that is free over the clip's span — below the
 * picture for audio-only files — and adds a track when none is, all as one
 * undo step. The Assistant keeps the desktop semantics exactly.
 */
import {
  addClip,
  addTrack,
  frameDuration,
  isAudioOnlyMedia,
  moveClip,
  sortedLayers,
  type Clip,
  type Project,
  type ProjectFile,
  type Transaction,
} from "@zenvi/engine";
import type { EditorSession } from "../session/EditorSession";

export interface PlacementSpot {
  layer: number;
  position: number;
}

function bottomTrack(project: Project): number | null {
  return sortedLayers(project).find((l) => !l.lock)?.number ?? null;
}

/** The desktop `_do_add` default spot for `file` (see module comment). */
export function desktopPlacement(project: Project, file: ProjectFile, selectedLayer: number | null): PlacementSpot | null {
  const audio = isAudioOnlyMedia(file);
  const layer = audio ? bottomTrack(project) : (selectedLayer ?? bottomTrack(project));
  if (layer === null) return null;
  if (audio) return { layer, position: 0 };
  const onTrack = project.clips.filter((c) => c.layer === layer);
  const end = onTrack.reduce((max, c) => Math.max(max, c.position + (c.end - c.start)), 0);
  return { layer, position: onTrack.length > 0 ? end + frameDuration(project.fps) : 0 };
}

/** The track of the first selected clip, if any (the desktop's selected track). */
export function selectedLayer(session: EditorSession): number | null {
  const id = session.ui.getState().selection.clips[0];
  const clip = id ? session.project.clips.find((c) => c.id === id) : undefined;
  return clip?.layer ?? null;
}

const EPSILON = 1e-6;

/** No clip other than `except` covers any of [start, end) on `layer`. */
export function trackIsFree(project: Project, layer: number, start: number, end: number, except?: string): boolean {
  return !project.clips.some((c) => c.id !== except && c.layer === layer && c.position < end - EPSILON && c.position + (c.end - c.start) > start + EPSILON);
}

/**
 * The track the gesture uses for a clip spanning [start, end): the preferred
 * track when free, else the lowest free unlocked track — for audio-only
 * media only tracks below every clip with a picture — else null.
 */
export function freeTrack(project: Project, preferred: number, start: number, end: number, audioOnly: boolean, except?: string): number | null {
  if (trackIsFree(project, preferred, start, end, except)) return preferred;
  const tracks = sortedLayers(project).filter((l) => !l.lock);
  const free = tracks.filter((l) => trackIsFree(project, l.number, start, end, except)).map((l) => l.number);
  if (free.length === 0) return null;
  if (audioOnly) {
    const fileById = new Map(project.files.map((f) => [f.id, f]));
    const hasPicture = (c: Clip) => {
      const f = fileById.get(c.file_id);
      return f ? !isAudioOnlyMedia(f) : true;
    };
    const pictureLayers = project.clips.filter((c) => c.id !== except && hasPicture(c)).map((c) => c.layer);
    const floor = pictureLayers.length > 0 ? Math.min(...pictureLayers) : Number.POSITIVE_INFINITY;
    // Sound goes under the picture (the desktop's underlay track); when nothing
    // below is free the gesture adds a bottom track instead of stacking above.
    return free.find((n) => n < floor) ?? null;
  }
  return free[0]!;
}

/**
 * Inside a transaction: place each file at its default time on a free track
 * (adding a track below everything for audio, on top otherwise, when every
 * track is taken there).
 */
export function placeAtDefaults(tx: Transaction, files: readonly ProjectFile[], selected: number | null): Clip[] {
  const clips: Clip[] = [];
  for (const file of files) {
    const spot = desktopPlacement(tx.project, file, selected);
    if (!spot) continue;
    const clip = addClip(tx, { fileId: file.id, position: spot.position, layer: spot.layer });
    const end = clip.position + (clip.end - clip.start);
    const audioOnly = isAudioOnlyMedia(file);
    let layer = freeTrack(tx.project, spot.layer, clip.position, end, audioOnly, clip.id);
    if (layer === null) {
      const bottom = sortedLayers(tx.project)[0];
      layer = (audioOnly && bottom ? addTrack(tx, { below: bottom.number }) : addTrack(tx)).number;
    }
    clips.push(layer === clip.layer ? clip : moveClip(tx, clip.id, { layer }));
  }
  return clips;
}

/** Add bin files to the timeline at their default spots (one undo step for the gesture). */
export function addFilesToTimeline(session: EditorSession, fileIds: readonly string[]): string[] {
  const files = fileIds.map((id) => session.project.files.find((f) => f.id === id)).filter((f): f is ProjectFile => Boolean(f));
  const selected = selectedLayer(session);
  const clips = session.edit(files.length > 1 ? `Add ${files.length} clips` : "Add to timeline", (tx) => placeAtDefaults(tx, files, selected));
  return clips?.map((c) => c.id) ?? [];
}

/**
 * Inside a transaction: the track for an overlay (a title) over [start, end):
 * the lowest free track above every clip showing then, adding one on top
 * when there is none.
 */
export function overlayTrack(tx: Transaction, start: number, end: number): number {
  const project = tx.project;
  const under = project.clips.filter((c) => c.position < end - EPSILON && c.position + (c.end - c.start) > start + EPSILON).map((c) => c.layer);
  const floor = under.length > 0 ? Math.max(...under) : Number.NEGATIVE_INFINITY;
  const free = sortedLayers(project).find((l) => !l.lock && l.number > floor && trackIsFree(project, l.number, start, end));
  return free ? free.number : addTrack(tx).number;
}
