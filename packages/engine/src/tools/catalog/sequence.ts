/**
 * sequence_shots_tool: put shots in an order an editor would cut them in,
 * and trim them to slots. The order comes from what crosses each cut (the
 * action continuing, the same shape and layout, the subject in place, the
 * colour, the motion's direction; sequence/features.ts), an energy arc,
 * the strongest shot held for the payoff, no picture twice in a row, and
 * speaker shots starting on their own words in the voice-over
 * (sequence/plan.ts). One undo step; the receipt says why each cut joins.
 *
 * Why a tool: on the zenvi-motion re-edit bench (2026-10-28) agents given a
 * reference's own shots left them in bin order or worse and broke voice
 * sync; the order is a search over every pair of cuts, which a model
 * looking at a few frames cannot do.
 */

import { z } from "zod";
import { deleteClips, addClip, setClipTiming } from "../../ops/clips.js";
import { addTrack } from "../../ops/tracks.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { fileLabel, isFootageFile, isStill } from "../../review/swaps.js";
import { shotFeatures } from "../../sequence/features.js";
import { ENERGY_ARCS, planSequence, type SequenceGoal, type SequenceShotInput } from "../../sequence/plan.js";
import { findSpoken } from "../../sequence/speech.js";
import { fpsFloat } from "../../timeline/time.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, refused, unchanged, failed } from "../receipt.js";
import { shotFrames, type ShotWindow } from "../shot-frames.js";
import { isLocked } from "../titles-text.js";
import { storedTranscript } from "../transcripts.js";

const TOOL = "sequence_shots_tool";
const MAX_SHOTS = 120;
/** How long a still holds when its shot gives no window. */
const STILL_SECONDS = 3;

const shotSchema = z.strictObject({
  clip_id: z.string().min(1).optional().describe("A timeline clip (it is moved and trimmed in place)."),
  file_id: z.string().min(1).optional().describe("A media-bin video or image (a new clip is added)."),
  start: z.number().min(0).optional().describe("File shots: source in-point, seconds (default 0)."),
  end: z.number().min(0).optional().describe("File shots: source out-point, seconds (default the end of the file; a still holds 3 s)."),
  speech_at: z.number().min(0).optional().describe("Voice sync: seconds into voice_file_id where what this shot says begins; the shot starts there."),
  says: z
    .string()
    .max(600)
    .optional()
    .describe("Voice sync: the words spoken in this shot (its burnt-in caption, its own transcript): found in voice_file_id's transcript (transcribe_media_tool first) and the shot starts on them."),
});

const input = z.strictObject({
  shots: z.array(shotSchema).min(2).max(MAX_SHOTS).optional().describe("The candidate shots: all timeline clips, or all bin files / windows of them."),
  file_ids: z.array(z.string().min(1)).min(2).max(MAX_SHOTS).optional().describe("Shorthand for shots: whole bin files."),
  track: z.number().int().positive().optional().describe("Without shots or file_ids: reorder every clip on this track (track number). With file shots: the track to place them on (default an empty track)."),
  arc: z
    .enum(ENERGY_ARCS)
    .optional()
    .describe("Energy curve over the sequence: peak (default: build to a peak three quarters in, then release), build, release, flat (order by continuity alone)."),
  open: z.string().min(1).optional().describe("clip_id or file_id of the shot that must open."),
  close: z.string().min(1).optional().describe("clip_id or file_id of the payoff shot that closes, or \"none\". Default: the strongest shot (interest and length) closes."),
  slots: z
    .array(z.number().gt(0).max(600))
    .min(1)
    .max(MAX_SHOTS)
    .optional()
    .describe("Slot lengths in seconds, in timeline order (the beats of a brief, shot lengths of a plan). Shots are trimmed to them; with fewer slots than shots the weakest and duplicate shots are left out (clips removed)."),
  continuity: z.number().min(0).max(2).optional().describe("Weight of cut continuity against the arc (default 1; 2 = match cuts first)."),
  voice_file_id: z.string().min(1).optional().describe("The voice-over / dialogue in the media bin that speaker shots sync to (speech_at, says; a clip of this same file syncs by itself)."),
  voice_at: z.number().min(0).optional().describe("Timeline seconds where voice_file_id's audio starts (default: where a clip of it plays it, else the sequence start)."),
  position: z.number().min(0).optional().describe("File shots: timeline seconds the sequence starts at (default 0)."),
  dry_run: z.boolean().optional().describe("Only plan: return the order (data.file_ids feeds match_cut_montage_tool or build_reel_tool) without changing the timeline."),
});
type Input = z.output<typeof input>;

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

interface Candidate {
  window: ShotWindow;
  clip?: Clip;
  speechAt?: number;
  /** How the shot was synced, for the receipt. */
  sync?: { voice_seconds: number; from: "speech_at" | "says" | "own audio"; score?: number };
}

function idOf(c: Candidate): string {
  return c.clip ? String(c.clip.id) : String(c.window.file.id);
}

/** The lowest track with no clips, or null. */
function emptyTrack(project: Project): number | null {
  const used = new Set(project.clips.map((c) => Number(c.layer)));
  const free = project.layers.map((l) => Number(l.number)).filter((n) => !used.has(n) && !isLocked(project, n)).sort((a, b) => a - b);
  return free[0] ?? null;
}

function resolve(project: Project, args: Input): Candidate[] | string {
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const clips = new Map(project.clips.map((c) => [String(c.id), c]));
  let raw: z.output<typeof shotSchema>[];
  if (args.shots) raw = args.shots;
  else if (args.file_ids) raw = args.file_ids.map((file_id) => ({ file_id }));
  else if (args.track !== undefined) {
    const onTrack = project.clips.filter((c) => Number(c.layer) === args.track).sort((a, b) => Number(a.position) - Number(b.position));
    if (onTrack.length < 2) return `Error: track ${args.track} has ${onTrack.length} clip(s); sequencing needs at least 2.`;
    raw = onTrack.map((c) => ({ clip_id: String(c.id) }));
  } else return "Error: give shots, file_ids, or a track whose clips to reorder.";
  if (args.shots && args.file_ids) return "Error: give shots or file_ids, not both.";
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const [k, s] of raw.entries()) {
    if ((s.clip_id === undefined) === (s.file_id === undefined)) return `Error: shots[${k}] needs exactly one of clip_id or file_id.`;
    if (s.clip_id !== undefined) {
      const clip = clips.get(s.clip_id);
      if (!clip) return `Error: unknown clip_id ${s.clip_id}.`;
      if (seen.has(s.clip_id)) return `Error: clip ${s.clip_id} is listed twice.`;
      seen.add(s.clip_id);
      if (s.start !== undefined || s.end !== undefined) return `Error: shots[${k}]: start/end are for file shots; a clip shot uses its own in/out points.`;
      if (isLocked(project, Number(clip.layer))) return `Error: clip ${clip.id} is on a locked track; unlock it first.`;
      const file = files.get(String(clip.file_id));
      if (!file || !isFootageFile(file)) return `Error: clip ${clip.id} shows no video or image to sequence.`;
      out.push({ clip, window: { file, start: Number(clip.start), end: Number(clip.end), still: isStill(file) }, ...speechOf(s) });
    } else {
      const file = files.get(s.file_id!);
      if (!file) return `Error: unknown file_id ${s.file_id}.`;
      if (!isFootageFile(file)) return `Error: ${fileLabel(file)} is not a video or image.`;
      const still = isStill(file);
      const duration = Number(file.duration) || 0;
      const start = s.start ?? 0;
      const end = s.end ?? (still ? start + STILL_SECONDS : duration);
      if (!(end > start)) return `Error: shots[${k}] (${fileLabel(file)}): end must be after start.`;
      if (!still && duration > 0 && end > duration + 1e-3) return `Error: shots[${k}] (${fileLabel(file)}): end ${end}s is past the file's ${round(duration)}s.`;
      out.push({ window: { file, start, end, still }, ...speechOf(s) });
    }
  }
  if (out.some((c) => c.clip) && out.some((c) => !c.clip)) return "Error: give all clip shots or all file shots, not a mix.";
  return out;
}

function speechOf(s: z.output<typeof shotSchema>): { says?: string; speechVoice?: number } {
  return { ...(s.says !== undefined ? { says: s.says } : {}), ...(s.speech_at !== undefined ? { speechVoice: s.speech_at } : {}) };
}

function indexOf(cands: readonly Candidate[], id: string): number {
  return cands.findIndex((c) => idOf(c) === id || String(c.window.file.id) === id);
}

/** Fewer files than this have no order worth searching for. */
const AUTO_MIN_FILES = 4;

/**
 * Whether `ids` are the bin's own order (every id once, in project.files
 * order): what a caller passes when nobody chose an order, like the import
 * receipt's list. The genre tools sequence such a list themselves.
 */
export function inBinOrder(project: Project, ids: readonly string[]): boolean {
  if (ids.length < AUTO_MIN_FILES || new Set(ids).size !== ids.length) return false;
  const at = new Map(project.files.map((f, i) => [String(f.id), i]));
  return ids.every((id, k) => k === 0 || (at.get(id) ?? -1) > (at.get(ids[k - 1]!) ?? -1));
}

/**
 * Whole bin files in sequence_shots_tool's order (continuity, `goal`'s arc,
 * the strongest last), with the receipt note that says so; or the warning
 * the caller keeps its order with (the frames cannot be read), null where
 * this surface reads no frames at all.
 */
export async function sequenceFiles(call: ToolCall, ids: readonly string[], goal: SequenceGoal, keepFlag: string): Promise<{ ids: string[]; note: string } | { warning: string } | null> {
  const project = call.doc.project;
  if (!call.host.frames) return null;
  const unordered = (why: string) => ({ warning: `The files are in bin order and could not be ordered (${why}): order them with sequence_shots_tool, or pass ${keepFlag}: true.` });
  const fps = fpsFloat(project.fps);
  const shots: SequenceShotInput[] = [];
  for (const id of ids) {
    const file = project.files.find((f) => String(f.id) === id);
    if (!file) return unordered(`unknown file ${id}`);
    const still = isStill(file);
    const end = still ? STILL_SECONDS : Number(file.duration) || 0;
    if (!(end > 0)) return unordered(`${fileLabel(file)} has no length`);
    const frames = await shotFrames(call, { file, start: 0, end, still }, fps);
    if (typeof frames === "string") return unordered(frames.replace(/^Error: /, ""));
    shots.push({ features: shotFeatures(frames), seconds: end, ...(still ? { still: true } : {}) });
  }
  const plan = planSequence(shots, goal);
  const out = plan.order.map((k) => ids[k]!);
  return {
    ids: out,
    note: `The files were in bin order: ordered by continuity first (sequence_shots_tool's planner; mean cut match ${plan.meanMatch} vs ${plan.givenMatch} in bin order). Pass ${keepFlag}: true to keep the order given.`,
  };
}

export const sequenceTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Sequence shots",
    description:
      "Order (and trim to slots) candidate shots the way an editor cuts them, instead of bin order: each cut carries something across (the action continues, the same shape and position, the subject where the eye already is, the colour, the motion's direction), " +
      "an energy arc (peak: build, peak, release), no near-duplicate back to back, the strongest shot held for the payoff, and speaker shots on their own words in the voice-over (speech_at, or says + a transcribed voice_file_id). " +
      "Reorders timeline clips in place (shots of clip_ids, or every clip on a track) or lays bin files / windows on a track; dry_run returns the order only (data.file_ids for match_cut_montage_tool / build_reel_tool). " +
      "One undo step; data.cuts says why each cut joins (match 0-1, reasons) and how the order compares with the given one.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["frames"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const resolved = resolve(project, args);
      if (typeof resolved === "string") return refused(TOOL, resolved);
      const cands = resolved as (Candidate & { says?: string; speechVoice?: number })[];
      const n = cands.length;
      const clipShots = cands[0]!.clip !== undefined;
      if (args.slots && args.slots.length > n) return refused(TOOL, `Error: ${args.slots.length} slots but only ${n} shots.`);
      const open = args.open !== undefined ? indexOf(cands, args.open) : undefined;
      if (open === -1) return refused(TOOL, `Error: open names ${args.open}, which is not one of the shots.`);
      let close: number | null | undefined;
      if (args.close === "none") close = null;
      else if (args.close !== undefined) {
        close = indexOf(cands, args.close);
        if (close === -1) return refused(TOOL, `Error: close names ${args.close}, which is not one of the shots.`);
        if (close === open) return refused(TOOL, "Error: open and close name the same shot.");
      }
      const fps = fpsFloat(project.fps);
      const position = clipShots ? Math.min(...cands.map((c) => Number(c.clip!.position))) : (args.position ?? 0);

      // Voice sync: where each speaker shot's words are on the timeline.
      const voiceSynced = cands.some((c) => c.says !== undefined || c.speechVoice !== undefined);
      let voice: ProjectFile | undefined;
      if (args.voice_file_id !== undefined) {
        voice = project.files.find((f) => String(f.id) === args.voice_file_id);
        if (!voice) return refused(TOOL, `Error: unknown voice_file_id ${args.voice_file_id}.`);
        if (voice.has_audio === false) return refused(TOOL, `Error: ${fileLabel(voice)} has no audio.`);
      } else if (voiceSynced) return refused(TOOL, "Error: speech_at and says sync shots to a voice: give voice_file_id.");
      let voiceAt = args.voice_at;
      if (voice && voiceAt === undefined) {
        const playing = project.clips.filter((c) => String(c.file_id) === String(voice!.id)).sort((a, b) => Number(a.position) - Number(b.position))[0];
        voiceAt = playing ? Number(playing.position) - Number(playing.start) : position;
      }
      if (voice) {
        const words = storedTranscript(voice)?.words ?? [];
        const missing: string[] = [];
        for (const c of cands) {
          if (c.speechVoice !== undefined) c.sync = { voice_seconds: c.speechVoice, from: "speech_at" };
          else if (c.says !== undefined) {
            if (words.length === 0) return refused(TOOL, `Error: says needs the voice's words: run transcribe_media_tool on ${String(voice.id)} first, or give speech_at.`);
            const found = findSpoken(words, c.says);
            if (found) c.sync = { voice_seconds: found.start, from: "says", score: found.score };
            else missing.push(idOf(c));
          } else if (String(c.window.file.id) === String(voice.id)) c.sync = { voice_seconds: c.window.start, from: "own audio" };
          if (c.sync) c.speechAt = voiceAt! + c.sync.voice_seconds - position;
        }
        if (missing.length) call.host.log?.(`${TOOL}: no match for says of ${missing.join(", ")}`);
      }

      if (args.slots) {
        // Pinned shots are never left out, so each needs a slot of its own.
        const pinned = new Set([...(open !== undefined ? [open] : []), ...(typeof close === "number" ? [close] : []), ...cands.flatMap((c, k) => (c.speechAt !== undefined ? [k] : []))]);
        if (pinned.size > args.slots.length) return refused(TOOL, `Error: ${pinned.size} shots must stay (open, close, voice-synced) but there are only ${args.slots.length} slots: give more slots or pin fewer shots.`);
      }

      const shots: SequenceShotInput[] = [];
      for (const c of cands) {
        const frames = await shotFrames(call, c.window, fps);
        if (typeof frames === "string") return failed(TOOL, frames);
        if (call.signal?.aborted) return failed(TOOL, "Error: cancelled.");
        shots.push({
          features: shotFeatures(frames),
          seconds: c.window.end - c.window.start,
          ...(c.window.still ? { still: true } : {}),
          source: { key: String(c.window.file.id), start: c.window.start, end: c.window.end },
          ...(c.speechAt !== undefined ? { speechAt: c.speechAt } : {}),
        });
      }
      const goal: SequenceGoal = {
        ...(args.arc ? { arc: args.arc } : {}),
        ...(open !== undefined ? { open } : {}),
        ...(close !== undefined ? { close } : {}),
        ...(args.slots ? { slots: args.slots } : {}),
        ...(args.continuity !== undefined ? { continuity: args.continuity } : {}),
      };
      const plan = planSequence(shots, goal);
      const short = plan.order.filter((s, k) => !shots[s]!.still && shots[s]!.seconds + 1e-3 < plan.lengths[k]!);
      if (short.length) {
        return refused(TOOL, `Error: ${short.map((s) => idOf(cands[s]!)).join(", ")} ${short.length === 1 ? "is" : "are"} shorter than ${short.length === 1 ? "its slot" : "their slots"}: give longer windows, more shots, or shorter slots.`);
      }

      // Frame-exact placement: lengths in whole frames, starts their running sum.
      const frames = plan.lengths.map((len) => Math.max(1, Math.round(len * fps)));
      const startFrame = Math.round(position * fps);
      let acc = startFrame;
      const placed = plan.order.map((s, k) => {
        const c = cands[s]!;
        const at = acc / fps;
        acc += frames[k]!;
        const srcEnd = c.window.still ? c.window.start + frames[k]! / fps : Math.min(c.window.end, c.window.start + frames[k]! / fps);
        return { c, s, k, at, srcEnd };
      });
      const rows = placed.map(({ c, s, k, at, srcEnd }) => ({
        id: idOf(c),
        file_id: String(c.window.file.id),
        name: fileLabel(c.window.file),
        at: round(at),
        seconds: round(frames[k]! / fps),
        source_in: round(c.window.start),
        source_out: round(srcEnd),
        role: k === 0 ? "open" : plan.close && s === plan.close.index ? "close" : "body",
        energy: plan.energy[s],
        strength: plan.strength[s],
        ...(c.sync ? { sync: { ...c.sync, voice_seconds: round(c.sync.voice_seconds) } } : {}),
      }));
      const cuts = plan.cuts.map((cut, k) => ({ at: rows[k + 1]!.at, from: idOf(cands[cut.from]!), to: idOf(cands[cut.to]!), match: cut.match, reasons: cut.reasons }));
      const warnings: string[] = [];
      for (const off of plan.offSpeech) warnings.push(`${idOf(cands[off.index]!)} starts ${off.seconds > 0 ? "late" : "early"} on its words by ${Math.abs(off.seconds)} s: the shots before it are ${off.seconds > 0 ? "too long" : "too short"} for the voice (add or trim shots, or slots).`);
      const unsynced = cands.filter((c) => (c.says !== undefined) && !c.sync).map(idOf);
      if (unsynced.length) warnings.push(`No line in the voice matches says of ${unsynced.join(", ")}: placed by continuity only.`);
      const data = {
        order: rows,
        file_ids: rows.map((r) => r.file_id),
        cuts,
        dropped: plan.dropped.map((d) => ({ id: idOf(cands[d.index]!), why: d.why })),
        arc: plan.arc,
        close: plan.close ? { id: idOf(cands[plan.close.index]!), why: plan.close.why } : null,
        mean_match: plan.meanMatch,
        given_order_match: plan.givenMatch,
        duration: round((acc - startFrame) / fps),
        // Where a whoosh/hit/click belongs (auto_sound_design_tool, add_sfx_tool).
        sfx_cues: cuts.map((c) => ({ time: c.at, kind: "cut" })),
      };
      const names = rows.map((r) => r.name);
      const summary =
        `Sequenced ${rows.length} shot(s): ${names.slice(0, 12).join(" → ")}${names.length > 12 ? " → …" : ""}; mean cut match ${plan.meanMatch} (given order ${plan.givenMatch}), arc ${plan.arc}` +
        (plan.close ? `, ${rows[rows.length - 1]!.name} closes (${plan.close.why})` : "") +
        (plan.dropped.length ? `, ${plan.dropped.length} left out` : "") +
        (cands.some((c) => c.sync) ? `, ${cands.filter((c) => c.sync).length} voice-synced` : "") +
        ".";
      if (args.dry_run) return unchanged(TOOL, `Planned (dry run, nothing changed): ${summary.slice(0, 1).toLowerCase()}${summary.slice(1)}`, { warnings, data });

      if (clipShots) {
        const same = placed.every(({ c, at, srcEnd }) => Math.abs(Number(c.clip!.position) - at) < 1e-6 && Math.abs(Number(c.clip!.end) - srcEnd) < 1e-6) && plan.dropped.length === 0;
        if (same) return unchanged(TOOL, `The clips are already in this order and length: ${summary}`, { warnings, data });
        // Back to back from the first one can land a listed clip on one that was not listed (a subset of a track).
        const moving = new Set(cands.map((c) => String(c.clip!.id)));
        const blocking = placed.flatMap(({ c, at, srcEnd }) => {
          const end = at + srcEnd - c.window.start;
          return project.clips.filter((o) => !moving.has(String(o.id)) && Number(o.layer) === Number(c.clip!.layer) && Number(o.position) < end - 1e-6 && Number(o.position) + Number(o.end) - Number(o.start) > at + 1e-6);
        });
        if (blocking.length) {
          const ids = [...new Set(blocking.map((o) => String(o.id)))];
          return refused(TOOL, `Error: the sequence would cover clip(s) ${ids.join(", ")}, which are not among the shots: list them too, sequence the whole track, or move them first.`);
        }
        call.commit((tx) => {
          for (const { c, at, srcEnd } of placed) setClipTiming(tx, String(c.clip!.id), { position: at, end: srcEnd });
          if (plan.dropped.length) deleteClips(tx, plan.dropped.map((d) => String(cands[d.index]!.clip!.id)), { ripple: false });
        }, "Sequence shots");
        return applied(TOOL, summary, { warnings, data });
      }

      let layer = args.track ?? emptyTrack(project);
      if (layer !== null) {
        if (!project.layers.some((l) => Number(l.number) === layer)) return refused(TOOL, `Error: no track ${layer}.`);
        if (isLocked(project, layer)) return refused(TOOL, `Error: track ${layer} is locked.`);
        const end = acc / fps;
        const blocking = project.clips.filter((c) => Number(c.layer) === layer && Number(c.position) < end - 1e-6 && Number(c.position) + Number(c.end) - Number(c.start) > position + 1e-6);
        if (blocking.length) return refused(TOOL, `Error: track ${layer} has ${blocking.length} clip(s) between ${round(position)} s and ${round(end)} s; pick an empty track or another position.`);
      }
      const added = call.commit((tx) => {
        if (layer === null) layer = Number(addTrack(tx, {}).number);
        return placed.map(({ c, at, srcEnd }) => addClip(tx, { fileId: String(c.window.file.id), position: at, layer: layer!, start: c.window.start, end: srcEnd }));
      }, "Sequence shots");
      return applied(TOOL, summary, { warnings, data: { ...data, track: layer, clip_ids: added.map((c) => String(c.id)) } });
    },
  }),
];
