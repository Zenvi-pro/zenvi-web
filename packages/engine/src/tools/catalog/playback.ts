/**
 * Playback and view tools: play_tool, go_to_start_tool, go_to_end_tool,
 * zoom_in_tool, zoom_out_tool, center_on_playhead_tool, watch_clip_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7): play,
 * go_to_start / go_to_end (main_window.py actionJumpStart_trigger seeks to
 * the first frame with content, actionJumpEnd_trigger to the last),
 * zoom_in / zoom_out / center_on_playhead, watch_clip_and_play.
 */

import { maxFrame, timelineStart } from "../../timeline/queries.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import { placeExistingFile, importAndPlace } from "./clips.js";
import { basename } from "../clip-context.js";
import { fileById, resolveClip, text } from "./common.js";

const VIEW = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function startPlaying(call: ToolCall): void {
  const player = call.host.player!;
  if (!player.playing) player.play();
}

export const playbackTools: CatalogTool[] = [
  contractTool("play_tool", {
    annotations: VIEW,
    requires: ["player"],
    run: (call) => {
      call.host.player!.toggle();
      return "Playback toggled.";
    },
  }),

  contractTool("go_to_start_tool", {
    annotations: { ...VIEW, idempotentHint: true },
    requires: ["player"],
    run: (call) => {
      // Timeline::GetMinFrame: the first clip's start (frame 1 when empty).
      call.host.player!.seek(timelineStart(call.doc.project));
      call.host.ui?.centerOnPlayhead();
      return "Seeked to start.";
    },
  }),

  contractTool("go_to_end_tool", {
    annotations: { ...VIEW, idempotentHint: true },
    requires: ["player"],
    run: (call) => {
      const project = call.doc.project;
      const fps = projectFps(project);
      const last = maxFrame(project, fps);
      call.host.player!.seek(last > 0 ? ((last - 1) * fps.den) / fps.num : 0);
      call.host.ui?.centerOnPlayhead();
      return "Seeked to end.";
    },
  }),

  contractTool("zoom_in_tool", {
    annotations: VIEW,
    requires: ["ui"],
    run: (call) => {
      call.host.ui!.zoomIn();
      return "Timeline zoomed in.";
    },
  }),

  contractTool("zoom_out_tool", {
    annotations: VIEW,
    requires: ["ui"],
    run: (call) => {
      call.host.ui!.zoomOut();
      return "Timeline zoomed out.";
    },
  }),

  contractTool("center_on_playhead_tool", {
    annotations: VIEW,
    requires: ["ui"],
    run: (call) => {
      call.host.ui!.centerOnPlayhead();
      return "Centered on playhead.";
    },
  }),

  contractTool("watch_clip_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["player"],
    run: async (call, input) => {
      const player = call.host.player!;
      // A clip already on the timeline: seek to it and play.
      if (text(input.timeline_clip_id) || text(input.query)) {
        const resolved = await resolveClip(call, { timeline_clip_id: input.timeline_clip_id, clip_query: input.query });
        if (!resolved.ok) return resolved.error;
        player.seek(Number(resolved.clip.position) || 0);
        startPlaying(call);
        return `Loaded and playing: ${String(resolved.clip.title || resolved.clip.id)}`;
      }
      // A media-bin file (or a path to import): place it at 0 like the desktop, then play from the start.
      const fileId = text(input.file_id);
      if (fileId) {
        const file = fileById(call.doc.project, fileId);
        if (!file) return `Error: File not found for id=${fileId}.`;
        const existing = (call.doc.project.clips ?? []).find((c) => String(c.file_id) === fileId);
        if (existing) {
          player.seek(Number(existing.position) || 0);
        } else {
          const placed = await placeExistingFile(call, file, { position_seconds: "0" });
          if (!placed.clip) return placed.text;
          player.seek(timelineStart(call.doc.project));
        }
        startPlaying(call);
        return `Loaded and playing: ${basename(String(file.path ?? "")) || fileId}`;
      }
      const path = text(input.file_path);
      if (!path) return "Error: watch_clip_tool needs timeline_clip_id, query, file_id or file_path.";
      const importPath = call.host.media?.importPath;
      if (!importPath) return unavailable("watch_clip_tool", "it cannot open local file paths; pass file_id or timeline_clip_id.");
      let media;
      try {
        media = await importPath.call(call.host.media, path);
      } catch (error) {
        return `Error: Could not import file into media bin: ${path} (${error instanceof Error ? error.message : String(error)})`;
      }
      const existing = (call.doc.project.files ?? []).find((f) => f.path === media.path);
      if (existing) {
        const placed = await placeExistingFile(call, existing, { position_seconds: "0" });
        if (!placed.clip) return placed.text;
      } else {
        const placed = await importAndPlace(call, media, { position_seconds: "0" });
        if (!placed.clip) return placed.text;
      }
      player.seek(timelineStart(call.doc.project));
      startPlaying(call);
      return `Loaded and playing: ${basename(path)}`;
    },
  }),
];
