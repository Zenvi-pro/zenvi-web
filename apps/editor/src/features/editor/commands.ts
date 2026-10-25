/**
 * Editor commands: one definition per user intent, shared by keyboard
 * shortcuts (desktop action names), menus and the command palette. Editing
 * commands are one `session.edit` each (one undo step) and call engine ops;
 * no domain rules live here.
 */
import {
  addMarker,
  addTrack,
  clipsAt,
  clipFrameAtTime,
  copyItems,
  deleteClips,
  duplicateClip,
  evaluate,
  findClip,
  frameDuration,
  moveClip,
  pasteItems,
  removeMarker,
  removeTransition,
  setClipProperty,
  sliceAllAt,
  splitClip,
  type ClipboardData,
  type KeyframeLike,
  type SliceKeep,
} from "@zenvi/engine";
import { downloadBlob, projectFileBlob, safeFileName } from "@/lib/projectFactory";
import { secondsToTimecode } from "@/lib/timecode";
import { renderFrame } from "./render";
import { buildKeymap, primaryShortcut, type Keymap } from "@/lib/keyboard/keymap";
import type { ShortcutCommand } from "@/lib/keyboard/dispatcher";
import { toast } from "@/ui/Toast";
import type { EditorSession } from "./session/EditorSession";
import { EMPTY_SELECTION, selectionIsEmpty, type DialogId, type LeftTab, type RightTab } from "./session/uiStore";

export interface EditorCommand extends ShortcutCommand {
  label: string;
  group: "File" | "Edit" | "View" | "Timeline" | "Playback" | "Keyframes" | "Help";
  /** Shown checked in menus (toggles). */
  checked?(): boolean;
  /** Hidden from the command palette (internal plumbing like Escape). */
  hidden?: boolean;
}

export interface CommandEnv {
  navigate: (path: string) => void;
}

export const keymap: Keymap = buildKeymap();

export function shortcutFor(id: string): string | undefined {
  return primaryShortcut(keymap, id);
}

const KEYFRAME_SETS: Record<string, readonly string[]> = {
  actionInsertKeyframe: ["location_x", "location_y", "scale_x", "scale_y", "rotation", "alpha"],
  actionInsertKeyframePosition: ["location_x", "location_y"],
  actionInsertKeyframeScale: ["scale_x", "scale_y"],
  actionInsertKeyframeRotation: ["rotation"],
  actionInsertKeyframeAlpha: ["alpha"],
};

const CLIPBOARD_MIME = "application/x-zenvi-generic";

export function createCommands(session: EditorSession, env: CommandEnv): Map<string, EditorCommand> {
  const ui = () => session.ui.getState();
  const selection = () => ui().selection;
  const time = () => session.playback.getState().time;
  const openDialog = (dialog: DialogId) => session.ui.setState({ dialog });
  const hasItems = () => selection().clips.length + selection().transitions.length > 0;

  /**
   * Desktop slice: the selected clips under the playhead (Ctrl+K), or, with
   * nothing selected or "all" (Ctrl+Shift+K), every clip and transition
   * under it (engine `sliceAllAt`).
   */
  const slice = (keep: SliceKeep, all: boolean) => {
    const t = time();
    const project = session.project;
    const label = keep === "both" ? "Slice" : keep === "left" ? "Slice, keep left" : "Slice, keep right";
    const selected = selection().clips.filter((id) => clipsAt(project, t).some((c) => c.id === id));
    if (all || selection().clips.length === 0) {
      const result = session.edit(all ? `${label} all` : label, (tx) => sliceAllAt(tx, t, { keep }));
      if (result && result.clips.length === 0 && result.transitions.length === 0) toast.info("Nothing under the playhead to slice");
      if (result && keep === "right") {
        session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: result.clips.map((r) => r.rightId).filter((x): x is string => !!x) } });
      }
      return;
    }
    if (selected.length === 0) {
      toast.info("The selected clips are not under the playhead");
      return;
    }
    const created = session.edit(label, (tx) => selected.map((id) => splitClip(tx, id, t, keep)));
    if (created && keep === "right") {
      session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: created.map((r) => r.rightId).filter((x): x is string => !!x) } });
    }
  };

  const remove = (ripple: boolean) => {
    const s = selection();
    if (selectionIsEmpty(s)) return;
    const count = s.clips.length + s.transitions.length + s.markers.length;
    session.edit(ripple ? "Ripple delete" : count === 1 ? "Delete" : `Delete ${count} items`, (tx) => {
      if (s.clips.length) deleteClips(tx, s.clips, { ripple });
      for (const id of s.transitions) removeTransition(tx, id);
      for (const id of s.markers) removeMarker(tx, id);
    });
  };

  const copy = (): ClipboardData | null => {
    const ids = [...selection().clips, ...selection().transitions];
    if (ids.length === 0) return null;
    try {
      const data = copyItems(session.project, ids);
      session.clipboard = data;
      // Also put it on the system clipboard so another tab can paste it.
      void navigator.clipboard?.writeText(JSON.stringify({ [CLIPBOARD_MIME]: data })).catch(() => undefined);
      return data;
    } catch (error) {
      toast.warning(error instanceof Error ? error.message.replace(/^not implemented: /, "Not available yet: ") : String(error));
      return null;
    }
  };

  const paste = async () => {
    let data = session.clipboard;
    try {
      const text = await navigator.clipboard?.readText();
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      const fromSystem = parsed?.[CLIPBOARD_MIME] as ClipboardData | undefined;
      if (fromSystem?.kind === "zenvi/clipboard") data = fromSystem;
    } catch {
      // No permission or not ours: use the in-memory clipboard.
    }
    if (!data) {
      toast.info("Nothing to paste", { description: "Copy clips first (Ctrl+C)." });
      return;
    }
    const clipboard = data;
    const target = { position: time() };
    const result = session.edit("Paste", (tx) => pasteItems(tx, clipboard, target));
    if (result) session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: result.clipIds, transitions: result.transitionIds } });
  };

  const nudge = (frames: number) => {
    const ids = selection().clips;
    if (ids.length === 0) return;
    const step = frames * frameDuration(session.project.fps);
    session.edit(frames < 0 ? "Nudge left" : "Nudge right", (tx) => {
      for (const id of ids) {
        const clip = findClip(tx.project, id);
        if (clip) moveClip(tx, id, { position: Math.max(0, clip.position + step) });
      }
    });
  };

  const insertKeyframes = (props: readonly string[]) => {
    const ids = selection().clips;
    if (ids.length === 0) {
      toast.info("Select a clip to insert keyframes");
      return;
    }
    const t = time();
    session.edit(props.length > 2 ? "Insert keyframes" : "Insert keyframe", (tx) => {
      for (const id of ids) {
        const clip = findClip(tx.project, id);
        if (!clip) continue;
        const frame = clipFrameAtTime(clip, t, tx.project.fps);
        for (const prop of props) {
          const value = evaluate(clip[prop] as KeyframeLike, frame);
          setClipProperty(tx, id, prop, value, { frame });
        }
      }
    });
  };

  const markerJump = (direction: 1 | -1) => {
    const t = time();
    const eps = 1e-6;
    const positions = session.project.markers.map((m) => m.position).sort((a, b) => a - b);
    const target = direction > 0 ? positions.find((p) => p > t + eps) : [...positions].reverse().find((p) => p < t - eps);
    if (target === undefined) return;
    session.seek(target);
    session.views.timeline?.reveal(target);
  };

  const showTab = (left?: LeftTab, right?: RightTab) => {
    const panels = ui().panels;
    session.ui.setState({
      ...(left ? { leftTab: left, panels: { ...panels, leftCollapsed: false } } : {}),
      ...(right ? { rightTab: right, panels: { ...panels, rightCollapsed: false } } : {}),
    });
  };

  const list: EditorCommand[] = [
    // Playback
    { id: "playToggle", label: "Play / Pause", group: "Playback", run: () => session.togglePlay() },
    { id: "actionRewind", label: "Play backwards (faster each press)", group: "Playback", run: () => session.shuttle(-1) },
    { id: "actionFastForward", label: "Play forwards (faster each press)", group: "Playback", run: () => session.shuttle(1) },
    { id: "seekPreviousFrame", label: "Previous frame", group: "Playback", allowRepeat: true, run: () => session.stepFrames(-1) },
    { id: "seekNextFrame", label: "Next frame", group: "Playback", allowRepeat: true, run: () => session.stepFrames(1) },
    { id: "actionJumpStart", label: "Jump to start", group: "Playback", run: () => { session.seek(0); session.views.timeline?.reveal(0); } },
    { id: "actionJumpEnd", label: "Jump to end", group: "Playback", run: () => { const end = session.endTime(); session.seek(end); session.views.timeline?.reveal(end); } },
    { id: "actionPreviousMarker", label: "Previous marker", group: "Playback", run: () => markerJump(-1) },
    { id: "actionNextMarker", label: "Next marker", group: "Playback", run: () => markerJump(1) },

    // Timeline
    { id: "actionRazorTool", label: "Razor tool", group: "Timeline", checked: () => ui().tool === "razor", run: () => session.ui.setState({ tool: ui().tool === "razor" ? "select" : "razor" }) },
    { id: "actionSnappingTool", label: "Snapping", group: "Timeline", checked: () => ui().snapping, run: () => session.ui.setState({ snapping: !ui().snapping }) },
    { id: "actionTimelineZoomIn", label: "Zoom in", group: "View", allowRepeat: true, run: () => session.views.timeline?.zoomIn() },
    { id: "actionTimelineZoomOut", label: "Zoom out", group: "View", allowRepeat: true, run: () => session.views.timeline?.zoomOut() },
    { id: "actionZoomToTimeline", label: "Zoom to fit", group: "View", run: () => session.views.timeline?.zoomToFit() },
    { id: "actionCenterOnPlayhead", label: "Center on playhead", group: "View", run: () => session.views.timeline?.centerOnPlayhead() },
    {
      id: "actionAddMarker",
      label: "Add marker",
      group: "Timeline",
      run: () => {
        const marker = session.edit("Add marker", (tx) => addMarker(tx, time()));
        if (marker) session.ui.setState({ selection: { ...EMPTY_SELECTION, markers: [marker.id] } });
      },
    },
    { id: "actionAddTrack", label: "Add track", group: "Timeline", run: () => void session.edit("Add track", (tx) => addTrack(tx)) },
    { id: "sliceSelectedKeepBothSides", label: "Slice selected: keep both sides", group: "Timeline", run: () => slice("both", false) },
    { id: "sliceSelectedKeepLeftSide", label: "Slice selected: keep left side", group: "Timeline", run: () => slice("left", false) },
    { id: "sliceSelectedKeepRightSide", label: "Slice selected: keep right side", group: "Timeline", run: () => slice("right", false) },
    { id: "sliceAllKeepBothSides", label: "Slice all: keep both sides", group: "Timeline", run: () => slice("both", true) },
    { id: "sliceAllKeepLeftSide", label: "Slice all: keep left side", group: "Timeline", run: () => slice("left", true) },
    { id: "sliceAllKeepRightSide", label: "Slice all: keep right side", group: "Timeline", run: () => slice("right", true) },
    { id: "nudgeLeft", label: "Nudge left (1 frame)", group: "Timeline", allowRepeat: true, run: () => nudge(-1) },
    { id: "nudgeLeftBig", label: "Nudge left (5 frames)", group: "Timeline", allowRepeat: true, run: () => nudge(-5) },
    { id: "nudgeRight", label: "Nudge right (1 frame)", group: "Timeline", allowRepeat: true, run: () => nudge(1) },
    { id: "nudgeRightBig", label: "Nudge right (5 frames)", group: "Timeline", allowRepeat: true, run: () => nudge(5) },

    // Edit
    { id: "actionUndo", label: "Undo", group: "Edit", allowRepeat: true, enabled: () => session.doc.canUndo, run: () => session.undo() },
    { id: "actionRedo", label: "Redo", group: "Edit", allowRepeat: true, enabled: () => session.doc.canRedo, run: () => session.redo() },
    { id: "deleteItem", label: "Delete", group: "Edit", enabled: () => !selectionIsEmpty(selection()), run: () => remove(false) },
    { id: "actionRippleDelete", label: "Ripple delete", group: "Edit", enabled: () => selection().clips.length > 0, run: () => remove(true) },
    { id: "copyAll", label: "Copy", group: "Edit", enabled: hasItems, run: () => void copy() },
    {
      id: "cutAll",
      label: "Cut",
      group: "Edit",
      enabled: hasItems,
      run: () => {
        if (copy()) remove(false);
      },
    },
    { id: "pasteAll", label: "Paste at playhead", group: "Edit", run: () => void paste() },
    {
      id: "actionDuplicate",
      label: "Duplicate",
      group: "Edit",
      enabled: () => selection().clips.length > 0,
      run: () => {
        const ids = selection().clips;
        const copies = session.edit(ids.length === 1 ? "Duplicate clip" : "Duplicate clips", (tx) => ids.map((id) => duplicateClip(tx, id)));
        if (copies) session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: copies.map((c) => c.id) } });
      },
    },
    {
      id: "selectAll",
      label: "Select all",
      group: "Edit",
      run: () => {
        const p = session.project;
        session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: p.clips.map((c) => c.id), transitions: p.effects.map((t) => t.id) } });
      },
    },
    { id: "selectNone", label: "Select none", group: "Edit", run: () => session.ui.setState({ selection: EMPTY_SELECTION }) },

    // Keyframes
    ...Object.entries(KEYFRAME_SETS).map(([id, props]): EditorCommand => ({
      id,
      label:
        id === "actionInsertKeyframe"
          ? "Insert keyframe (all)"
          : `Insert keyframe (${id.replace("actionInsertKeyframe", "").toLowerCase()})`,
      group: "Keyframes",
      enabled: () => selection().clips.length > 0,
      run: () => insertKeyframes(props),
    })),

    // File
    { id: "actionImportFiles", label: "Import media…", group: "File", run: () => session.views.pickMedia?.() },
    { id: "actionOpen", label: "Open project file…", group: "File", run: () => session.views.pickProject?.() },
    { id: "actionNew", label: "New project", group: "File", run: () => env.navigate("/") },
    {
      id: "actionSave",
      label: "Save",
      group: "File",
      allowInInputs: true,
      run: () => {
        session.autosave
          .flush()
          .then(() => {
            const cloud = session.meta.getState().cloud;
            if (cloud) void session.saveCloud();
            toast.success(cloud ? "Saved. Syncing to Zenvi Cloud…" : "Saved in this browser");
          })
          .catch((e: unknown) => toast.error("Could not save", { description: String(e) }));
      },
    },
    {
      id: "actionSaveAs",
      label: "Download project (.zvn)",
      group: "File",
      allowInInputs: true,
      run: () => void projectFileBlob(session.snapshotForSave()).then((blob) => downloadBlob(blob, safeFileName(session.meta.getState().name, "zvn"))),
    },
    { id: "actionExportVideo", label: "Export video…", group: "File", run: () => openDialog("export") },
    {
      id: "actionSaveFrame",
      label: "Save current frame (PNG)",
      group: "File",
      run: () => {
        const t = time();
        const project = session.project;
        renderFrame(project, t, { width: project.width, format: "png" }, session.media)
          .then((image) => {
            const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
            const stamp = secondsToTimecode(t, project.fps).replace(/:/g, "-");
            downloadBlob(new Blob([bytes], { type: image.mimeType }), safeFileName(`${session.meta.getState().name} ${stamp}`, "png"));
          })
          .catch((e: unknown) => toast.error("Could not save the frame", { description: e instanceof Error ? e.message : String(e) }));
      },
    },
    { id: "actionProfile", label: "Project format…", group: "File", run: () => openDialog("profile") },
    { id: "actionTitle", label: "New title…", group: "File", run: () => session.ui.setState({ dialog: "title", editingTitleFileId: null }) },
    { id: "actionMakeReel", label: "Make a reel…", group: "Timeline", run: () => session.ui.setState({ dialog: "reel" }) },

    // View
    { id: "actionProperties", label: "Properties", group: "View", run: () => showTab(undefined, "properties") },
    { id: "showAssistant", label: "Zenvi Assistant", group: "View", run: () => showTab(undefined, "assistant") },
    { id: "showFiles", label: "Project files", group: "View", run: () => showTab("files") },
    { id: "showEffects", label: "Effects", group: "View", run: () => showTab("effects") },
    { id: "showTransitions", label: "Transitions", group: "View", run: () => showTab("transitions") },
    { id: "showTitles", label: "Titles", group: "View", run: () => showTab("titles") },
    { id: "showStock", label: "Stock media", group: "View", run: () => showTab("stock") },
    { id: "showGenerate", label: "Generate with AI", group: "View", run: () => showTab("generate") },

    // Help
    { id: "showShortcuts", label: "Keyboard shortcuts", group: "Help", run: () => openDialog("shortcuts") },
    { id: "commandPalette", label: "Command palette", group: "Help", allowInInputs: true, run: () => openDialog("palette") },
    {
      id: "escape",
      label: "Escape",
      group: "Edit",
      hidden: true,
      run: () => {
        if (ui().tool !== "select") session.ui.setState({ tool: "select" });
        else session.ui.setState({ selection: EMPTY_SELECTION });
      },
    },
  ];

  return new Map(list.map((c) => [c.id, c]));
}
