/**
 * snap_cuts_to_beats_tool: cuts already on the timeline (a re-edit, a hand
 * edit, a builder's output after trims) moved onto the music's beat grid.
 * Round 7 re-edits (gaming, real estate, flash montage) placed shots at their
 * natural lengths and had no way to lock them to the 82 / 162 BPM grid.
 *
 * The moves are the roll edits of snap_cuts_to_onsets_tool (ops/onset-snap.ts):
 * the outgoing out point and the incoming in point move together, so no other
 * clip moves and the sequence keeps its length. The grid is the music clip's
 * tracked beats (tools/beats.ts), or the caller's (beat-override.ts).
 */

import { z } from "zod";
import type { Onset } from "../../analysis/beats.js";
import type { Clip } from "../../model/types.js";
import { chooseOnset, onsetsOnTimeline, rollCut, rollRange, type Cut } from "../../ops/onset-snap.js";
import { hasVideoStream } from "../audio-mix.js";
import { beatOverrideProblem, beatOverrideShape, explicitBeats } from "../beat-override.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool } from "../define.js";
import { isMuted, mixEntries } from "../mix-roles.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import { isRetimed } from "../speech.js";
import { fileById } from "./common.js";
import { selectCuts } from "./onset-snap.js";
import { ToolError, clipTitle, gridOf, r3 } from "./timeline-edit-common.js";

const SNAP = "snap_cuts_to_beats_tool";
const GRIDS = ["beats", "downbeats", "half_beats"] as const;
type Grid = (typeof GRIDS)[number];

const input = z.strictObject({
  clip_ids: z.array(z.string().min(1)).max(500).optional().describe("Clips whose incoming cut (their start) to snap. Default: every cut of `track`, or of every picture track."),
  track: z.string().optional().describe("Only cuts on this track (UI track number, name, or layer number)."),
  start: z.number().min(0).optional().describe("Only cuts at or after this timeline second."),
  end: z.number().min(0).optional().describe("Only cuts at or before this timeline second."),
  music_clip_id: z.string().min(1).optional().describe("The timeline clip whose beat sets the grid. Default: the longest music clip on the timeline."),
  grid: z.enum(GRIDS).optional().describe("Where cuts may land: beats (default), downbeats (bar lines, for slower cutting) or half_beats (eighths, for fast montage runs)."),
  ...beatOverrideShape,
  tolerance_frames: z.number().int().min(1).max(60).optional().describe("Farthest a cut moves, frames. Default: half a grid step, so every cut can reach its nearest line."),
  lead_frames: z.number().int().min(0).max(5).optional().describe("Cut this many frames before the beat (default 0: the first frame of the new shot is on the beat)."),
  dry_run: z.boolean().optional().describe("true: only propose the moves (nothing changes)."),
});

type Input = z.infer<typeof input>;

/** The longest music-stem clip you hear without picture (footage sound is no beat to cut to), or null. */
function defaultMusicClip(project: Parameters<typeof mixEntries>[0]): Clip | null {
  const music = mixEntries(project)
    .filter((e) => e.mixRole === "music" && !isMuted(e) && !hasVideoStream(e.clip, e.file))
    .sort((a, b) => b.end - b.start - (a.end - a.start));
  return music[0]?.clip ?? null;
}

/** Grid lines between consecutive beats (half_beats), only bar lines (downbeats) or the beats themselves. */
function gridLines(beats: readonly number[], downbeats: readonly number[], grid: Grid): number[] {
  if (grid === "downbeats") return [...downbeats];
  if (grid === "beats") return [...beats];
  return beats.flatMap((b, i) => (i + 1 < beats.length ? [b, (b + beats[i + 1]!) / 2] : [b]));
}

export const beatSnapTools: CatalogTool[] = [
  directTool({
    name: SNAP,
    title: "Snap cuts to the beat",
    description:
      "Move existing cuts onto the music's beat grid: re-edits, hand edits, or a build after trims. Each cut moves to the nearest beat (grid: beats, downbeats, half_beats) within tolerance_frames (default half a grid step), by a roll edit: " +
      "the outgoing out point and the incoming in point move together, nothing else on the timeline moves and the sequence keeps its length; a cut moves only as far as both clips' media allows. " +
      "The grid is the music clip's tracked beat (music_clip_id, default the longest music clip), or yours: beats (seconds in the music file), or bpm + offset_seconds. Cuts on a transition, a locked track, between retimed clips or after the music are kept and named. " +
      "dry_run=true only proposes. One undo step; the receipt lists every cut moved (from, to, frames) and every cut kept with the reason. For in-world hits (a knife, a footstep) use snap_cuts_to_onsets_tool.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const problem = beatOverrideProblem(args);
      if (problem) return refused(SNAP, problem);
      if (args.start !== undefined && args.end !== undefined && args.end < args.start) return refused(SNAP, "Error: end is before start.");
      let cuts: Cut[];
      try {
        cuts = selectCuts(call, args);
      } catch (error) {
        if (error instanceof ToolError) return refused(SNAP, `Error: ${error.message}`);
        throw error;
      }
      if (cuts.length === 0) return refused(SNAP, "Error: no cuts to snap: no two picture clips butt against each other in the selection.");

      let music: Clip | null = null;
      if (args.music_clip_id) {
        music = project.clips.find((c) => String(c.id) === args.music_clip_id) ?? null;
        if (!music) return refused(SNAP, `Error: No timeline clip with id='${args.music_clip_id}'.`);
      } else music = defaultMusicClip(project);
      if (music && isRetimed(music as unknown as Record<string, unknown>)) return refused(SNAP, `Error: ${clipTitle(music)} is retimed; its beats are not where its file has them.`);

      // The grid in timeline seconds, and the stretch of the timeline it covers.
      const g = gridOf(project);
      const plays = music ? { from: music.position, to: music.position + music.end - music.start } : { from: 0, to: Infinity };
      const fileSeconds = music ? Number(fileById(project, String(music.file_id ?? ""))?.duration) || music.end : Math.max(...cuts.map((c) => c.at)) + 4;
      let beats: number[];
      let downbeats: number[];
      let source: string;
      const explicit = explicitBeats(args, fileSeconds);
      if (explicit) {
        beats = explicit.beats;
        downbeats = beats.filter((_, i) => i % 4 === 0);
        source = explicit.source;
      } else {
        if (!music) return refused(SNAP, "Error: no music on the timeline to take the beat from: pass music_clip_id, beats, or bpm with offset_seconds.");
        if (!canTrackBeats(call)) return refused(SNAP, "Error: this surface cannot decode audio to find the beat: pass beats, or bpm with offset_seconds.");
        const file = fileById(project, String(music.file_id ?? ""));
        if (!file) return refused(SNAP, `Error: ${clipTitle(music)} has no media file.`);
        const tracked = await beatsOfFile(call, file, args.bpm !== undefined ? { bpm: args.bpm } : {});
        if (typeof tracked === "string") return failed(SNAP, tracked);
        if (tracked.beats.length < 2) return failed(SNAP, `Error: no steady beat in ${clipTitle(music)}: pass beats, or bpm with offset_seconds.`);
        beats = tracked.beats.map((b) => b.timeSec);
        downbeats = tracked.downbeats.map((d) => d.timeSec);
        source = `${clipTitle(music)} at ${Math.round(tracked.bpm)} BPM`;
      }
      const grid = args.grid ?? "beats";
      const toTimeline = (times: number[]): Onset[] => {
        const onsets = times.map((timeSec) => ({ timeSec, strength: 1 }));
        return music ? onsetsOnTimeline(onsets, music).filter((o) => o.timeSec >= plays.from - g.tol && o.timeSec <= plays.to + g.tol) : onsets;
      };
      const lines = toTimeline(gridLines(beats, downbeats, grid));
      if (lines.length < 2) return refused(SNAP, `Error: fewer than two ${grid.replace("_", " ")} fall where the music plays.`);
      const step = (lines[lines.length - 1]!.timeSec - lines[0]!.timeSec) / (lines.length - 1);
      const toleranceFrames = args.tolerance_frames ?? Math.max(1, Math.floor((step * g.fps) / 2));
      const options = { tolerance: toleranceFrames / g.fps, minStrength: 0, lead: (args.lead_frames ?? 0) / g.fps };

      const moves: { cut: Cut; delta: number }[] = [];
      const kept: { outgoing: string; incoming: string; at: number; reason: string }[] = [];
      // A clip between two snapped cuts loses length at both ends: the second roll sees what the first one took.
      const trimmedIn = new Map<string, number>();
      for (const cut of cuts) {
        const keep = (reason: string) => kept.push({ outgoing: cut.outgoing.id, incoming: cut.incoming.id, at: r3(cut.at), reason });
        if (cut.at < plays.from - g.tol || cut.at > plays.to + g.tol) {
          keep("outside the music");
          continue;
        }
        const range = rollRange(project, cut, Math.max(0, trimmedIn.get(cut.outgoing.id) ?? 0));
        if ("blocked" in range) {
          keep(range.blocked);
          continue;
        }
        const choice = chooseOnset(project, cut, lines, range, options);
        if (!choice) keep(`no ${grid === "half_beats" ? "half beat" : grid.slice(0, -1)} within ${toleranceFrames} frame(s) the media can reach`);
        else if (Math.abs(choice.delta) < g.tol) keep("already on the beat");
        else {
          moves.push({ cut, delta: choice.delta });
          trimmedIn.set(cut.incoming.id, choice.delta);
        }
      }

      const rows = moves.map((m) => ({ outgoing: m.cut.outgoing.id, incoming: m.cut.incoming.id, from: r3(m.cut.at), to: r3(m.cut.at + m.delta), frames: Math.round(m.delta * g.fps) }));
      const onBeat = kept.filter((k) => k.reason === "already on the beat").length;
      const data = { grid, source, tolerance_frames: toleranceFrames, ...(music ? { music_clip_id: music.id } : {}), moved: rows, kept, changedClipIds: [...new Set(moves.flatMap((m) => [m.cut.outgoing.id, m.cut.incoming.id]))] };
      const counts = `${moves.length} of ${cuts.length} cut(s)`;
      if (args.dry_run) return applied(SNAP, `Would snap ${counts} onto the ${grid.replace("_", " ")} of ${source} (dry run, nothing changed).`, { data }, 0);
      if (moves.length === 0) return unchanged(SNAP, `No cut moved: ${onBeat === cuts.length ? "every cut is on the beat already" : kept.length === 1 ? kept[0]!.reason : `${kept.length} cut(s) kept (see kept)`}.`, { data });
      call.commit((tx) => {
        for (const m of moves) rollCut(tx, m.cut, m.delta);
      }, "Snap cuts to the beat");
      const mean = rows.reduce((s, r) => s + Math.abs(r.frames), 0) / rows.length;
      return applied(SNAP, `Snapped ${counts} onto the ${grid.replace("_", " ")} of ${source} (mean move ${mean.toFixed(1)} frame(s)); ${onBeat} already on it, ${kept.length - onBeat} kept.`, { data });
    },
  }),
];
