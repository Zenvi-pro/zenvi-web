/**
 * review_edit_tool: watch the cut. One contact sheet of the edit at its cut
 * points (the last frame before and the first frame after each cut, plus
 * frames from the middle of longer shots) and the numbers a person feels
 * while watching: shot lengths, cuts per second, cuts against the music's
 * beats and hits, holds, black and empty frames, flashes, text, loudness,
 * silence, and a ranked list of problems with timestamps. With a saved
 * creative brief, also the edit against it (brief/check.ts): beats, borrowed
 * techniques and the style's checklist to look for on the sheet.
 *
 * Reads the project and renders; changes nothing, records no undo step.
 * review/ holds the rules; this tool gathers what the host can measure.
 */

import { z } from "zod";
import { readBrief } from "../../brief/brief.js";
import { checkBrief, type BriefCheck } from "../../brief/check.js";
import { BEAT_SAMPLE_RATE, detectBeats } from "../../analysis/beats.js";
import { evaluate, getCount } from "../../keyframe/evaluate.js";
import type { Keyframe, Project } from "../../model/types.js";
import { timelineEnd } from "../../timeline/queries.js";
import { frameContaining } from "../../timeline/time.js";
import { frameWindow, localFrame, windowContains } from "../../timeline/windows.js";
import { alignCuts, findProblems, flashAndBlack, tileMark, BLACK_LUMA, BLACK_PEAK, FLASH_LUMA, type SampledFrame } from "../../review/problems.js";
import { DEFAULT_SHEET_PIXELS, MAX_SHEET_PIXELS, planSheet, sheetLayout } from "../../review/sheet.js";
import { titleTextBoxes } from "../../review/text-boxes.js";
import { swapSuggestions } from "../../review/swaps.js";
import { reviewTimeline } from "../../review/timeline.js";
import type { BeatAlignment, MixReview, ReviewProblem, ReviewShot, TextBox } from "../../review/types.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, refused } from "../receipt.js";
import type { ToolImage } from "../types.js";

const TOOL = "review_edit_tool";
/** Title SVGs read for the safe-area check, at most. */
const MAX_TITLE_FILES = 40;
/** Shot lengths are listed one by one up to this many shots. */
const MAX_LISTED_SHOTS = 40;
/** Fewest beats (or hits) in the mix before cuts are judged against them. */
const MIN_BEATS = 4;
/** What a Claude image costs per pixel, roughly. */
const PIXELS_PER_TOKEN = 750;

const input = z.strictObject({
  start: z.number().min(0).optional().describe("Start of the part to review, timeline seconds (default 0). Use start/end to zoom in on a stretch the first look flagged."),
  end: z.number().min(0).optional().describe("End of the part to review, timeline seconds (default: the end of the timeline)."),
  pace: z
    .enum(["fast", "medium", "slow"])
    .optional()
    .describe("The pace the edit is meant to have, which sets what counts as a slideshow: fast (default; reels, hype, flash cuts: no shot over 1.5 s), medium (b-roll, promos: 3.5 s), slow (talking head, documentary: 8 s)."),
  image: z.boolean().optional().describe("false returns the numbers and problems without rendering the contact sheet (default true)."),
  audio: z.boolean().optional().describe("false skips mixing the audio down to measure loudness, silence and cuts against the beat (default true; this is the slow part)."),
  max_tiles: z.number().int().min(4).max(48).optional().describe("Most frames on the sheet (default 24: about 11 cuts, each as the last frame before and first frame after). A longer edit is sampled evenly; review a range for the rest."),
  tile_width: z.number().int().min(64).max(640).optional().describe("Width of each frame in pixels, for a closer look at a short range (default: as large as keeps the sheet near 1,500 image tokens)."),
});

type Input = z.infer<typeof input>;

/** Beats and hits of the mix, as timeline seconds. */
function rhythmOf(call: ToolCall, mix: MixReview & { pcm: { sampleRate: number; samples: Float32Array } }, from: number, cuts: number[], fps: number): BeatAlignment | null {
  if (mix.lufs === null || cuts.length === 0) return null;
  try {
    const found = detectBeats(mix.pcm.samples, mix.pcm.sampleRate || BEAT_SAMPLE_RATE);
    // A few stray peaks are not a rhythm: a tracker will lay a grid over anything, so trust one only with enough beats.
    const grid = found.beats.length >= MIN_BEATS;
    if (!grid && found.onsets.length < MIN_BEATS) return null;
    return alignCuts(
      cuts,
      grid ? found.beats.map((b) => from + b.timeSec) : [],
      found.onsets.map((o) => from + o),
      grid ? found.bpm : 0,
      fps,
    );
  } catch (error) {
    call.host.log?.(`beat tracking of the mix failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The shot's clip fades at `seconds`: its opacity is animated and below 1 there (a fade from or to black). */
function fadingAt(project: Project, shot: ReviewShot | undefined, seconds: number): boolean {
  if (!shot) return false;
  const frame = frameContaining(seconds, project.fps);
  // A split shot is several clips of one file; the one on top under the playhead is the one fading.
  let top: { alpha: Keyframe | undefined; local: number; layer: number } | undefined;
  for (const clip of project.clips) {
    if (String(clip.file_id) !== shot.fileId) continue;
    const window = frameWindow(clip, project.fps);
    if (windowContains(window, frame) && (!top || clip.layer > top.layer)) top = { alpha: clip.alpha, local: localFrame(window, frame), layer: clip.layer };
  }
  return top !== undefined && getCount(top.alpha) >= 2 && evaluate(top.alpha, top.local, 1) < 1;
}

/** Text boxes of the titles whose SVG the host can read. */
async function textBoxesOf(call: ToolCall, titles: readonly { clipId: string; path: string }[]): Promise<TextBox[]> {
  const read = call.host.storage?.readText;
  if (!read) return [];
  const project = call.doc.project;
  const clips = new Map(project.clips.map((c) => [String(c.id), c]));
  const cache = new Map<string, string | null>();
  const boxes: TextBox[] = [];
  for (const title of titles.slice(0, MAX_TITLE_FILES)) {
    if (call.signal?.aborted) break;
    const clip = clips.get(title.clipId);
    if (!clip || !title.path) continue;
    if (!cache.has(title.path)) cache.set(title.path, await read.call(call.host.storage, title.path).catch(() => null));
    const svg = cache.get(title.path);
    if (svg) boxes.push(...titleTextBoxes(project, clip, svg));
  }
  return boxes;
}

function reportText(data: Record<string, unknown>, problems: readonly ReviewProblem[], sheetNote: string): string {
  const shots = data.shots as { count: number; medianSeconds: number; maxSeconds: number };
  const cuts = data.cuts as { count: number; perSecond: number; transitions: number };
  const range = data.range as { start: number; end: number };
  const lines = [
    `Reviewed ${range.start.toFixed(2)}-${range.end.toFixed(2)} s: ${shots.count} shot${shots.count === 1 ? "" : "s"} (median ${shots.medianSeconds} s, longest ${shots.maxSeconds} s), ${cuts.count} cut${cuts.count === 1 ? "" : "s"} (${cuts.perSecond}/s${cuts.transitions ? `, ${cuts.transitions} with a transition` : ""}).`,
  ];
  const rhythm = data.rhythm as { onTransient: number; bpm: number } | null;
  if (rhythm) lines.push(`${Math.round(rhythm.onTransient * 100)}% of cuts land on a beat or hit (${rhythm.bpm ? `${rhythm.bpm} BPM` : "no steady beat"}).`);
  const mix = data.mix as MixReview | null;
  if (mix?.lufs != null) lines.push(`Mix ${mix.lufs.toFixed(1)} LUFS, peak ${mix.peakDb?.toFixed(1)} dBFS.`);
  lines.push(
    problems.length === 0
      ? "No problems found."
      : `${problems.length} problem${problems.length === 1 ? "" : "s"}, worst first (messages and fixes in data.problems): ${problems.map((p) => `${p.code}@${p.at.toFixed(2)}s`).join(", ")}.`,
  );
  const brief = data.brief as BriefCheck | null;
  if (brief) {
    const used = brief.techniques.filter((t) => t.status === "used").length;
    lines.push(`Brief (${brief.style}): ${brief.beats.filter((b) => b.hit).length}/${brief.beats.length} beats start on a picture change, ${used}/${brief.techniques.length} borrowed techniques on the timeline.`);
    for (const miss of brief.misses) lines.push(`BRIEF: ${miss.message}`);
    if (brief.checklist.length > 0) lines.push(`Look for on the sheet (the style's checklist): ${brief.checklist.join(" · ")}`);
  }
  const swaps = problems.flatMap((p) => p.swaps ?? []);
  if (swaps.length > 0) {
    lines.push(`Swaps for the repeated shots (one swap_shot_tool call each):`);
    for (const s of swaps) lines.push(`- ${s.at.toFixed(2)}s ${s.name} → ${s.to_name} (${s.why}): swap_shot_tool ${JSON.stringify({ clip_id: s.clip_id, file_id: s.to_file_id, start_seconds: s.start_seconds })}`);
  }
  if (sheetNote) lines.push(sheetNote);
  return lines.join("\n");
}

export const reviewTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Review the edit",
    description:
      "Watch your own cut. Returns ONE contact sheet image of the timeline at its cut points (each cut's last and first frame, labelled with times, plus frames from long shots; bright flash frames and black frames get a coloured border) " +
      "and numbers a viewer feels: shot count and lengths, cuts per second, how many cuts land on the music's beats or hits, the longest hold, empty and black frames, flashes, titles on screen, loudness and silences, " +
      "and a ranked list of problems with timestamps and fixes (shots held too long for the pace, cuts off the beat, black or empty frames, silent stretches, text outside the safe area). " +
      "With a saved brief (save_brief_tool) it also checks the cut against it: beats, borrowed techniques, and the style's checklist to look for. " +
      "Call it after cutting, fix the problems it lists, and call it again; a 20-shot reel costs about 1,500 image tokens. Zoom in with start/end. Changes nothing.",
    input,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const pace = args.pace ?? "fast";
      if (args.start !== undefined && args.end !== undefined && args.end <= args.start) return refused(TOOL, "Error: end must be after start.");
      const review = reviewTimeline(project, { start: args.start, end: args.end });
      if (review.shots.length === 0) {
        const ranged = args.start !== undefined || args.end !== undefined;
        return refused(
          TOOL,
          ranged && project.clips.length > 0
            ? `Error: no video or image clips in ${args.start ?? 0}-${args.end ?? "end"} s; the edit runs to ${timelineEnd(project).toFixed(2)} s.`
            : "Error: the timeline has no video or image clips to review. Add footage first.",
        );
      }
      const warnings: string[] = [];
      const fps = review.fps;

      // Sound: mix down, measure, and see where the cuts fall against it.
      let mix: MixReview | null = null;
      let alignment: BeatAlignment | null = null;
      const measure = call.host.audio?.measureMix;
      if (args.audio !== false && measure && review.audioClips > 0) {
        try {
          const measured = await measure.call(call.host.audio, project, { range: review.range, signal: call.signal });
          mix = { lufs: measured.lufs, peakDb: measured.peakDb, silences: measured.silences };
          alignment = rhythmOf(call, { ...mix, pcm: measured.pcm }, review.range.start, review.cuts.map((c) => c.time), fps);
        } catch (error) {
          warnings.push(`Could not measure the audio: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (args.audio !== false && !measure) {
        warnings.push("This surface cannot mix audio down: loudness and cuts against the beat are not measured; silences are read from the clips.");
      }

      // The contact sheet.
      let image: ToolImage | undefined;
      let frames: SampledFrame[] | undefined;
      let sheet: Record<string, unknown> | null = null;
      let sheetNote = "";
      let flashTimes: number[] = [];
      if (args.image !== false) {
        const plan = planSheet(review, args.max_tiles ?? 24);
        const shots = new Map(review.shots.map((shot) => [shot.index, shot]));
        const fading = plan.tiles.map((t) => fadingAt(project, shots.get(t.shot), t.seconds));
        const renderSheet = call.host.frames?.renderSheet;
        if (!renderSheet) {
          warnings.push("This surface cannot compose a contact sheet: use preview_frame at the cut times instead.");
        } else if (plan.tiles.length > 0) {
          const detail = args.tile_width !== undefined;
          const layout = sheetLayout(plan.tiles.length, project.width / Math.max(1, project.height), detail ? MAX_SHEET_PIXELS : DEFAULT_SHEET_PIXELS, args.tile_width);
          try {
            const result = await renderSheet.call(
              call.host.frames,
              project,
              plan.tiles.map((t, i) => ({ seconds: t.seconds, label: t.label, mark: tileMark({ shot: t.shot, fading: fading[i] }, review) })),
              { columns: layout.columns, tileWidth: layout.tileWidth, tileHeight: layout.tileHeight, gap: layout.gap, mark: { bright: FLASH_LUMA, dark: BLACK_LUMA, darkPeak: BLACK_PEAK } },
              call.signal,
            );
            image = result.image;
            frames = plan.tiles.flatMap((t, i) => (result.luma[i] == null ? [] : [{ seconds: t.seconds, luma: result.luma[i]!, peak: result.peak[i] ?? result.luma[i]!, shot: t.shot, fading: fading[i] }]));
            flashTimes = flashAndBlack(frames, review).flashes;
            sheet = {
              tiles: plan.tiles.length,
              width: result.width,
              height: result.height,
              approxImageTokens: Math.round((result.width * result.height) / PIXELS_PER_TOKEN),
              cutsShown: plan.cutsShown,
              cutsTotal: plan.cutsTotal,
            };
            const sampled = plan.cutsShown < plan.cutsTotal ? ` Only ${plan.cutsShown} of ${plan.cutsTotal} cuts are on the sheet: pass start/end to see the rest.` : "";
            sheetNote = `Sheet: ${plan.tiles.length} frames, each cut as its last frame ("out") and first frame ("in"); a coloured border marks a flash or black frame.${sampled}`;
          } catch (error) {
            warnings.push(`Could not render the contact sheet: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      const textBoxes = await textBoxesOf(call, review.titleClips);
      const problems = findProblems({ review, pace, alignment, mix, frames, textBoxes, frame: { width: project.width, height: project.height } });
      // One pass over every footage problem's shots, so two problems are never offered the same unused clip.
      const footage = problems.filter((p) => p.shots);
      const swaps = swapSuggestions(project, review, footage.flatMap((p) => p.shots!));
      for (const p of footage) {
        const starts = new Set(review.shots.filter((s) => p.shots!.includes(s.index)).map((s) => s.start));
        p.swaps = swaps.filter((s) => starts.has(s.at));
        for (const s of p.swaps) swaps.splice(swaps.indexOf(s), 1);
      }

      const saved = readBrief(project);
      const brief = saved ? checkBrief(project, saved) : null;
      const lengths = review.shots.map((s) => s.duration);
      const data = {
        range: review.range,
        pace,
        frame: { width: project.width, height: project.height, fps },
        shots: {
          count: review.stats.count,
          minSeconds: review.stats.min,
          medianSeconds: review.stats.median,
          meanSeconds: review.stats.mean,
          maxSeconds: review.stats.max,
          ...(lengths.length <= MAX_LISTED_SHOTS ? { lengthsSeconds: lengths } : {}),
        },
        cuts: {
          count: review.cuts.length,
          perSecond: review.cutsPerSecond,
          hard: review.cuts.filter((c) => c.style === "cut").length,
          transitions: review.cuts.filter((c) => c.style === "transition").length,
        },
        rhythm: alignment && {
          bpm: alignment.bpm,
          onBeat: alignment.onBeat,
          onTransient: alignment.onTransient,
          toleranceSeconds: alignment.tolerance,
          offBeat: alignment.misses.slice(0, 5),
        },
        longestShot: review.longestShot,
        longestStaticHold: review.longestStaticHold,
        flashes: { colorClips: review.colorFlashes.map((f) => f.start), bright: flashTimes },
        emptyStretches: review.empty,
        text: review.text,
        mix: mix && { lufs: mix.lufs, peakDb: mix.peakDb, silences: mix.silences },
        silentGaps: mix ? undefined : review.silentGaps,
        audioClips: review.audioClips,
        sheet,
        problems,
        brief,
        ok: problems.every((p) => p.severity === "low") && !brief?.misses.some((m) => m.hard),
      };
      const receipt = applied(TOOL, reportText(data, problems, sheetNote), { data, warnings }, 0);
      return image ? { receipt, images: [image] } : receipt;
    },
  }),
];
