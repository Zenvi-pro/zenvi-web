/**
 * fill_to_length_tool: an edit that comes out shorter than the asked length
 * is filled instead of shipped short. Round 7 re-edits: 25.3 s of a 30 s
 * fitness reel, 14.5 s of a 30 s VFX breakdown, a match cut with "no longer
 * final hold"; the agents knew and had no tool for it.
 *
 * In order, until the picture reaches the length:
 *
 *   hold   the last shot runs on into its unused media (a longer final hold);
 *   broll  shots appended after it, the track's median shot length each (in
 *          whole beats when the music's beat is known): bin footage not on
 *          the timeline first, then moments of the timeline's own files that
 *          are not shown yet;
 *   slow   the last new shot, or else the track's last few shots, slowed (not
 *          below max_slow);
 *   repeat the last resort: the track's shots again, the earliest first.
 *
 * Everything is appended at the end, so no cut, title or sound already placed
 * moves. A title or card that ended with the picture moves to the new end
 * (an overlay over more of the edit, a grain or a watermark, runs on to it);
 * music that stops early runs on into its file, or repeats its last phrase on
 * a bar line (as build_reel_tool does). One undo step.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import { ScaleMode, type Clip, type Project, type ProjectFile } from "../../model/types.js";
import { addClip, fadeClip, retimeClipTo, setClipProperty, setClipTiming } from "../../ops/clips.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { isMuted, mixEntries } from "../mix-roles.js";
import { applied, refused, unchanged } from "../receipt.js";
import { isRetimed } from "../speech.js";
import { fileById } from "./common.js";
import { aspectOf, displayName, usableRange, visualKind } from "./reels.js";
import { ToolError, clipTitle, gridOf, r3, resolveLayer } from "./timeline-edit-common.js";

const TOOL = "fill_to_length_tool";
const STEPS = ["hold", "broll", "slow", "repeat"] as const;
type Step = (typeof STEPS)[number];
/** The last shot holds at most this much longer by running on into its media. */
const MAX_HOLD = 3;
/** Appended shots are at least this long. */
const MIN_SHOT = 0.8;
/** The slow step slows at most this many of the track's last shots. */
const SLOW_SHOTS = 4;
/** Bars of music repeated at a time when it has to loop. */
const LOOP_BARS = 4;

const input = z.strictObject({
  seconds: z.number().min(1).max(3600).describe("The length the edit should run, seconds (e.g. the brief's length)."),
  track: z.string().optional().describe("The picture track to extend (UI track number, name or layer number). Default: the track with the most video clips."),
  steps: z
    .array(z.enum(STEPS))
    .min(1)
    .max(4)
    .optional()
    .describe("Which fills to use, tried in this order: hold (the last shot runs on into its media, up to 3 s), broll (new shots after it from unused footage), slow (the last new shot, or the track's last few shots, slowed, not below max_slow), repeat (the track's shots again, earliest first: the last resort). Default all four."),
  file_ids: z.array(z.string().min(1)).max(100).optional().describe("Footage the broll step may use, in order. Default: bin videos and photos not on the timeline, then unseen moments of the timeline's own files."),
  max_slow: z.number().min(0.25).max(1).optional().describe("Slowest speed the slow step plays a shot at (default 0.75)."),
  dry_run: z.boolean().optional().describe("true: only say what would be added (nothing changes)."),
});

type Input = z.infer<typeof input>;

const lengthOf = (c: Clip) => c.end - c.start;
const endOf = (c: Clip) => c.position + lengthOf(c);

/** The picture track: the one with the most video clips (ties: the topmost). */
function pictureLayer(project: Project): number | null {
  const counts = new Map<number, number>();
  for (const c of project.clips) {
    const file = fileById(project, String(c.file_id ?? ""));
    if (file && visualKind(file) === "video") counts.set(c.layer, (counts.get(c.layer) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
}

/** Source ranges of `fileId` already on the timeline. */
function shownRanges(project: Project, fileId: string): [number, number][] {
  return project.clips.filter((c) => String(c.file_id) === fileId && !isRetimed(c as unknown as Record<string, unknown>)).map((c) => [c.start, c.end] as [number, number]);
}

/** The first stretch of `seconds` in [from, to] that overlaps none of `shown`, or null. */
function unseen(from: number, to: number, seconds: number, shown: readonly [number, number][]): number | null {
  const starts = [from, ...shown.map(([, b]) => b)].filter((s) => s >= from - 1e-6).sort((a, b) => a - b);
  for (const s of starts) if (s + seconds <= to + 1e-6 && shown.every(([a, b]) => s + seconds <= a + 1e-6 || s >= b - 1e-6)) return s;
  return null;
}

interface Plan {
  hold: number;
  /** New shots: unused footage, or with `repeat` a shot shown earlier again. */
  shots: { fileId: string; kind: "video" | "image"; start: number; end: number; repeat?: boolean }[];
  /** The speed, and the track's own clips it applies to (none: the last new shot). */
  slow: { speed: number; clipIds: string[] } | null;
  short: number;
}

function planFill(project: Project, track: readonly Clip[], last: Clip, missing: number, steps: ReadonlySet<Step>, candidates: ProjectFile[], shotLength: number, maxSlow: number, frame: number): Plan {
  let left = missing;
  const plan: Plan = { hold: 0, shots: [], slow: null, short: 0 };
  const lastFile = fileById(project, String(last.file_id ?? ""));
  const retimed = isRetimed(last as unknown as Record<string, unknown>);
  const used = new Map<string, [number, number][]>(candidates.map((f) => [String(f.id), shownRanges(project, String(f.id))]));
  if (steps.has("hold") && lastFile && !retimed) {
    const room = visualKind(lastFile) === "image" ? MAX_HOLD : Math.max(0, usableRange(lastFile)[1] - last.end);
    plan.hold = Math.min(left, room, MAX_HOLD);
    // A hold of a frame or so is no hold.
    if (plan.hold < 2 * frame) plan.hold = 0;
    left -= plan.hold;
    used.get(String(lastFile.id))?.push([last.end, last.end + plan.hold]);
  }
  if (steps.has("broll") && left > frame) {
    for (let guard = 0; left > frame && guard < 200; guard += 1) {
      // The last shot may run long rather than leave a sliver.
      const want = left < shotLength + MIN_SHOT ? left : shotLength;
      let placed = false;
      for (const file of candidates) {
        const id = String(file.id);
        const kind = visualKind(file)!;
        if (kind === "image") {
          if (used.get(id)!.length > 0) continue;
          plan.shots.push({ fileId: id, kind, start: 0, end: want });
          used.get(id)!.push([0, want]);
        } else {
          const [a, b] = usableRange(file);
          const s = unseen(a, b, want, used.get(id)!);
          if (s === null) continue;
          plan.shots.push({ fileId: id, kind, start: s, end: s + want });
          used.get(id)!.push([s, s + want]);
        }
        // Rotate: the next shot tries the next file first.
        candidates.push(...candidates.splice(0, candidates.indexOf(file) + 1));
        left -= want;
        placed = true;
        break;
      }
      if (!placed) break;
    }
  }
  if (steps.has("slow") && left > frame && plan.shots.length > 0) {
    // The last new shot plays slower.
    const base = plan.shots[plan.shots.length - 1]!.end - plan.shots[plan.shots.length - 1]!.start;
    plan.slow = { speed: Math.max(maxSlow, base / (base + left)), clipIds: [] };
    left -= base / plan.slow.speed - base;
  } else if (steps.has("slow") && left > frame) {
    // No new shot: the last few shots on the track play slower, as few as cover the rest.
    const tail: Clip[] = [];
    let base = 0;
    for (const c of [...track].reverse()) {
      if (tail.length >= SLOW_SHOTS || isRetimed(c as unknown as Record<string, unknown>) || base * (1 / maxSlow - 1) >= left) break;
      tail.unshift(c);
      base += lengthOf(c) + (c.id === last.id ? plan.hold : 0);
    }
    if (tail.length > 0) {
      plan.slow = { speed: Math.max(maxSlow, base / (base + left)), clipIds: tail.map((c) => c.id) };
      left -= base / plan.slow.speed - base;
    }
  }
  if (steps.has("repeat") && left > frame) {
    // Last resort: the track's shots again, the earliest (longest ago) first.
    const again = track.filter((c) => !isRetimed(c as unknown as Record<string, unknown>) && lengthOf(c) >= MIN_SHOT);
    for (let i = 0; left > frame && again.length > 0 && i < 200; i += 1) {
      const c = again[i % again.length]!;
      const want = Math.min(lengthOf(c), left < shotLength + MIN_SHOT ? left : shotLength);
      const kind = visualKind(fileById(project, String(c.file_id ?? ""))!) ?? "video";
      plan.shots.push({ fileId: String(c.file_id), kind, start: c.start, end: c.start + want, repeat: true });
      left -= want;
    }
  }
  plan.short = Math.max(0, left);
  return plan;
}

/** Music clips that stop before the new end: runs on into the file, or repeats its last phrase on bar lines. */
async function musicToExtend(call: ToolCall, oldEnd: number, newEnd: number, frame: number): Promise<{ clip: Clip; extendTo?: number; loop?: { cutAt: number; from: number; to: number } }[]> {
  const project = call.doc.project;
  const out: { clip: Clip; extendTo?: number; loop?: { cutAt: number; from: number; to: number } }[] = [];
  for (const e of mixEntries(project)) {
    const clip = e.clip;
    const file = e.file;
    if (e.mixRole !== "music" || isMuted(e) || !file || !isAudioOnlyMedia(file) || isRetimed(clip as unknown as Record<string, unknown>)) continue;
    const end = endOf(clip);
    // The bed: it played to the old end (or past it), not a sting that ended long before.
    if (end < oldEnd - 1 || end >= newEnd - frame) continue;
    const needed = newEnd - end;
    const room = (Number(file.duration) || 0) - clip.end;
    if (room >= needed - frame) {
      out.push({ clip, extendTo: clip.end + needed });
      continue;
    }
    if (!canTrackBeats(call)) continue;
    const beats = await beatsOfFile(call, file);
    if (typeof beats === "string" || beats.downbeats.length < 2) continue;
    const downs = beats.downbeats.map((d) => d.timeSec).filter((t) => t > clip.start + frame && t <= clip.end + frame);
    if (downs.length < 2) continue;
    const cutAt = downs[downs.length - 1]!;
    const bars = Math.min(LOOP_BARS, downs.length - 1);
    out.push({ clip, loop: { cutAt, from: downs[downs.length - 1 - bars]!, to: cutAt } });
  }
  return out;
}

export const fillLengthTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Fill to length",
    description:
      "Make an edit that runs short reach the asked length instead of shipping short: the last shot holds longer into its unused media (up to 3 s), then new shots go after it from unused footage (bin files not on the timeline, then unseen moments of the timeline's own files; " +
      "each the track's median shot length, in whole beats when the music's beat is known), then the last shots slow (not below max_slow), and as a last resort earlier shots repeat (named in a warning). Everything is added at the end, so no cut, title or sound already placed moves (slowed tail shots excepted); " +
      "a title or card that ended with the picture moves to the new end (an overlay over more of the edit runs on to it), added shots are muted under music, and music that stops early runs on into its file or repeats its last 4 bars on a bar line. dry_run=true only proposes. One undo step; the receipt lists what was added and anything still short.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const g = gridOf(project);
      let layer: number | null;
      try {
        layer = args.track !== undefined ? resolveLayer(project, args.track) : pictureLayer(project);
      } catch (error) {
        if (error instanceof ToolError) return refused(TOOL, `Error: ${error.message}`);
        throw error;
      }
      if (layer === null) return refused(TOOL, "Error: no video on the timeline to extend: build the edit first.");
      const track = project.clips.filter((c) => c.layer === layer && !isAudioOnlyMedia(fileById(project, String(c.file_id ?? "")))).sort((a, b) => a.position - b.position);
      if (track.length === 0) return refused(TOOL, `Error: track ${args.track ?? layer} has no picture clips.`);
      const last = track.reduce((a, b) => (endOf(b) > endOf(a) ? b : a));
      const oldEnd = endOf(last);
      const missing = g.snap(args.seconds) - oldEnd;
      if (missing <= g.tol) return unchanged(TOOL, `The picture already runs ${r3(oldEnd)} s, at least the ${args.seconds} s asked.`, { data: { length: r3(oldEnd) } });
      for (const id of args.file_ids ?? []) {
        const f = fileById(project, id);
        if (!f) return refused(TOOL, `Error: Unknown file_id '${id}'.`);
        if (!visualKind(f)) return refused(TOOL, `Error: ${id} is not a video or a photo.`);
      }

      // B-roll candidates: as given, else bin footage not on the timeline, then the timeline's own files.
      const onTimeline = new Set(project.clips.map((c) => String(c.file_id)));
      const visual = project.files.filter((f) => visualKind(f) !== null && !/\.svg$/i.test(String(f.path ?? "")));
      const candidates = args.file_ids
        ? args.file_ids.map((id) => fileById(project, id)!)
        : [...visual.filter((f) => !onTimeline.has(String(f.id))), ...track.map((c) => fileById(project, String(c.file_id ?? ""))!).filter((f, i, all) => f && visualKind(f) === "video" && all.indexOf(f) === i)];
      // Shot length: the track's median, in whole beats of the music when that is known.
      const lengths = track.map(lengthOf).sort((a, b) => a - b);
      let shotLength = Math.max(MIN_SHOT, lengths[Math.floor(lengths.length / 2)]!);
      const music = await musicToExtend(call, oldEnd, oldEnd + missing, g.frame);
      const bpmClip = music[0]?.clip;
      let beat: number | null = null;
      if (bpmClip && canTrackBeats(call)) {
        const file = fileById(project, String(bpmClip.file_id ?? ""));
        const tracked = file ? await beatsOfFile(call, file) : null;
        if (tracked && typeof tracked !== "string" && tracked.bpm > 0) beat = 60 / tracked.bpm;
      }
      if (beat) shotLength = Math.max(1, Math.round(shotLength / beat)) * beat;
      shotLength = g.snap(shotLength);

      const steps = new Set<Step>(args.steps ?? STEPS);
      const plan = planFill(project, track, last, missing, steps, candidates, shotLength, args.max_slow ?? 0.75, g.frame);
      const newEnd = oldEnd + missing - plan.short;
      const fresh = plan.shots.filter((s) => !s.repeat);
      const repeats = plan.shots.filter((s) => s.repeat);
      const ending = project.clips.filter((c) => c.layer !== layer && Math.abs(endOf(c) - oldEnd) <= g.tol && !isAudioOnlyMedia(fileById(project, String(c.file_id ?? ""))));
      // An end card (it starts with the last shot or later) moves to the new end; an overlay over more of the
      // edit (grain, a watermark, a caption bar) runs on to it where its media allows, rather than slide off its start.
      const cards = ending.filter((c) => c.position >= last.position - g.tol);
      const overlays = ending.filter((c) => {
        if (c.position >= last.position - g.tol || isRetimed(c as unknown as Record<string, unknown>)) return false;
        const file = fileById(project, String(c.file_id ?? ""));
        return !file || visualKind(file) !== "video" || (Number(file.duration) || 0) - c.end >= newEnd - oldEnd - g.tol;
      });
      // Shots you hear under the music are muted (as the builders place them); without music they keep their sound.
      const underMusic = mixEntries(project).some((e) => e.mixRole === "music" && !isMuted(e));
      const summary = [
        plan.hold > 0 ? `held the last shot ${r3(plan.hold)} s longer` : "",
        fresh.length > 0 ? `added ${fresh.length} shot(s) of ${r3(shotLength)} s${beat ? " (whole beats)" : ""} from ${[...new Set(fresh.map((s) => displayName(fileById(project, s.fileId)!)))].join(", ")}` : "",
        plan.slow !== null ? `slowed the last ${plan.slow.clipIds.length > 1 ? `${plan.slow.clipIds.length} shots` : "shot"} to ${Math.round(plan.slow.speed * 100)} %` : "",
        repeats.length > 0 ? `repeated ${repeats.length} earlier shot(s)` : "",
      ].filter(Boolean);
      const warnings: string[] = [];
      if (repeats.length > 0) warnings.push(`${repeats.length} shot(s) at the end repeat earlier footage: import more (gather_stock_footage_tool) and swap them (swap_shot_tool) for a stronger edit.`);
      if (plan.short > g.tol) warnings.push(`Still ${r3(plan.short)} s short: no footage left to fill with. Import more (gather_stock_footage_tool) or allow a slower max_slow.`);
      for (const m of music) if (m.loop) warnings.push(`${clipTitle(m.clip)} runs out: its last ${LOOP_BARS} bar(s) from ${r3(m.loop.from)} s repeat on a bar line.`);
      const musicStops = mixEntries(project).filter((e) => e.mixRole === "music" && !isMuted(e) && endOf(e.clip) >= oldEnd - 1 && endOf(e.clip) < newEnd - g.frame && !music.some((m) => m.clip.id === e.clip.id));
      for (const e of musicStops) warnings.push(`${clipTitle(e.clip)} stops at ${r3(endOf(e.clip))} s, before the new end: extend or replace it.`);
      for (const c of ending) if (!cards.includes(c) && !overlays.includes(c)) warnings.push(`${clipTitle(c)} ends at the old end, ${r3(oldEnd)} s: its media cannot run on to the new end.`);
      const data = {
        from_seconds: r3(oldEnd),
        to_seconds: r3(newEnd),
        hold_seconds: r3(plan.hold),
        shots: plan.shots.map((s) => ({ file_id: s.fileId, start: r3(s.start), end: r3(s.end), ...(s.repeat ? { repeat: true } : {}) })),
        ...(plan.slow !== null ? { slow: r3(plan.slow.speed), slowed_clip_ids: plan.slow.clipIds } : {}),
        short_seconds: r3(plan.short),
        moved_cards: cards.map((c) => c.id),
        ...(overlays.length > 0 ? { extended_overlays: overlays.map((c) => c.id) } : {}),
        music: music.map((m) => ({ clip_id: m.clip.id, ...(m.extendTo !== undefined ? { runs_on: true } : { loops_from: r3(m.loop!.from) }) })),
      };
      if (summary.length === 0) return refused(TOOL, `Error: nothing to fill ${r3(missing)} s with: ${warnings[0] ?? "the last shot has no media left and no footage is free"}.`);
      const text = `${args.dry_run ? "Would fill" : "Filled"} ${r3(oldEnd)} s to ${r3(newEnd)} s: ${summary.join("; ")}.`;
      if (args.dry_run) return applied(TOOL, `${text} (dry run, nothing changed)`, { warnings, data }, 0);

      const created: string[] = [];
      call.commit((tx) => {
        let cursor = oldEnd;
        if (plan.hold > 0) {
          setClipTiming(tx, last.id, { end: last.end + plan.hold });
          cursor += plan.hold;
        }
        let tail: Clip = tx.project.clips.find((c) => c.id === last.id)!;
        const append = (s: Plan["shots"][number]) => {
          const file = fileById(tx.project, s.fileId)!;
          tail = addClip(tx, { fileId: s.fileId, position: cursor, layer: layer!, start: s.start, end: s.end });
          if (aspectOf(file) !== null) setClipProperty(tx, tail.id, "scale", ScaleMode.CROP);
          if (file.has_audio && underMusic) setClipProperty(tx, tail.id, "volume", 0);
          created.push(tail.id);
          cursor += s.end - s.start;
        };
        // Unused footage, then the slow step (on the last new shot, or the track's last shots), then repeats.
        for (const s of plan.shots) if (!s.repeat) append(s);
        if (plan.slow !== null && plan.slow.clipIds.length === 0) {
          const length = lengthOf(tail) / plan.slow.speed;
          retimeClipTo(tx, tail.id, { duration: length });
          cursor = tail.position + length;
        } else if (plan.slow !== null) {
          // Each slowed shot starts later by what the ones before it grew; the last moves first, into free room.
          const speed = plan.slow.speed;
          const slowed = plan.slow.clipIds.map((id) => tx.project.clips.find((c) => c.id === id)!);
          let shift = 0;
          const placed = slowed.map((c) => {
            const row = { id: c.id, position: c.position + shift, duration: lengthOf(c) / speed };
            shift += row.duration - lengthOf(c);
            return row;
          });
          for (const row of [...placed].reverse()) retimeClipTo(tx, row.id, { duration: row.duration, position: row.position });
          cursor = placed[placed.length - 1]!.position + placed[placed.length - 1]!.duration;
        }
        for (const s of plan.shots) if (s.repeat) append(s);
        for (const c of cards) setClipTiming(tx, c.id, { position: c.position + (cursor - oldEnd) });
        for (const c of overlays) setClipTiming(tx, c.id, { end: c.end + (cursor - oldEnd) });
        for (const m of music) placeMoreMusic(tx, m, cursor, created);
      }, "Fill to length");
      return applied(TOOL, text, { warnings, data: { ...data, createdClipIds: created } });
    },
  }),
];

/** Music on to `end`: the clip runs on into its file, or stops on its last bar line and its last bars repeat after it. */
function placeMoreMusic(tx: Transaction, m: { clip: Clip; extendTo?: number; loop?: { cutAt: number; from: number; to: number } }, end: number, created: string[]): void {
  if (m.extendTo !== undefined) {
    setClipTiming(tx, m.clip.id, { end: m.clip.start + (end - m.clip.position) });
    fadeClip(tx, m.clip.id, { fadeOut: Math.min(1.2, (end - m.clip.position) / 4), video: false, audio: true });
    return;
  }
  const loop = m.loop!;
  setClipTiming(tx, m.clip.id, { end: loop.cutAt });
  let at = m.clip.position + loop.cutAt - m.clip.start;
  let piece: Clip | null = null;
  for (let guard = 0; at < end - 1e-3 && guard < 100; guard += 1) {
    const length = Math.min(loop.to - loop.from, end - at);
    piece = addClip(tx, { fileId: String(m.clip.file_id), position: at, layer: m.clip.layer, start: loop.from, end: loop.from + length, ...(m.clip.title ? { title: String(m.clip.title) } : {}) });
    created.push(piece.id);
    at += length;
  }
  if (piece) fadeClip(tx, piece.id, { fadeOut: Math.min(1.2, lengthOf(piece) / 2), video: false, audio: true });
}
