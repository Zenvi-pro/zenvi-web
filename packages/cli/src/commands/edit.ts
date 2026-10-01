/**
 * Editing commands. Each is one tool call (one undo step), so an agent can
 * script edits and undo them individually.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { PortableExecutor } from "../engine/executor.js";
import { CliError } from "../output.js";
import { printOutcome, runToolCommand, toolArgs, withExecutor, type CommandContext } from "./context.js";

/** Seconds from "12.5", "12.5s", "1:05", "1:05.25", "01:02:03.5" or "2m". */
export function parseTime(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  let m = /^(-?\d+(?:\.\d+)?)\s*(s|sec|secs|seconds)?$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes)$/.exec(t);
  if (m) return Number(m[1]) * 60;
  m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (m) return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  throw new CliError(`Not a time: "${text}" (use seconds like 12.5 or a timecode like 1:05.5).`, 2);
}

/** "0.5", "50%", "-6dB" → {volume} or {db}. */
export function parseLevel(text: string): { volume?: number; db?: number } {
  const t = text.trim().toLowerCase();
  let m = /^(-?\d+(?:\.\d+)?)\s*db$/.exec(t);
  if (m) return { db: Number(m[1]) };
  m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) return { volume: Number(m[1]) / 100 };
  if (/^\d+(?:\.\d+)?$/.test(t)) return { volume: Number(t) };
  throw new CliError(`Not a volume: "${text}" (use 0.5, 50% or -6dB).`, 2);
}

const CLIP = ["timeline_clip_id", "clip_id", "clipId"];

export function registerEditCommands(program: Command, ctx: CommandContext): void {
  program
    .command("import")
    .description("add media files (or folders, globs) to the project bin")
    .argument("<paths...>", "files, folders or globs")
    .option("--index", "also send the media to the Zenvi backend for AI indexing (needs `zenvi login`)")
    .action(async (paths: string[], opts: { index?: boolean }) => {
      const abs = paths.map((p) => (/[*?[{]/.test(p) || /^[a-z]+:\/\//i.test(p) ? p : path.resolve(ctx.cwd, p)));
      await runToolCommand(ctx, "import_files_tool", { paths: JSON.stringify(abs), skip_indexing: opts.index ? "false" : "true" });
    });

  program
    .command("add")
    .description("put a file on the timeline (imports it first when given a path)")
    .argument("<file>", "file id from `zenvi files`, or a media path")
    .option("--at <time>", "timeline position (default: after the last clip on the track)")
    .option("-t, --track <track>", "track number from the bottom, or layer")
    .option("--start <time>", "source in point")
    .option("--end <time>", "source out point")
    .option("--duration <time>", "length on the timeline")
    .action(async (file: string, opts: { at?: string; track?: string; start?: string; end?: string; duration?: string }) => {
      await withExecutor(ctx, async (executor) => {
        let fileId: string | undefined = file;
        let query: string | undefined;
        const local = path.resolve(ctx.cwd, file);
        if (existsSync(local)) {
          const imported = await executor.call("import_files_tool", { paths: JSON.stringify([local]), skip_indexing: "true" });
          if (!imported.ok) {
            printOutcome(ctx, imported);
            return;
          }
          fileId = undefined;
          if (executor instanceof PortableExecutor) {
            // The imported entry: same path, or (copied into the project assets) the newest with that name.
            const files = executor.session.doc.project.files;
            const base = path.basename(local);
            fileId = files.find((f) => f.path === local)?.id ?? [...files].reverse().find((f) => path.basename(String(f.path)) === base)?.id;
          }
          if (!fileId) query = path.basename(local);
        }
        const args = toolArgs(ctx, "add_clip_to_timeline_tool", [
          [["file_id"], fileId],
          [["query"], query],
          [["position_seconds"], parseTime(opts.at)],
          [["track"], opts.track],
          [["start_seconds"], parseTime(opts.start)],
          [["end_seconds"], parseTime(opts.end)],
          [["duration_seconds"], parseTime(opts.duration)],
        ]);
        printOutcome(ctx, await executor.call("add_clip_to_timeline_tool", args));
      });
    });

  program
    .command("move")
    .description("move a clip to another time and/or track")
    .argument("<clip>", "clip id")
    .option("--to <time>", "new timeline position")
    .option("--by <time>", "shift by this many seconds (negative moves left)")
    .option("-t, --track <track>", "destination track")
    .action(async (clip: string, opts: { to?: string; by?: string; track?: string }) => {
      if (opts.to === undefined && opts.by === undefined && opts.track === undefined) throw new CliError("Give --to, --by or --track.", 2);
      if (opts.to !== undefined && opts.by !== undefined) throw new CliError("Give --to or --by, not both.", 2);
      await withExecutor(ctx, async (executor) => {
        let position = parseTime(opts.to);
        if (opts.by !== undefined) {
          if (!(executor instanceof PortableExecutor)) throw new CliError("--by needs the clip's position; use --to while the desktop app has the project open.", 2);
          const current = executor.session.doc.project.clips.find((c) => c.id === clip);
          if (!current) throw new CliError(`No timeline clip with id '${clip}'.`);
          position = Math.max(0, current.position + parseTime(opts.by)!);
        }
        const args = toolArgs(ctx, "move_clip_tool", [
          [CLIP, clip],
          [["position_seconds"], position],
          [["track"], opts.track],
        ]);
        printOutcome(ctx, await executor.call("move_clip_tool", args));
      });
    });

  program
    .command("trim")
    .description("change a clip's source in/out points")
    .argument("<clip>", "clip id")
    .option("--start <time>", "new source in point")
    .option("--end <time>", "new source out point")
    .option("--edge <edge>", "drag the left or right edge on the timeline (with --to)")
    .option("--to <time>", "timeline time to drag --edge to")
    .action(async (clip: string, opts: { start?: string; end?: string; edge?: string; to?: string }) => {
      const dragging = opts.edge !== undefined || opts.to !== undefined;
      if (dragging && !(opts.edge === "left" || opts.edge === "right") ) throw new CliError("--edge must be left or right (with --to).", 2);
      if (dragging && opts.to === undefined) throw new CliError("--edge needs --to <time>.", 2);
      if (!dragging && opts.start === undefined && opts.end === undefined) throw new CliError("Give --start and/or --end, or --edge with --to.", 2);
      await runToolCommand(
        ctx,
        "trim_clip_tool",
        toolArgs(ctx, "trim_clip_tool", [
          [CLIP, clip],
          [["start_seconds", "start"], parseTime(opts.start)],
          [["end_seconds", "end"], parseTime(opts.end)],
          [["edge"], opts.edge],
          [["at_seconds"], parseTime(opts.to)],
        ]),
      );
    });

  program
    .command("split")
    .description("cut a clip in two at a timeline time (no clip: cut everything under that time)")
    .argument("[clip]", "clip id")
    .requiredOption("--at <time>", "timeline time to cut at")
    .option("--keep <side>", "both (default), left or right", "both")
    .action(async (clip: string | undefined, opts: { at: string; keep: string }) => {
      if (!["both", "left", "right"].includes(opts.keep)) throw new CliError("--keep must be both, left or right.", 2);
      await runToolCommand(
        ctx,
        "split_clip_tool",
        toolArgs(ctx, "split_clip_tool", [
          [CLIP, clip],
          [["at_seconds", "position_seconds", "time_seconds", "seconds"], parseTime(opts.at)],
          [["keep"], opts.keep === "both" ? undefined : opts.keep],
        ]),
      );
    });

  program
    .command("delete")
    .alias("rm")
    .description("remove clips from the timeline")
    .argument("<clips...>", "clip ids")
    .action(async (clips: string[]) => {
      await withExecutor(ctx, async (executor) => {
        for (const clip of clips) printOutcome(ctx, await executor.call("delete_from_timeline_tool", { timeline_clip_id: clip }));
      });
    });

  program
    .command("fade")
    .description("fade a clip in and/or out (picture and sound)")
    .argument("<clip>", "clip id")
    .option("--in <time>", "fade-in length")
    .option("--out <time>", "fade-out length")
    .option("--video-only", "leave the volume alone")
    .action(async (clip: string, opts: { in?: string; out?: string; videoOnly?: boolean }) => {
      if (opts.in === undefined && opts.out === undefined) throw new CliError("Give --in and/or --out.", 2);
      await runToolCommand(
        ctx,
        "fade_clip_tool",
        toolArgs(ctx, "fade_clip_tool", [
          [CLIP, clip],
          [["fade_in_seconds", "fade_in", "in_seconds"], parseTime(opts.in)],
          [["fade_out_seconds", "fade_out", "out_seconds"], parseTime(opts.out)],
          [["audio", "include_audio"], opts.videoOnly ? false : undefined],
        ]),
      );
    });

  program
    .command("speed")
    .description("play a clip faster or slower (2 = twice as fast, -1 = reversed)")
    .argument("<clip>", "clip id")
    .argument("<factor>", "speed factor")
    .action(async (clip: string, factorText: string) => {
      const factor = Number(factorText);
      if (!Number.isFinite(factor) || factor === 0) throw new CliError(`Not a speed factor: ${factorText}`, 2);
      await runToolCommand(
        ctx,
        "set_clip_speed_tool",
        toolArgs(ctx, "set_clip_speed_tool", [
          [CLIP, clip],
          [["factor", "speed", "rate"], Math.abs(factor)],
          [["direction"], factor < 0 ? "backward" : undefined],
        ]),
      );
    });

  program
    .command("set")
    .description("set a clip property (alpha, scale_x, location_y, rotation, volume, gravity, title…), optionally as a keyframe")
    .argument("<clip>", "clip id")
    .argument("<assignment>", "property=value")
    .option("--at <time>", "keyframe at this timeline time")
    .action(async (clip: string, assignment: string, opts: { at?: string }) => {
      const eq = assignment.indexOf("=");
      if (eq <= 0) throw new CliError("Use property=value, e.g. alpha=0.5.", 2);
      await runToolCommand(
        ctx,
        "set_clip_property_tool",
        toolArgs(ctx, "set_clip_property_tool", [
          [CLIP, clip],
          [["property"], assignment.slice(0, eq)],
          [["value"], assignment.slice(eq + 1)],
          [["at_seconds"], parseTime(opts.at)],
        ]),
      );
    });

  program
    .command("volume")
    .description("set a clip's volume (0.5, 50% or -6dB), optionally for a time range")
    .argument("<clip>", "clip id")
    .argument("<level>", "linear gain, percent, or dB")
    .option("--start <time>", "range start (timeline)")
    .option("--end <time>", "range end (timeline)")
    .action(async (clip: string, level: string, opts: { start?: string; end?: string }) => {
      const parsed = parseLevel(level);
      await runToolCommand(ctx, "set_clip_volume_tool", {
        timeline_clip_id: clip,
        ...(parsed.db !== undefined ? { db: parsed.db } : { volume: parsed.volume }),
        ...(opts.start !== undefined ? { start_seconds: parseTime(opts.start) } : {}),
        ...(opts.end !== undefined ? { end_seconds: parseTime(opts.end) } : {}),
      });
    });

  const effect = program.command("effect").description("clip effects");
  effect
    .command("add")
    .description("add an effect (libopenshot class name, e.g. Blur, Brightness, ChromaKey)")
    .argument("<clip>", "clip id")
    .argument("<effect>", "effect class name")
    .action(async (clip: string, name: string) => {
      await runToolCommand(ctx, "add_effect_tool", { timeline_clip_id: clip, effect: name });
    });
  effect
    .command("list")
    .description("effects you can add (libopenshot catalog)")
    .option("--audio", "only audio effects")
    .option("--video", "only video effects")
    .action(async (opts: { audio?: boolean; video?: boolean }) => {
      await runToolCommand(ctx, "list_effects_tool", opts.audio ? { category: "audio" } : opts.video ? { category: "video" } : {});
    });
  effect
    .command("rm")
    .description("remove an effect (ids are in the clip's receipt or `zenvi clips`)")
    .argument("<effect>", "effect id")
    .action(async (id: string) => {
      await runToolCommand(ctx, "remove_effect_tool", toolArgs(ctx, "remove_effect_tool", [[["effect_id", "effect"], id]]));
    });
  effect
    .command("set")
    .description("set an effect parameter, optionally as a keyframe at a time")
    .argument("<effect>", "effect id")
    .argument("<assignment>", "property=value")
    .option("--at <time>", "keyframe time (timeline)")
    .action(async (id: string, assignment: string, opts: { at?: string }) => {
      const eq = assignment.indexOf("=");
      if (eq <= 0) throw new CliError("Use property=value, e.g. sigma=4.", 2);
      await runToolCommand(
        ctx,
        "set_effect_property_tool",
        toolArgs(ctx, "set_effect_property_tool", [
          [["effect_id", "effect"], id],
          [["property", "name"], assignment.slice(0, eq)],
          [["value"], assignment.slice(eq + 1)],
          [["at_seconds", "seconds", "time"], parseTime(opts.at)],
        ]),
      );
    });

  program
    .command("transition")
    .description("add a transition (default: fade) at a clip's start or between it and the next clip")
    .argument("<clip>", "clip id")
    .option("--name <name>", "transition name (`zenvi call list_transitions_tool`)", "fade")
    .option("--duration <time>", "length", "1")
    .option("--at <time>", "timeline position")
    .action(async (clip: string, opts: { name: string; duration: string; at?: string }) => {
      await runToolCommand(ctx, "apply_transition_tool", {
        timeline_clip_id: clip,
        name: opts.name,
        duration_seconds: parseTime(opts.duration),
        ...(opts.at !== undefined ? { position_seconds: parseTime(opts.at) } : {}),
      });
    });

  program
    .command("title")
    .description("add a text title (SVG template) to the timeline")
    .argument("<text>", "title text")
    .option("--template <name>", "title template (e.g. Standard_1)")
    .option("--at <time>", "timeline position")
    .option("--duration <time>", "length")
    .option("-t, --track <track>", "track")
    .action(async (text: string, opts: { template?: string; at?: string; duration?: string; track?: string }) => {
      await runToolCommand(ctx, "add_title_tool", {
        text,
        ...(opts.template ? { template: opts.template } : {}),
        ...(opts.at !== undefined ? { position_seconds: parseTime(opts.at) } : {}),
        ...(opts.duration !== undefined ? { duration_seconds: parseTime(opts.duration) } : {}),
        ...(opts.track !== undefined ? { track: opts.track } : {}),
      });
    });

  program
    .command("keyframe")
    .description("animate a clip property: time=value pairs (volume, alpha, location_x/y, scale_x/y, rotation)")
    .argument("<clip>", "clip id")
    .argument("<property>", "property name")
    .argument("<points...>", "time=value (timeline time), or f<frame>=value")
    .action(async (clip: string, property: string, points: string[]) => {
      const parsed = points.map((p) => {
        const eq = p.indexOf("=");
        if (eq <= 0) throw new CliError(`Use time=value, e.g. 0=1 2.5=0 (got "${p}").`, 2);
        const at = p.slice(0, eq);
        const value = Number(p.slice(eq + 1));
        if (!Number.isFinite(value)) throw new CliError(`Not a number: ${p.slice(eq + 1)}`, 2);
        const frame = /^f(\d+)$/i.exec(at);
        return frame ? { frame: Number(frame[1]), value } : { seconds: parseTime(at)!, value };
      });
      await runToolCommand(ctx, "set_keyframes_tool", { timeline_clip_id: clip, property, points: parsed });
    });

  const marker = program.command("marker").description("timeline markers");
  marker
    .command("add")
    .argument("<time>", "timeline time")
    .argument("[label]", "label")
    .action(async (time: string, label?: string) => {
      await runToolCommand(ctx, "add_marker_tool", { position_seconds: parseTime(time), ...(label ? { label } : {}) });
    });
  marker
    .command("rm")
    .argument("<marker>", "marker id")
    .action(async (id: string) => {
      await runToolCommand(ctx, "remove_marker_tool", toolArgs(ctx, "remove_marker_tool", [[["marker_id", "id"], id]]));
    });

  const track = program.command("track").description("tracks");
  track
    .command("add")
    .argument("[label]", "track label")
    .action(async (label?: string) => {
      await runToolCommand(ctx, "add_track_tool", label ? { label } : {});
    });
}
