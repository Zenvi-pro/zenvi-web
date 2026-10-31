/**
 * Cutting on audio transients (TECHNIQUES2 T040: cuts land on the knife, the
 * tool strike, the footstep, not on the drum grid).
 *
 *   detect_onsets_tool        the transients of a clip's or a file's sound, with
 *                             how hard each hits, and cut points proposed on them
 *   snap_cuts_to_onsets_tool  moves cuts onto the nearest strong transient within
 *                             a tolerance: roll edits (ops/onset-snap.ts), so no
 *                             footage moves and the sequence keeps its length
 *
 * Onsets come from analysis/beats.ts `detectOnsets` on audio the host decodes
 * (`AudioHost.decodePcm`). The cuts stay plain clip in/out points: the
 * desktop plays them unchanged.
 */

import { z } from "zod";
import type { Onset } from "../../analysis/beats.js";
import type { Clip, ProjectFile } from "../../model/types.js";
import { chooseOnset, listCuts, onsetsOnTimeline, rollCut, rollRange, type Cut } from "../../ops/onset-snap.js";
import { isRetimed } from "../speech.js";
import { onsetsOfFile } from "../beats.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import { fileById } from "./common.js";
import { ToolError, clipTitle, gridOf, r3, resolveLayer } from "./timeline-edit-common.js";

const DETECT = "detect_onsets_tool";
const SNAP = "snap_cuts_to_onsets_tool";
/** Onsets listed in a receipt, at most (the strongest when there are more). */
const MAX_LISTED = 300;

const detectInput = z.strictObject({
  clip_id: z.string().min(1).optional().describe("Timeline clip whose sound to read; times are timeline seconds inside the clip."),
  file_id: z.string().min(1).optional().describe("Media-bin file whose sound to read; times are seconds into the file."),
  min_strength: z.number().min(0).max(1).optional().describe("Weakest transient kept, 0..1 relative to the hardest hit (default 0.3)."),
  min_shot_seconds: z.number().min(0.05).max(30).optional().describe("Proposed cut points are at least this far apart (default 0.5): the strongest hits win."),
});

const snapInput = z.strictObject({
  clip_ids: z.array(z.string().min(1)).max(500).optional().describe("Clips whose incoming cut (their start) to snap. Default: every cut of `track`, or of every picture track."),
  track: z.string().optional().describe("Only cuts on this track (UI track number, name, or layer number)."),
  start: z.number().min(0).optional().describe("Only cuts at or after this timeline second."),
  end: z.number().min(0).optional().describe("Only cuts at or before this timeline second."),
  onsets_from: z
    .enum(["incoming", "outgoing", "clip"])
    .optional()
    .describe("Whose sound the transients come from: incoming (default; the next shot starts on its own hit, e.g. the knife strike), outgoing (the shot ends on its hit), or clip (onset_clip_id: an SFX, ambience or music clip)."),
  onset_clip_id: z.string().min(1).optional().describe("onsets_from=clip: the timeline clip whose sound sets the hits."),
  tolerance_frames: z.number().int().min(1).max(30).optional().describe("Farthest a cut moves, frames (default 4)."),
  min_strength: z.number().min(0).max(1).optional().describe("Weakest transient a cut snaps to, 0..1 (default 0.3)."),
  lead_frames: z.number().int().min(0).max(5).optional().describe("Cut this many frames before the hit (default 0: the first frame of the shot carries the transient)."),
  dry_run: z.boolean().optional().describe("true: only propose the moves (nothing changes)."),
});

type SnapInput = z.infer<typeof snapInput>;

const roundOnset = (o: Onset) => ({ timeSec: r3(o.timeSec), strength: o.strength });

/** The strongest onsets at least `gap` seconds apart, in time order: where cuts on this sound go. */
function proposeCuts(onsets: readonly Onset[], gap: number): Onset[] {
  const kept: Onset[] = [];
  for (const o of [...onsets].sort((a, b) => b.strength - a.strength)) if (kept.every((k) => Math.abs(k.timeSec - o.timeSec) >= gap)) kept.push(o);
  return kept.sort((a, b) => a.timeSec - b.timeSec);
}

/** Decoded transients per file, once per call. */
function onsetCache(call: ToolCall): (file: ProjectFile) => Promise<Onset[] | string> {
  const cache = new Map<string, Promise<Onset[] | string>>();
  return (file) => {
    const id = String(file.id);
    if (!cache.has(id)) cache.set(id, onsetsOfFile(call, file, { threshold: 0.1 }));
    return cache.get(id)!;
  };
}

export function selectCuts(call: ToolCall, args: Pick<SnapInput, "clip_ids" | "track" | "start" | "end">): Cut[] {
  const project = call.doc.project;
  const layers = args.track !== undefined ? new Set([resolveLayer(project, args.track)]) : undefined;
  let cuts = listCuts(project, layers);
  if (args.clip_ids) {
    for (const id of args.clip_ids) if (!project.clips.some((c) => String(c.id) === id)) throw new ToolError(`No timeline clip with id='${id}'.`);
    const wanted = new Set(args.clip_ids);
    cuts = cuts.filter((c) => wanted.has(c.incoming.id));
  }
  return cuts.filter((c) => (args.start === undefined || c.at >= args.start - 1e-6) && (args.end === undefined || c.at <= args.end + 1e-6));
}

export const onsetSnapTools: CatalogTool[] = [
  directTool({
    name: DETECT,
    title: "Detect audio onsets",
    description:
      "The transients of a clip's or a file's sound (hits, strikes, footsteps, door slams, consonants, drum hits) with how hard each one hits (0..1), and cut points proposed on the strongest ones at least min_shot_seconds apart. " +
      "Cutting on these in-world hits is what makes a cut feel locked (T040), more than the music's beat grid. A clip's onsets are timeline seconds (only the part the clip plays); a file's are file seconds. " +
      "Read-only. To move existing cuts onto them use snap_cuts_to_onsets_tool; for the beat grid use detect_beats_tool.",
    input: detectInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call, args) => {
      const project = call.doc.project;
      if (!args.clip_id === !args.file_id) return refused(DETECT, "Error: give clip_id or file_id (one of them).");
      let clip: Clip | undefined;
      let file: ProjectFile | undefined;
      if (args.clip_id) {
        clip = project.clips.find((c) => String(c.id) === args.clip_id);
        if (!clip) return refused(DETECT, `Error: No timeline clip with id='${args.clip_id}'.`);
        if (isRetimed(clip as unknown as Record<string, unknown>)) return refused(DETECT, `Error: ${clipTitle(clip)} is retimed (speed or time curve); read its file instead (file_id=${String(clip.file_id)}).`);
        file = fileById(project, String(clip.file_id ?? ""));
        if (!file) return refused(DETECT, `Error: ${clipTitle(clip)} has no media file.`);
      } else {
        file = fileById(project, args.file_id!);
        if (!file) return refused(DETECT, `Error: Unknown file_id '${args.file_id}'.`);
      }
      if (!call.host.audio?.decodePcm) return unavailable(DETECT, "this surface cannot decode audio (the CLI, zenvi mcp and Zenvi Cloud can).");
      const found = await onsetsOfFile(call, file, { threshold: args.min_strength ?? 0.3 });
      if (typeof found === "string") return failed(DETECT, found);
      const onsets = clip ? onsetsOnTimeline(found, clip).filter((o) => o.timeSec >= clip!.position - 1e-6 && o.timeSec < clip!.position + clip!.end - clip!.start) : found;
      const g = gridOf(project);
      const listed = onsets.length > MAX_LISTED ? proposeCuts(onsets, 0).slice(0, MAX_LISTED).sort((a, b) => a.timeSec - b.timeSec) : onsets;
      const cuts = proposeCuts(onsets, args.min_shot_seconds ?? 0.5);
      const where = clip ? `${clipTitle(clip)} (timeline seconds)` : `${String(file.name ?? file.id)} (file seconds)`;
      const strongest = [...onsets].sort((a, b) => b.strength - a.strength).slice(0, 5).map((o) => r3(o.timeSec)).sort((a, b) => a - b);
      return applied(
        DETECT,
        onsets.length === 0
          ? `No transients at or above strength ${args.min_strength ?? 0.3} in ${where}.`
          : `${onsets.length} transient(s) in ${where}; ${cuts.length} proposed cut point(s). Hardest hits at ${strongest.join(", ")} s.`,
        {
          ...(onsets.length > MAX_LISTED ? { warnings: [`${onsets.length} transients: only the ${MAX_LISTED} strongest are listed.`] } : {}),
          data: {
            ...(clip ? { timeline_clip_id: clip.id } : { file_id: file.id }),
            clock: clip ? "timeline" : "file",
            onsets: listed.map((o) => ({ ...roundOnset(o), frame: Math.round(o.timeSec * g.fps) })),
            proposed_cuts: cuts.map((o) => ({ ...roundOnset(o), frame: Math.round(o.timeSec * g.fps) })),
          },
        },
        0,
      );
    },
  }),

  directTool({
    name: SNAP,
    title: "Snap cuts to audio onsets",
    description:
      "Move cuts onto the nearest strong audio transient within tolerance_frames (T040, cuts on in-world sounds): by default the incoming shot's own hit, so the shot opens on its knife strike, tool hit or footstep; " +
      "onsets_from=outgoing ends the shot on its hit; onsets_from=clip with onset_clip_id snaps every cut to an SFX, ambience or music clip. Each move is a roll edit: the outgoing out point and the incoming in point move together, " +
      "nothing else on the timeline moves and the sequence keeps its length; a cut moves only as far as both clips' media allows. Cuts covered by a transition, on a locked track or between retimed clips are kept and named. " +
      "dry_run=true only proposes. One undo step; the receipt lists every cut moved (from, to, frames, the hit's strength) and every cut kept with the reason.",
    input: snapInput,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (call, args: SnapInput) => {
      const project = call.doc.project;
      const from = args.onsets_from ?? "incoming";
      if (from === "clip" && !args.onset_clip_id) return refused(SNAP, "Error: onsets_from=clip needs onset_clip_id.");
      if (from !== "clip" && args.onset_clip_id) return refused(SNAP, "Error: onset_clip_id goes with onsets_from=clip.");
      if (args.start !== undefined && args.end !== undefined && args.end < args.start) return refused(SNAP, "Error: end is before start.");
      let cuts: Cut[];
      try {
        cuts = selectCuts(call, args);
      } catch (error) {
        if (error instanceof ToolError) return refused(SNAP, `Error: ${error.message}`);
        throw error;
      }
      let source: Clip | undefined;
      if (from === "clip") {
        source = project.clips.find((c) => String(c.id) === args.onset_clip_id);
        if (!source) return refused(SNAP, `Error: No timeline clip with id='${args.onset_clip_id}'.`);
        if (isRetimed(source as unknown as Record<string, unknown>)) return refused(SNAP, `Error: ${clipTitle(source)} is retimed; its hits are not where its file has them.`);
      }
      if (cuts.length === 0) return refused(SNAP, "Error: no cuts to snap: no two picture clips butt against each other in the selection.");
      if (!call.host.audio?.decodePcm) return unavailable(SNAP, "this surface cannot decode audio (the CLI, zenvi mcp and Zenvi Cloud can).");

      const g = gridOf(project);
      const options = { tolerance: (args.tolerance_frames ?? 4) / g.fps, minStrength: args.min_strength ?? 0.3, lead: (args.lead_frames ?? 0) / g.fps };
      const onsets = onsetCache(call);
      const moves: { cut: Cut; delta: number; onset: Onset }[] = [];
      const kept: { outgoing: string; incoming: string; at: number; reason: string }[] = [];
      const warnings: string[] = [];
      // A clip between two snapped cuts loses length at both ends: the second roll sees what the first one took.
      const trimmedIn = new Map<string, number>();
      let unreadable = 0;
      for (const cut of cuts) {
        const keep = (reason: string) => kept.push({ outgoing: cut.outgoing.id, incoming: cut.incoming.id, at: r3(cut.at), reason });
        const range = rollRange(project, cut, Math.max(0, trimmedIn.get(cut.outgoing.id) ?? 0));
        if ("blocked" in range) {
          keep(range.blocked);
          continue;
        }
        const clip = from === "incoming" ? cut.incoming : from === "outgoing" ? cut.outgoing : source!;
        const file = fileById(project, String(clip.file_id ?? ""));
        const found = file ? await onsets(file) : `Error: ${clipTitle(clip)} has no media file.`;
        if (typeof found === "string") {
          unreadable += 1;
          keep(found.replace(/^Error: /, ""));
          continue;
        }
        // A source clip's hits count only where it plays.
        const heard = onsetsOnTimeline(found, clip).filter((o) => from !== "clip" || (o.timeSec >= clip.position - g.tol && o.timeSec <= clip.position + clip.end - clip.start + g.tol));
        const choice = chooseOnset(project, cut, heard, range, options);
        if (!choice) keep(`no transient of strength ${options.minStrength} or more within ${args.tolerance_frames ?? 4} frame(s) the media can reach`);
        else if (Math.abs(choice.delta) < g.tol) keep("already on a transient");
        else {
          moves.push({ cut, delta: choice.delta, onset: choice.onset });
          trimmedIn.set(cut.incoming.id, choice.delta);
        }
      }
      if (unreadable === cuts.length) return failed(SNAP, `Error: ${kept[0]!.reason}`);

      const rows = moves.map((m) => ({
        outgoing: m.cut.outgoing.id,
        incoming: m.cut.incoming.id,
        from: r3(m.cut.at),
        to: r3(m.cut.at + m.delta),
        frames: Math.round(m.delta * g.fps),
        strength: m.onset.strength,
      }));
      const data = { onsets_from: from, ...(source ? { onset_clip_id: source.id } : {}), moved: rows, kept, changedClipIds: [...new Set(moves.flatMap((m) => [m.cut.outgoing.id, m.cut.incoming.id]))] };
      const counts = `${moves.length} of ${cuts.length} cut(s)`;
      if (args.dry_run) return applied(SNAP, `Would snap ${counts} onto ${from === "clip" ? clipTitle(source!) : `the ${from} shot`}'s transients (dry run, nothing changed).`, { warnings, data }, 0);
      if (moves.length === 0) return unchanged(SNAP, `No cut moved: ${kept.length === 1 ? kept[0]!.reason : `${kept.length} cut(s) kept (see kept)`}.`, { warnings, data });
      call.commit((tx) => {
        for (const m of moves) rollCut(tx, m.cut, m.delta);
      }, "Snap cuts to onsets");
      const mean = rows.reduce((s, r) => s + Math.abs(r.frames), 0) / rows.length;
      return applied(SNAP, `Snapped ${counts} onto transients (mean move ${mean.toFixed(1)} frame(s)); ${kept.length} kept.`, { warnings, data });
    },
  }),
];
