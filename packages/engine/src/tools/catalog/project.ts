/**
 * Project, listing and history tools: get_project_info_tool, list_*_tool,
 * save/open_project_tool, undo_tool, redo_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * get_project_info, list_files, list_clips, list_layers, list_markers,
 * save_project, open_project, _undo_redo; save_first and open's optional
 * file_path from develop 1f80cb3d0 editor_tools/project_export.py.
 */

import type { ChangeEvent, UpdateAction } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Project } from "../../model/types.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, type ToolReceipt } from "../receipt.js";
import { listClipsReport, listFilesText, listLayersText, listMarkersText, projectInfoText } from "../reports.js";
import { timelineDelta, timelineSnapshot } from "../snapshot.js";
import { normalizeTrackOrLayerArg } from "../tracks.js";
import { coerceSteps, text } from "./common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

const PROJECT_EXTS = [".zvn", ".osp", ".flow"];

/**
 * save_first (zenvi-core develop project_export.new_project / open_project):
 * save the current project where it already is before replacing it. A
 * refusal when this host cannot. discard_unsaved needs nothing: no Zenvi web
 * surface keeps edits unsaved (they autosave), so there is nothing to guard.
 */
async function saveCurrent(call: ToolCall, tool: string): Promise<ToolReceipt | null> {
  const storage = call.host.storage;
  if (!storage) return unavailable(tool, "save_first needs project storage, which this host does not provide.");
  await storage.save(call.doc.toJSON());
  return null;
}

export const projectTools: CatalogTool[] = [
  contractTool("get_project_info_tool", {
    annotations: READ,
    run: (call) => projectInfoText(call.doc.project),
  }),

  contractTool("list_files_tool", {
    annotations: READ,
    run: (call) => listFilesText(call.doc.project),
  }),

  contractTool("list_clips_tool", {
    annotations: READ,
    run: (call, input) => {
      const project = call.doc.project;
      let layer: number | undefined;
      const raw = text(input.layer);
      if (raw) {
        const resolved = normalizeTrackOrLayerArg(raw, project.layers);
        if (resolved.error) return resolved.error;
        layer = resolved.layer;
      }
      const report = listClipsReport(project, layer);
      if (!report) return "No clips in project.";
      return applied(
        "list_clips_tool",
        `Timeline clips (${report.clips.length}).`,
        { data: { clips: report.clips, legacy_text: report.text } },
        0,
      );
    },
  }),

  contractTool("list_layers_tool", {
    annotations: READ,
    run: (call) => listLayersText(call.doc.project),
  }),

  contractTool("list_markers_tool", {
    annotations: READ,
    run: (call) => listMarkersText(call.doc.project),
  }),

  contractTool("new_project_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (call, input) => {
      if (input.save_first) {
        const refusal = await saveCurrent(call, "new_project_tool");
        if (refusal) return refusal;
      }
      // project.new(): the default project with this project's profile; history starts empty.
      const current = call.doc.project;
      let project: Project;
      try {
        project = createProject({ profile: current.profile || undefined, sampleRate: current.sample_rate, channels: current.channels });
      } catch {
        project = createProject();
      }
      call.doc.load(project);
      return "New project created.";
    },
  }),

  contractTool("save_project_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    requires: ["storage"],
    run: async (call, input) => {
      let path = text(input.path) || text(input.file_path);
      if (path && !PROJECT_EXTS.some((ext) => path.endsWith(ext))) path += ".zvn";
      const location = await call.host.storage!.save(call.doc.toJSON(), path || undefined);
      return `Project saved to ${location || path}.`;
    },
  }),

  contractTool("open_project_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["storage"],
    run: async (call, input) => {
      const path = text(input.file_path);
      if (!path) return "Error: give file_path (a .zvn project) or recent_index.";
      const project: Project = await call.host.storage!.open(path);
      if (input.save_first) {
        const refusal = await saveCurrent(call, "open_project_tool");
        if (refusal) return refusal;
      }
      call.doc.load(project);
      return `Opened project ${path}.`;
    },
  }),

  contractTool("undo_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) => undoRedo(call, "undo", coerceSteps(input.steps ?? 1)),
  }),

  contractTool("redo_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call, input) => undoRedo(call, "redo", coerceSteps(input.steps ?? 1)),
  }),
];

// ---------------------------------------------------------------------------
// undo / redo (tool_handlers._undo_redo)
// ---------------------------------------------------------------------------

type Signature = Map<string, string>;

/** What is on the timeline, comparable before/after (tool_handlers._timeline_signature). */
function timelineSignature(project: Project): Signature {
  const out: Signature = new Map();
  const r3 = (v: unknown): number => Math.round((Number(v) || 0) * 1000) / 1000;
  for (const clip of project.clips ?? []) {
    const id = String(clip.id ?? "");
    if (id) out.set(id, JSON.stringify([clip.layer ?? null, r3(clip.position), r3(clip.start), r3(clip.end)]));
  }
  return out;
}

/** "removed 1 clip(s) (A); moved/retrimmed …" or "" (tool_handlers._describe_timeline_delta). */
function describeTimelineDelta(before: Signature, after: Signature): string {
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
  const added = [...after.keys()].filter((id) => !before.has(id)).sort();
  const moved = [...before.keys()].filter((id) => after.has(id) && before.get(id) !== after.get(id)).sort();
  const parts: string[] = [];
  if (removed.length) parts.push(`removed ${removed.length} clip(s) (${removed.slice(0, 4).join(", ")})`);
  if (added.length) parts.push(`restored ${added.length} clip(s) (${added.slice(0, 4).join(", ")})`);
  if (moved.length) parts.push(`moved/retrimmed ${moved.length} clip(s) (${moved.slice(0, 4).join(", ")})`);
  return parts.join("; ");
}

/** "insert x2 on clips" for one transaction (tool_handlers._describe_group). */
function describeGroup(actions: readonly UpdateAction[]): string {
  if (actions.length === 0) return "";
  const counts = new Map<string, number>();
  for (const a of actions) counts.set(a.type || "?", (counts.get(a.type || "?") ?? 0) + 1);
  // Counter.most_common: count descending, ties in first-seen order.
  const parts = [...counts.entries()]
    .map(([kind, n], i) => ({ kind, n, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(({ kind, n }) => (n > 1 ? `${kind} x${n}` : kind));
  let summary = parts.join(", ");
  const key = actions[0]!.key;
  if (Array.isArray(key) && typeof key[0] === "string") summary = `${summary} on ${key[0]}`;
  return summary;
}

/** The original actions of a group, recovered from an undo event (inverses, reversed). */
function originalActions(event: ChangeEvent, direction: "undo" | "redo"): UpdateAction[] {
  if (direction === "redo") return event.actions;
  const inverse = { insert: "delete", delete: "insert", update: "update", load: "load" } as const;
  return [...event.actions].reverse().map((a) => ({ ...a, type: inverse[a.type] }));
}

function undoRedo(call: ToolCall, direction: "undo" | "redo", steps: number) {
  const doc = call.doc;
  const undoing = direction === "undo";
  const label = direction;
  const depth = (): number => (undoing ? doc.undoLabels.length : doc.redoLabels.length);
  if (depth() === 0) return `Error: nothing to ${label}.`;

  const beforeProject = doc.project;
  const signatureBefore = timelineSignature(beforeProject);
  let done = 0;
  let described: string | null = null;
  let touchedClips = false;
  const labels: string[] = [];
  let last: ChangeEvent | null = null;
  const unsubscribe = doc.subscribe((event) => {
    if (event.source === direction) last = event;
  });
  try {
    for (let i = 0; i < steps && depth() > 0; i += 1) {
      const before = depth();
      last = null;
      const moved = undoing ? doc.undo(1) : doc.redo(1);
      if (depth() >= before || moved.length === 0) break;
      labels.push(...moved);
      const event = last as ChangeEvent | null;
      const group = event ? originalActions(event, direction) : [];
      if (described === null) described = describeGroup(group);
      if (group.some((a) => Array.isArray(a.key) && a.key[0] === "clips")) touchedClips = true;
      done += 1;
    }
  } finally {
    unsubscribe();
  }
  if (done === 0) return `Error: nothing to ${label}.`;

  const delta = describeTimelineDelta(signatureBefore, timelineSignature(doc.project));
  if (delta === "" && touchedClips && signatureBefore.size > 0) {
    return failed(
      `${direction}_tool`,
      `Error: ${label} applied ${done} history step(s) but the timeline did not change. ` +
        `The edit you meant may span several steps -- check list_clips_tool, then ${label} again with steps=N, ` +
        "or delete the clip directly.",
    );
  }

  const verb = undoing ? "Undid" : "Redid";
  const noun = done === 1 ? "action" : "actions";
  let detail = "";
  if (delta) detail = `: ${delta}`;
  else if (described && done === 1) detail = ` (${described})`;

  let summary: string;
  if (done < steps) {
    summary = `${verb} ${done} of ${steps} requested${detail}; nothing left to ${label}.`;
  } else {
    const remaining = depth();
    const tail = remaining === 1 ? ` 1 ${label} step remains.` : remaining ? ` ${remaining} ${label} steps remain.` : ` Nothing left to ${label}.`;
    summary = `${verb} ${done} ${noun}${detail}.${tail}`;
  }
  // Undo is itself not an undo step, but the receipt still reports what moved.
  const changed = timelineDelta(timelineSnapshot(beforeProject), timelineSnapshot(doc.project));
  return applied(`${direction}_tool`, summary, { ...changed, data: { steps: done, labels } }, 0);
}
