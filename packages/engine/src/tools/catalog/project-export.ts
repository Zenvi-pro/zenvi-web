/**
 * Project lifecycle extras: list_recent_projects_tool,
 * forget_recent_projects_tool, list_recovery_versions_tool,
 * restore_recovery_version_tool, import_project_file_tool,
 * export_project_file_tool, consolidate_project_media_tool,
 * reset_caches_and_history_tool.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export.py. What each surface has:
 *
 * - Recent projects (StorageHost.recentProjects): the CLI reads Zenvi
 *   desktop's own list (File > Recent Projects, in the desktop's settings
 *   file on the same computer); the web editor lists the projects in this
 *   browser; Zenvi Cloud the person's cloud projects. None of them is a list
 *   apart from the projects themselves that a web surface may write (the
 *   desktop's settings file has one writer, the desktop app), so
 *   forget_recent_projects_tool is refused.
 * - Recovery copies (StorageHost.recoveryCopies): the copies Zenvi desktop
 *   zips into its recovery folder each time it saves a project, which the
 *   CLI lists and restores for the project it has open. The web editor and
 *   Zenvi Cloud keep only the latest version (with its undo history).
 * - EDL / Final Cut Pro XML: every conversion of the Zenvi format is
 *   implemented once, in the desktop app (docs/ARCHITECTURE.md §4); the web
 *   surfaces refuse, and `zenvi` hands the call to the desktop app when it
 *   has the project open.
 * - Collect / reclaim media: local files next to a saved project (the CLI,
 *   MediaHost.collect / reclaimable / removeCopies). Media in the web editor
 *   and Zenvi Cloud is stored with the project already.
 * - Caches and history: waveform data and the undo history are project
 *   data (engine ops); the playback cache is the editor's
 *   (UiHost.clearPlaybackCache); the CLI and Zenvi Cloud render every frame
 *   from the project and keep none.
 */

import { applyMediaRepoint, mediaRepoint } from "../../ops/media-collect.js";
import { clearWaveformData } from "../../ops/waveforms.js";
import type { Project } from "../../model/types.js";
import { isRecord } from "../../ops/internal.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyFloat } from "../pyfmt.js";
import { editorRun, nothingChanged, ok, ToolError } from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

const DESKTOP_CONVERSION =
  "Zenvi desktop converts timelines to and from EDL and Final Cut Pro XML (every conversion of the Zenvi format is implemented once, in the desktop app). " +
  "Open the project in Zenvi desktop (File > Export Project / Import Project); zenvi and zenvi mcp run this tool there while the desktop app has the project open.";

const NO_RECENT = "this surface keeps no list of recent projects";

const NO_RECOVERY =
  "this surface keeps no recovery copies: the web editor and Zenvi Cloud keep the latest version of a project with its undo history (undo_tool steps back). " +
  "Zenvi desktop zips a copy each time it saves a project, and the zenvi CLI lists and restores those";

const NO_FORGET =
  "the recent projects listed here are the projects themselves (the web editor's projects in this browser, the person's Zenvi Cloud projects) " +
  "or Zenvi desktop's own list, which only the desktop app writes; nothing can be forgotten without deleting a project. " +
  "Clear the list in Zenvi desktop (File > Recent Projects), or delete projects on the Zenvi projects page";

const NO_COLLECT =
  "collecting media copies local files into a saved project's folder (the zenvi CLI, Zenvi desktop). " +
  "Media in the web editor and in Zenvi Cloud is already stored with the project";

/** `datetime.fromtimestamp(s).isoformat(timespec=…)` in local time. */
function localIso(seconds: number, unit: "minutes" | "seconds"): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return unit === "seconds" ? `${base}:${pad(d.getSeconds())}` : base;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** `project_snapshot()["counts"]`. */
export function projectCounts(project: Project): Record<string, number> {
  const files = project.files.filter((f) => !f.zenvi_subclip);
  return {
    files: files.length,
    clips: project.clips.length,
    tracks: project.layers.length,
    locked_tracks: project.layers.filter((l) => l.lock).length,
    transitions: project.effects.length,
    markers: project.markers.length,
    clip_effects: project.clips.reduce((n, c) => n + (c.effects?.length ?? 0), 0),
  };
}

function currentPath(call: ToolCall): string | null {
  return call.host.storage?.currentPath?.() ?? null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Recovery copies as the desktop lists them (`_recovery_versions`). */
async function recoveryVersions(call: ToolCall): Promise<Record<string, unknown>[]> {
  const copies = await call.host.storage!.recoveryCopies!();
  const now = Date.now() / 1000;
  return copies.map((c, i) => ({
    version: i + 1,
    path: c.path,
    saved_at: localIso(c.savedAt, "seconds"),
    minutes_ago: Number(pyFixed((now - c.savedAt) / 60, 1)),
    size_bytes: c.sizeBytes,
  }));
}

/**
 * Repoint files and clips without an undo step (reclaim deletes the copies,
 * so it cannot be undone). Returns what puts them back.
 */
function repointUntracked(call: ToolCall, repoint: ReturnType<typeof mediaRepoint>): () => void {
  const doc = call.doc;
  const ids = (list: readonly { id: string }[]) => new Set(list.map((x) => x.id));
  const files = doc.project.files.filter((f) => ids(repoint.files).has(f.id));
  const clips = doc.project.clips.filter((c) => ids(repoint.clips).has(c.id));
  for (const { id, ...values } of repoint.files) {
    const file = files.find((f) => f.id === id)!;
    doc.setUntracked(["files", { id }], { ...file, ...values });
  }
  for (const { id, reader } of repoint.clips) {
    const clip = clips.find((c) => c.id === id)!;
    doc.setUntracked(["clips", { id }], { ...clip, reader });
  }
  return () => {
    for (const file of files) doc.setUntracked(["files", { id: file.id }], file);
    for (const clip of clips) doc.setUntracked(["clips", { id: clip.id }], clip);
  };
}

export const projectExportTools: CatalogTool[] = [
  contractTool("list_recent_projects_tool", {
    annotations: READ,
    run: async (call) => {
      const storage = call.host.storage;
      if (!storage?.recentProjects) return unavailable(call.tool, NO_RECENT);
      const projects = (await storage.recentProjects()).map((p, i) => ({
        index: i + 1,
        path: p.path,
        name: p.name,
        exists: p.exists,
        modified: p.exists && p.modifiedAt !== null ? localIso(p.modifiedAt, "minutes") : null,
      }));
      if (projects.length === 0) return ok(call, "No recent projects.", { projects: [] });
      return ok(call, `${projects.length} recent project(s); most recent: ${projects[0]!.name}.`, { projects, current_path: currentPath(call) });
    },
  }),

  contractTool("forget_recent_projects_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call) => unavailable(call.tool, NO_FORGET),
  }),

  contractTool("list_recovery_versions_tool", {
    annotations: READ,
    run: async (call) => {
      if (!call.host.storage?.recoveryCopies) return unavailable(call.tool, NO_RECOVERY);
      const path = currentPath(call);
      if (!path) return ok(call, "The project has never been saved, so it has no recovery versions.", { versions: [] });
      const versions = await recoveryVersions(call);
      if (versions.length === 0) return ok(call, "No recovery versions exist for this project yet.", { versions: [], project_path: path });
      return ok(call, `${versions.length} recovery version(s); newest saved ${pyFloat(Number(versions[0]!.minutes_ago))} min ago.`, { versions, project_path: path });
    },
  }),

  contractTool("restore_recovery_version_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) =>
      editorRun(async () => {
        const storage = call.host.storage;
        if (!storage?.recoveryCopies || !storage.restoreRecoveryCopy) return unavailable(call.tool, NO_RECOVERY);
        if (!currentPath(call)) throw new ToolError("the project has never been saved, so it has no recovery versions");
        const versions = await recoveryVersions(call);
        if (versions.length === 0) throw new ToolError("no recovery versions exist for this project yet");
        const version = input.version ?? 1;
        if (version > versions.length) throw new ToolError(`there are only ${versions.length} recovery versions`);
        // Every web surface saves each change as it is made: there are no unsaved changes to guard (discard_unsaved).
        const chosen = versions[version - 1]!;
        let restored;
        try {
          restored = await storage.restoreRecoveryCopy(String(chosen.path));
        } catch (error) {
          throw new ToolError(`could not restore ${String(chosen.path)}: ${messageOf(error)}`);
        }
        call.doc.load(restored.project);
        const counts = projectCounts(call.doc.project);
        const kept = restored.backup ? baseName(restored.backup) : "nothing (it was missing)";
        return ok(call, `Restored the version saved ${pyFloat(Number(chosen.minutes_ago))} min ago (${counts.clips} clips); the previous file was kept as ${kept}.`, {
          path: restored.path,
          restored_from: chosen.path,
          backup_of_previous: restored.backup,
          counts,
        });
      }),
  }),

  contractTool("import_project_file_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call) => unavailable(call.tool, DESKTOP_CONVERSION),
  }),

  contractTool("export_project_file_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call) => unavailable(call.tool, DESKTOP_CONVERSION),
  }),

  contractTool("consolidate_project_media_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) =>
      editorRun(async () => {
        const media = call.host.media;
        const storage = call.host.storage;
        if (!media?.collect || !media.reclaimable || !media.removeCopies || !storage) return unavailable(call.tool, NO_COLLECT);
        if (!currentPath(call)) throw new ToolError("save the project first (save_project_tool); media is collected next to the project file");
        const action = input.action;
        const project = call.doc.project;
        let done: string[] = [];
        let other: string[] = [];
        let errors: string[] = [];
        let filesRepointed = 0;
        let clipsRepointed = 0;
        if (action === "collect") {
          const result = await media.collect(project.files.map((f) => ({ id: f.id, path: typeof f.path === "string" ? f.path : "" })));
          const repoint = mediaRepoint(call.doc.project, result.moves, true);
          if (repoint.files.length > 0 || repoint.clips.length > 0) call.commit((tx) => applyMediaRepoint(tx, repoint), "Collect media");
          ({ copied: done, skipped: other, errors } = result);
          filesRepointed = repoint.files.length;
          clipsRepointed = repoint.clips.length;
        } else {
          const candidates = project.files
            .filter((f) => typeof f.path === "string" && f.path && typeof f.original_path === "string" && f.original_path)
            .map((f) => ({ id: f.id, path: String(f.path), original: String(f.original_path) }));
          const found = await media.reclaimable(candidates);
          other = found.kept;
          errors = found.errors;
          if (found.moves.length > 0) {
            // media_collect.commit_reclaim: point at the originals, save, and only then delete the copies,
            // so the saved project never points at removed media and a failed save deletes nothing.
            const repoint = mediaRepoint(call.doc.project, found.moves, false);
            const undo = repointUntracked(call, repoint);
            try {
              await storage.save(call.doc.toJSON());
            } catch (error) {
              undo();
              throw new ToolError(`Project not saved, nothing removed: ${messageOf(error)}`);
            }
            const removed = await media.removeCopies(found.moves.map((m) => m.from));
            done = removed.removed;
            errors = [...errors, ...removed.errors];
            filesRepointed = repoint.files.length;
            clipsRepointed = repoint.clips.length;
          }
        }
        const verb = action === "collect" ? "Copied" : "Removed";
        let summary = `${verb} ${done.length} file(s); ${action === "collect" ? "skipped" : "kept"} ${other.length}${errors.length ? `; ${errors.length} error(s)` : ""}.`;
        if (done.length === 0 && filesRepointed === 0) {
          summary =
            action === "collect"
              ? "Nothing to collect: all media is already in the project folder or unavailable."
              : "Nothing to reclaim: no asset copy has an identical original.";
        }
        const data = {
          action,
          files: done.slice(0, 100),
          count: done.length,
          errors: errors.slice(0, 20),
          files_repointed: filesRepointed,
          clips_repointed: clipsRepointed,
          undoable: action === "collect" && filesRepointed + clipsRepointed > 0,
        };
        return done.length === 0 && filesRepointed === 0 ? nothingChanged(call, summary, data) : ok(call, summary, data);
      }),
  }),

  contractTool("reset_caches_and_history_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) =>
      editorRun(() => {
        const target = input.target;
        if (target === "playback_cache") {
          const clear = call.host.ui?.clearPlaybackCache;
          if (!clear) {
            return nothingChanged(call, "Nothing to clear: this Zenvi surface keeps no playback cache (every frame is rendered from the project).", { target });
          }
          call.host.ui!.clearPlaybackCache!();
          return ok(call, "Cleared the playback cache; preview frames will re-render.", { target });
        }
        if (target === "waveforms") {
          const has = (ui: unknown) => isRecord(ui) && "audio_data" in ui;
          const project = call.doc.project;
          if (!project.files.some((f) => has(f.ui)) && !project.clips.some((c) => has(c.ui))) {
            return nothingChanged(call, "No file or clip has stored waveform data; nothing cleared.", { target, files: 0, clips: 0 });
          }
          const cleared = call.commit((tx) => clearWaveformData(tx), "Clear waveform data");
          return ok(call, `Dropped waveform data from ${cleared.files} file(s) and ${cleared.clips} clip(s).`, { target, files: cleared.files, clips: cleared.clips });
        }
        if (!input.confirm) throw new ToolError("clearing the undo history cannot be undone; ask the user, then pass confirm=true");
        const doc = call.doc;
        if (doc.undoLabels.length === 0 && doc.redoLabels.length === 0) {
          return nothingChanged(call, "The undo history is already empty.", { target, undo_steps_cleared: 0 });
        }
        const cleared = doc.clearHistory();
        return ok(call, `Cleared the undo history (${cleared.undo} undo and ${cleared.redo} redo step(s)).`, {
          target,
          undo_steps_cleared: cleared.undo,
          redo_steps_cleared: cleared.redo,
        });
      }),
  }),
];
