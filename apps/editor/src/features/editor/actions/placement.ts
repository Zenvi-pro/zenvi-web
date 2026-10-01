/**
 * Where "Add to timeline" puts a file when the person did not choose a spot
 * (bin double-click, the + button, dropping files to start).
 *
 * The source of truth is the engine's `add_clip_to_timeline_tool`
 * (zenvi-core tool_handlers.py `_do_add`, ported in
 * packages/engine/src/tools/catalog/clips.ts `planPlacement`). The editor
 * calls that tool when the catalog is available; until W4 exports it, this
 * mirrors its defaults exactly so both paths place clips the same way:
 * no track given → audio goes to the bottom track at 0 s; video and images
 * go to the selected clip's track (else the bottom track), one frame after
 * the last clip there.
 */
import { addClip, frameDuration, isAudioOnlyMedia, sortedLayers, type Clip, type Project, type ProjectFile, type Transaction } from "@zenvi/engine";
import { runAssistantTool, toolsAvailable } from "../assistant/bridge";
import { createToolHost } from "../assistant/host";
import type { EditorSession } from "../session/EditorSession";

export interface PlacementSpot {
  layer: number;
  position: number;
}

function bottomTrack(project: Project): number | null {
  return sortedLayers(project)[0]?.number ?? null;
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

/** Inside a transaction: place each file at its desktop default spot. */
export function placeAtDefaults(tx: Transaction, files: readonly ProjectFile[], selected: number | null): Clip[] {
  const clips: Clip[] = [];
  for (const file of files) {
    const spot = desktopPlacement(tx.project, file, selected);
    if (spot) clips.push(addClip(tx, { fileId: file.id, position: spot.position, layer: spot.layer }));
  }
  return clips;
}

/** Add bin files to the timeline at their default spots (one undo step). */
export async function addFilesToTimeline(session: EditorSession, fileIds: readonly string[]): Promise<string[]> {
  if (toolsAvailable()) {
    const host = createToolHost(session, async () => []);
    const before = new Set(session.project.clips.map((c) => c.id));
    for (const id of fileIds) {
      await runAssistantTool(session, host, "add_clip_to_timeline_tool", { file_id: id, full_file: "true" }, new AbortController().signal);
    }
    return session.project.clips.filter((c) => !before.has(c.id)).map((c) => c.id);
  }
  const files = fileIds.map((id) => session.project.files.find((f) => f.id === id)).filter((f): f is ProjectFile => Boolean(f));
  const selected = selectedLayer(session);
  const clips = session.edit(files.length > 1 ? `Add ${files.length} clips` : "Add to timeline", (tx) => placeAtDefaults(tx, files, selected));
  return clips?.map((c) => c.id) ?? [];
}
