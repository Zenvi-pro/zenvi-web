/**
 * Import files into the project (and optionally onto the timeline) as one
 * undo step. Hashing, storing and probing happen first, outside the
 * transaction, so a failed import records nothing.
 */
import { addClip, addFile, itemEnd, sortedLayers, type Clip, type Project, type ProjectFile } from "@zenvi/engine";
import { createStore } from "zustand/vanilla";
import { toast } from "@/ui/Toast";
import type { EditorSession } from "../session/EditorSession";

export interface ImportState {
  active: boolean;
  label: string;
  fraction: number;
}

export const importState = createStore<ImportState>(() => ({ active: false, label: "", fraction: 0 }));

export type Placement = { position: number; layer: number } | "end" | null;

/** The top unlocked track, where new clips go by default. */
export function defaultTrack(project: Project): number | null {
  const layers = sortedLayers(project).filter((l) => !l.lock);
  return layers[layers.length - 1]?.number ?? null;
}

/** End of the last item on a track (0 when empty). */
export function trackEnd(project: Project, layer: number): number {
  let end = 0;
  for (const clip of project.clips) if (clip.layer === layer) end = Math.max(end, itemEnd(clip));
  return end;
}

export async function importMedia(session: EditorSession, files: File[], placement: Placement = null): Promise<{ files: ProjectFile[]; clips: Clip[] } | null> {
  if (files.length === 0) return null;
  importState.setState({ active: true, label: files.length === 1 ? files[0]!.name : `${files.length} files`, fraction: 0 });
  let prepared: Awaited<ReturnType<EditorSession["media"]["importFiles"]>>;
  try {
    prepared = await session.media.importFiles(files, (p) => {
      const perFile = p.phase === "hashing" ? p.fraction * 0.7 : p.phase === "storing" ? 0.75 : 0.9 + p.fraction * 0.1;
      importState.setState({
        active: true,
        label: p.count > 1 ? `${p.file} (${p.index + 1}/${p.count})` : p.file,
        fraction: (p.index + perFile) / p.count,
      });
    });
  } catch (error) {
    importState.setState({ active: false, label: "", fraction: 0 });
    toast.error("Import failed", { description: error instanceof Error ? error.message : String(error) });
    return null;
  }
  importState.setState({ active: false, label: "", fraction: 1 });

  const label = placement ? (prepared.length === 1 ? "Add to timeline" : `Add ${prepared.length} clips`) : prepared.length === 1 ? "Import file" : `Import ${prepared.length} files`;
  const result = session.edit(label, (tx) => {
    const added: ProjectFile[] = [];
    const clips: Clip[] = [];
    let cursor: { position: number; layer: number } | null = null;
    if (placement === "end") {
      const layer = defaultTrack(tx.project);
      if (layer !== null) cursor = { position: trackEnd(tx.project, layer), layer };
    } else if (placement) {
      cursor = { ...placement };
    }
    for (const item of prepared) {
      const file = addFile(tx, item.media);
      session.media.attach(file.id, item.spec);
      added.push(file);
      if (cursor) {
        const clip = addClip(tx, { fileId: file.id, position: cursor.position, layer: cursor.layer });
        clips.push(clip);
        cursor = { position: itemEnd(clip), layer: cursor.layer };
      }
    }
    return { files: added, clips };
  });
  if (result && result.files.length > 0) {
    toast.success(result.clips.length ? `Added ${result.clips.length === 1 ? "a clip" : `${result.clips.length} clips`} to the timeline` : `Imported ${result.files.length === 1 ? result.files[0]!.name ?? "file" : `${result.files.length} files`}`);
  }
  return result ?? null;
}
