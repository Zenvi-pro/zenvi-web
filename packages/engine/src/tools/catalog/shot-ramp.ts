/**
 * shot_length_ramp_tool: the accelerating montage (TECHNIQUES2 T036). Shots
 * shorten along a curve from the first length to the last, optionally snap
 * to the music's beats or a sound's transients, a motif shot comes back
 * every N shots, and a final shot settles. The shape and the source fill are
 * reels/ramp.ts; the result is plain clips on one track, so every surface and
 * the desktop play it and each cut stays editable.
 */

import { z } from "zod";
import type { Clip, ProjectFile } from "../../model/types.js";
import { addClip, setClipProperty } from "../../ops/clips.js";
import { isOpError } from "../../ops/errors.js";
import { onsetsOnTimeline } from "../../ops/onset-snap.js";
import { ensureTrack } from "../../ops/overlays.js";
import { plannedOverlaps, trackEnd } from "../../ops/sequence.js";
import { MAX_RAMP_SHOTS, RAMP_CURVES, cutTimes, fillShots, rampLengths, snapCutTimes, type RampShot, type RampSource } from "../../reels/ramp.js";
import { beatsOfFile, onsetsOfFile } from "../beats.js";
import { isRetimed } from "../speech.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import { resolvePlacementTrack } from "../tracks.js";
import { fileById } from "./common.js";
import { visualKind } from "./reels.js";
import { clipTitle, gridOf, r3, trackName } from "./timeline-edit-common.js";

const TOOL = "shot_length_ramp_tool";

const input = z.strictObject({
  file_ids: z.array(z.string().min(1)).min(1).max(100).describe("Media-bin videos and images that fill the shots, in order (round and round; each video continues where it was last cut)."),
  first_shot_seconds: z.number().min(0.1).max(20).optional().describe("Length of the first shot (default 2.5)."),
  last_shot_seconds: z.number().min(0.05).max(20).optional().describe("Length of the last shot of the ramp (default 0.4). Longer than first_shot_seconds makes a decelerating ramp."),
  shots: z.number().int().min(2).max(MAX_RAMP_SHOTS).optional().describe("How many shots the ramp has (default 12 unless duration_seconds is given)."),
  duration_seconds: z.number().min(0.5).max(600).optional().describe("How long the ramp lasts instead of a shot count: the count that fits the curve best, scaled to fill it."),
  curve: z
    .enum(RAMP_CURVES)
    .optional()
    .describe("exponential (default: each shot the same fraction shorter, the trailer feel), linear, ease_in (stays long, then collapses at the end), ease_out (drops fast, then steadies)."),
  settle_seconds: z.number().min(0).max(20).optional().describe("A final held shot after the ramp, seconds (default none): the payoff the acceleration lands on."),
  settle_file_id: z.string().min(1).optional().describe("What the settle shot shows (default: the next source in turn)."),
  motif_file_id: z.string().min(1).optional().describe("A shot that comes back every motif_every shots, always from its first frame (a face, a logo, a recurring image)."),
  motif_every: z.number().int().min(2).max(50).optional().describe("Every how many shots the motif returns (default 4 when motif_file_id is given)."),
  snap: z.enum(["none", "beats", "onsets"]).optional().describe("Move each cut to the nearest beat or transient of snap_clip_id within a third of its shorter shot (default none)."),
  snap_clip_id: z.string().min(1).optional().describe("snap=beats|onsets: the timeline clip (music, SFX, ambience) whose beats or transients the cuts land on."),
  track: z.string().optional().describe("Track for the shots (UI track number, name, or layer number). Default: a new track on top (track 1 on an empty timeline)."),
  position: z.number().min(0).optional().describe("Timeline second the ramp starts (default: the end of the track)."),
  audio: z.enum(["keep", "mute"]).optional().describe("keep (default) leaves each shot's own sound; mute silences the shots (music carries the ramp)."),
});

type Input = z.infer<typeof input>;

function sourceOf(file: ProjectFile): RampSource | string {
  const kind = visualKind(file);
  if (!kind) return `${String(file.name ?? file.id)} has no picture`;
  const duration = Number(file.duration) || 0;
  if (kind === "video" && !(duration > 0)) return `${String(file.name ?? file.id)} has no known length`;
  return { fileId: String(file.id), kind, start: 0, end: kind === "video" ? duration : Infinity };
}

/** Hits of the snap clip as seconds from the ramp's start (only where the clip plays). */
async function snapHits(call: ToolCall, clip: Clip, kind: "beats" | "onsets", position: number): Promise<number[] | string> {
  const file = fileById(call.doc.project, String(clip.file_id ?? ""));
  if (!file) return `Error: ${clipTitle(clip)} has no media file.`;
  let times: number[];
  if (kind === "beats") {
    const beats = await beatsOfFile(call, file);
    if (typeof beats === "string") return beats;
    times = beats.beats.map((b) => b.timeSec);
  } else {
    const onsets = await onsetsOfFile(call, file);
    if (typeof onsets === "string") return onsets;
    times = onsets.map((o) => o.timeSec);
  }
  const end = clip.position + clip.end - clip.start;
  return onsetsOnTimeline(times.map((t) => ({ timeSec: t, strength: 1 })), clip)
    .map((o) => o.timeSec)
    .filter((t) => t >= clip.position && t <= end)
    .map((t) => t - position);
}

export const shotRampTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Shot-length ramp",
    description:
      "Cut an accelerating montage (T036): shots shorten along a curve from first_shot_seconds (default 2.5) to last_shot_seconds (default 0.4) over `shots` or duration_seconds, then optionally settle on a held shot. " +
      "file_ids fill the shots in order, each video continuing where it was last cut; motif_file_id comes back every motif_every shots from the same moment. snap=beats|onsets with snap_clip_id moves each cut onto the music's beat or a sound's " +
      "transient within a third of its shorter shot, so the ramp keeps its shape. Plain clips on one track (default a new track on top), every cut editable; one undo step. The receipt lists every shot (start, length, source, motif) and how many cuts snapped.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const g = gridOf(project);
      const first = args.first_shot_seconds ?? 2.5;
      const last = args.last_shot_seconds ?? 0.4;
      if (args.shots !== undefined && args.duration_seconds !== undefined) return refused(TOOL, "Error: give shots or duration_seconds, not both.");
      if (args.motif_every !== undefined && !args.motif_file_id) return refused(TOOL, "Error: motif_every goes with motif_file_id.");
      const snap = args.snap ?? "none";
      if (snap !== "none" && !args.snap_clip_id) return refused(TOOL, `Error: snap=${snap} needs snap_clip_id (the music or sound clip on the timeline).`);
      if (snap === "none" && args.snap_clip_id) return refused(TOOL, "Error: snap_clip_id goes with snap=beats or snap=onsets.");
      if (args.settle_file_id && !(args.settle_seconds && args.settle_seconds > 0)) return refused(TOOL, "Error: settle_file_id goes with settle_seconds.");

      const sources: RampSource[] = [];
      for (const id of args.file_ids) {
        const file = fileById(project, id);
        if (!file) return refused(TOOL, `Error: Unknown file_id '${id}'.`);
        const source = sourceOf(file);
        if (typeof source === "string") return refused(TOOL, `Error: ${source}: it cannot fill a shot.`);
        sources.push(source);
      }
      const extra = (id: string | undefined, what: string): RampSource | string | undefined => {
        if (!id) return undefined;
        const file = fileById(project, id);
        if (!file) return `Error: Unknown ${what} '${id}'.`;
        const source = sourceOf(file);
        return typeof source === "string" ? `Error: ${source}: it cannot be the ${what.replace("_file_id", "")} shot.` : source;
      };
      const motif = extra(args.motif_file_id, "motif_file_id");
      const settle = extra(args.settle_file_id, "settle_file_id");
      if (typeof motif === "string") return refused(TOOL, motif);
      if (typeof settle === "string") return refused(TOOL, settle);

      let snapClip: Clip | undefined;
      if (args.snap_clip_id) {
        snapClip = project.clips.find((c) => String(c.id) === args.snap_clip_id);
        if (!snapClip) return refused(TOOL, `Error: No timeline clip with id='${args.snap_clip_id}'.`);
        if (isRetimed(snapClip as unknown as Record<string, unknown>)) return refused(TOOL, `Error: ${clipTitle(snapClip)} is retimed; its beats are not where its file has them.`);
        if (!call.host.audio?.decodePcm) return refused(TOOL, `Error: snap=${snap} is not available in this Zenvi surface: it cannot decode audio. Use snap=none.`);
      }

      // Where the shots go.
      const defaultTrack = project.clips.length === 0 ? "1" : String(project.layers.length + 1);
      const resolved = resolvePlacementTrack(args.track ?? defaultTrack, project.layers);
      if (resolved.error || resolved.layer === undefined) return refused(TOOL, resolved.error ?? `Error: unknown track '${args.track}'.`);
      const layer = resolved.layer;
      if (project.layers.some((l) => l.number === layer && l.lock)) return refused(TOOL, `Error: ${trackName(project, layer)} is locked.`);
      const position = g.snap(args.position ?? trackEnd(project, layer));

      const lengths = rampLengths({ first, last, curve: args.curve ?? "exponential", ...(args.duration_seconds !== undefined ? { duration: args.duration_seconds } : { shots: args.shots ?? 12 }), settle: args.settle_seconds });
      let times = cutTimes(lengths, g.fps);
      let snapped: boolean[] = [];
      const warnings: string[] = [];
      if (snapClip && snap !== "none") {
        const hits = await snapHits(call, snapClip, snap, position);
        if (typeof hits === "string") return failed(TOOL, hits);
        if (hits.length === 0) warnings.push(`${clipTitle(snapClip)} has no ${snap} under the ramp: the cuts follow the curve alone.`);
        ({ times, snapped } = snapCutTimes(times, hits, g.fps, lengths.length - ((args.settle_seconds ?? 0) > 0 ? 1 : 0)));
      }
      const filled = fillShots(settle ? times.slice(0, -1) : times, sources, motif ? { source: motif, every: args.motif_every ?? 4 } : undefined);
      if (!Array.isArray(filled)) return refused(TOOL, `Error: no source is long enough for shot ${filled.unfilled + 1} (${filled.length.toFixed(2)} s): add longer footage or shorten first_shot_seconds.`);
      const shots: RampShot[] = [...filled];
      if (settle) {
        const at = times[times.length - 2]!;
        const length = times[times.length - 1]! - at;
        if (settle.kind === "video" && settle.end - settle.start < length - 1e-9) return refused(TOOL, `Error: the settle shot is ${length.toFixed(2)} s but its file is shorter.`);
        // Fresh footage when the ramp already showed this file: continue after the last part it used.
        const used = Math.max(settle.start, ...shots.filter((x) => x.fileId === settle.fileId && !x.motif).map((x) => x.sourceStart + x.length));
        const sourceStart = settle.kind === "video" && used + length <= settle.end + 1e-9 ? used : settle.kind === "video" ? settle.start : 0;
        shots.push({ fileId: settle.fileId, kind: settle.kind, at, length, sourceStart, motif: false });
      }

      const total = times[times.length - 1]!;
      const overlaps = plannedOverlaps(project, new Map(), [{ layer, start: position, end: position + total, label: "the ramp" }], g.tol);
      if (overlaps.length > 0) return refused(TOOL, `Error: the ramp (${position.toFixed(2)}-${(position + total).toFixed(2)} s) would cover ${overlaps.length} clip(s) on ${trackName(project, layer)}: pick another track or position.`);

      const mute = args.audio === "mute";
      let created: string[];
      try {
        created = call.commit((tx) => {
          if (resolved.newTracks) ensureTrack(tx, layer);
          return shots.map((shot) => {
            const clip = addClip(tx, {
              fileId: shot.fileId,
              position: position + shot.at,
              layer,
              start: shot.sourceStart,
              end: shot.sourceStart + shot.length,
              ...(shot.motif ? { title: "Motif" } : {}),
            });
            if (mute) setClipProperty(tx, clip.id, "volume", 0);
            return clip.id;
          });
        }, "Shot-length ramp");
      } catch (error) {
        if (isOpError(error)) return refused(TOOL, `Error: ${error.message}`);
        throw error;
      }

      const rampShots = shots.length - ((args.settle_seconds ?? 0) > 0 ? 1 : 0);
      const snappedCount = snapped.filter(Boolean).length;
      const summary =
        `Cut a ${rampShots}-shot ramp from ${shots[0]!.length.toFixed(2)} s to ${shots[rampShots - 1]!.length.toFixed(2)} s` +
        ((args.settle_seconds ?? 0) > 0 ? `, settling on a ${shots[shots.length - 1]!.length.toFixed(2)} s shot` : "") +
        ` on ${resolved.newTracks ? `a new track (${trackName(call.doc.project, layer)})` : trackName(call.doc.project, layer)}, ${position.toFixed(2)}-${(position + total).toFixed(2)} s` +
        (snapClip ? `; ${snappedCount} of ${snapped.length} cut(s) on ${snap}` : "") +
        ".";
      return applied(TOOL, summary, {
        warnings,
        data: {
          layer,
          position: r3(position),
          end: r3(position + total),
          createdClipIds: created,
          shots: shots.map((s, i) => ({ timeline_clip_id: created[i], file_id: s.fileId, start: r3(position + s.at), length: r3(s.length), source_start: r3(s.sourceStart), ...(s.motif ? { motif: true } : {}) })),
          ...(snapClip ? { snap, snapped: snappedCount, cuts: snapped.length } : {}),
        },
      });
    },
  }),
];
