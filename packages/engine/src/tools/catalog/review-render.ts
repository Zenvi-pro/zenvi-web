/**
 * review_render_tool: watch the rendered file before it goes out. The host's
 * detectors (`MediaHost.inspectRender`) find black, frozen and silent
 * stretches, the cuts and the loudness; review/render.ts turns them into
 * problems; this tool hashes every shot's middle frame to find repeated
 * shots and draws one contact sheet of the shots and the last frame.
 *
 * A fast-cut file also gets the rhythm checks (review/rhythm.ts): shot
 * lengths that never vary, shots that go still, brightness and colour that
 * never move, cuts with no sound on them.
 *
 * Frames come from the host's frame renderer on scratch projects holding the
 * file, so any host that renders timeline frames can read them: one project
 * per frame for the hashes, one grid project (the file once per tile, each
 * clip starting at its tile's time) for the sheet, with an SVG of labels on top.
 */

import { z } from "zod";
import { ProjectDocument } from "../../history/document.js";
import { Gravity, ScaleMode, type Project, type ProjectFile } from "../../model/types.js";
import { addClip, setClipProperty } from "../../ops/clips.js";
import { addTitleClip } from "../../ops/titles.js";
import {
  differenceHash,
  endVerdict,
  flatGround,
  INSPECT_THRESHOLDS,
  renderProblems,
  repeatedShots,
  sheetShots,
  shotsFromCuts,
  SOCIAL_TARGETS,
  type EndVerdict,
  type Problem,
  type RepeatGroup,
  type Shot,
} from "../../review/render.js";
import { finishGaps, finishLines } from "../../review/finish.js";
import { MAX_FLASHES, flashingOf, type FlashWindow } from "../../review/flashing.js";
import { onsetRatios, rhythmReview } from "../../review/rhythm.js";
import { swapSuggestions, type ShotSwap } from "../../review/swaps.js";
import { reviewTimeline } from "../../review/timeline.js";
import { BANDED_AREA, bandingOf } from "../../review/banding.js";
import { renderCauses, sfxHits, syncMisses, timelineCauses } from "../../review/av-sync.js";
import { filmChecks } from "../../review/film-checks.js";
import { readBrief } from "../../brief/brief.js";
import { houseStyle } from "../../brief/house.js";
import { fpsFloat } from "../../timeline/time.js";
import { textBoxesOf } from "./review.js";
import type { Vector } from "../../shots/vectors.js";
import { FrameRenderError, mediaFileProject, renderPixels, secondsToFrame } from "../color-frames.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import type { ImportedMedia, RenderInspection, ToolImage } from "../types.js";

const TOOL = "review_render_tool";
/** Width shot frames are hashed at: enough for a 9x8 difference hash, cheap to render. */
const HASH_WIDTH = 96;
/** Longest edge of a contact-sheet tile, pixels. */
const TILE_EDGE = 270;
/** Shots hashed at most (a montage longer than this is sampled evenly). */
const MAX_HASHED_SHOTS = 120;
/** Frames read at full size for the banding check: the longest shots' middles. */
const BANDING_FRAMES = 4;
const SHEET_LAYER = 1_000_000;
const LABEL_LAYER = 2_000_000;
const FONT = "Lato, Helvetica, Arial, sans-serif";
/** A render this much longer or shorter than the open timeline is not of it: no swaps are suggested. */
const SAME_EDIT_SECONDS = 0.5;
/** Swaps listed at most. */
const MAX_SWAPS = 12;
/** The flash check decodes the picture this wide (3 x 3 cells and more), at the file's rate up to FLASH_MAX_FPS. */
const FLASH_WIDTH = 48;
const FLASH_MAX_FPS = 60;
/** ...and stops after this many seconds. */
const FLASH_MAX_SECONDS = 600;

const input = z.strictObject({
  path: z.string().min(1).describe("The rendered video to review, as render/export wrote it (a path relative to the project's folder, or absolute)."),
  max_tiles: z.number().int().min(4).max(24).optional().describe("Frames on the contact sheet, the last one being the end (default 12)."),
  loudness_target_lufs: z.number().min(-30).max(-5).optional().describe("Integrated loudness the delivery should sit near (default -14, social platforms)."),
  true_peak_max_db: z.number().min(-6).max(0).optional().describe("True-peak ceiling, dBTP (default -1)."),
});
type Input = z.output<typeof input>;

interface Tile {
  time: number;
  label: string;
  /** Why the tile is marked red, if it is. */
  flag?: string;
}

const fmt = (value: number): string => `${(Math.round(value * 100) / 100).toFixed(2)}s`;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Shot embeddings of each shot's middle frame, when the host has the shot model installed (never a download). */
async function renderLooks(call: ToolCall, path: string, shots: readonly Shot[]): Promise<(Vector | null)[] | undefined> {
  const host = call.host.shots;
  if (!host || shots.length < 2 || shots.length > MAX_HASHED_SHOTS) return undefined;
  try {
    if (!(await host.status()).ready) return undefined;
    return await host.embedFrames(path, shots.map((s) => s.mid), call.signal);
  } catch (error) {
    call.host.log?.(`shot embeddings of ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * More than 3 flashes in a second (WCAG 2.3.1), from the decoded picture;
 * undefined when the host cannot decode it (the reason goes to `warnings`).
 */
async function flashing(call: ToolCall, inspection: RenderInspection, warnings: string[]): Promise<FlashWindow[] | undefined> {
  const decode = call.host.media?.decodeLuma;
  if (!decode) return undefined;
  const width = FLASH_WIDTH;
  const height = Math.max(9, Math.min(360, Math.round((width * inspection.height) / Math.max(1, inspection.width))));
  try {
    const frames = await decode(inspection.path, { width, height, fps: Math.min(FLASH_MAX_FPS, inspection.fps > 0 ? inspection.fps : 30), maxSeconds: Math.min(inspection.duration, FLASH_MAX_SECONDS), signal: call.signal });
    return flashingOf(frames);
  } catch (error) {
    warnings.push(`the flash check could not decode the picture: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** One problem per stretch that flashes more than 3 times a second. */
function flashProblems(windows: readonly FlashWindow[]): Problem[] {
  return windows.map((w) => ({
    kind: "flashing" as const,
    severity: "problem" as const,
    at: w.start,
    message: `${w.flashes} flashes within one second at ${fmt(w.start)}-${fmt(Math.max(w.end, w.start + 1))} (WCAG 2.3.1 allows ${MAX_FLASHES}): flashing this fast can trigger seizures. Thin the flash transitions, flash frames or strobe there, unless the user asked for a strobe (then warn viewers)`,
  }));
}

/** The labels and red frames of the sheet, drawn over the grid of tiles. */
function labelsSvg(tiles: readonly Tile[], cols: number, tw: number, th: number): string {
  const rows = Math.ceil(tiles.length / cols);
  const size = Math.max(11, Math.round(Math.min(tw, th) * 0.085));
  const band = Math.round(size * 1.6);
  const parts = tiles.map((tile, i) => {
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * th;
    const text = (value: string, top: number, fill: string): string =>
      `<rect x="${x}" y="${top}" width="${tw}" height="${band}" fill="#000" fill-opacity="0.62"/>` +
      `<text x="${x + 6}" y="${top + Math.round(band * 0.72)}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${fill}">${escapeXml(value)}</text>`;
    // The flag sits on its own band at the bottom, so a long one is not cut off.
    const flag = tile.flag
      ? text(tile.flag, y + th - band - 4, "#ff6b75") +
        `<rect x="${x + 2}" y="${y + 2}" width="${tw - 4}" height="${th - 4}" fill="none" stroke="#ff2d3d" stroke-width="4"/>`
      : "";
    return text(tile.label, y, "#fff") + flag;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * tw}" height="${rows * th}" viewBox="0 0 ${cols * tw} ${rows * th}">${parts.join("")}</svg>`;
}

/** The file's frames at `times` in one grid: the file once per tile, each clip starting at its tile's time. */
async function sheetProject(
  call: ToolCall,
  base: Project,
  file: ProjectFile,
  inspection: RenderInspection,
  tiles: readonly Tile[],
): Promise<{ project: Project; width: number }> {
  const aspect = inspection.width / Math.max(1, inspection.height);
  const [tw, th] = aspect >= 1 ? [TILE_EDGE, Math.round(TILE_EDGE / aspect)] : [Math.round(TILE_EDGE * aspect), TILE_EDGE];
  const cols = Math.min(tiles.length, aspect >= 1 ? 4 : 6);
  const rows = Math.ceil(tiles.length / cols);
  let labels: ImportedMedia | null = null;
  const media = call.host.media;
  if (media?.writeGenerated) {
    try {
      const path = await media.writeGenerated("review-render-labels.svg", new TextEncoder().encode(labelsSvg(tiles, cols, tw, th)), "image/svg+xml");
      labels = { path, info: await media.probe(path), name: "review-render-labels.svg" };
    } catch (error) {
      call.host.log?.(`review sheet labels failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const frame = 1 / Math.max(1, inspection.fps);
  const doc = new ProjectDocument(
    {
      ...base,
      width: cols * tw,
      height: rows * th,
      clips: [],
      effects: [],
      markers: [],
      files: [file],
      layers: [
        { id: "L1", number: SHEET_LAYER, label: "", y: 0, lock: false },
        { id: "L2", number: LABEL_LAYER, label: "", y: 0, lock: false },
      ],
      history: { undo: [], redo: [] },
    },
    { historyLimit: 0 },
  );
  doc.transaction("sheet", (tx) => {
    tiles.forEach((tile, i) => {
      const start = Math.max(0, Math.min(tile.time, inspection.duration - frame));
      const clip = addClip(tx, { fileId: String(file.id), position: 0, layer: SHEET_LAYER + i, start, end: Math.min(inspection.duration, start + 0.25) });
      setClipProperty(tx, clip.id, "scale", ScaleMode.STRETCH);
      setClipProperty(tx, clip.id, "gravity", Gravity.TOP_LEFT);
      setClipProperty(tx, clip.id, "scale_x", 1 / cols);
      setClipProperty(tx, clip.id, "scale_y", 1 / rows);
      setClipProperty(tx, clip.id, "location_x", (i % cols) / cols);
      setClipProperty(tx, clip.id, "location_y", Math.floor(i / cols) / rows);
      setClipProperty(tx, clip.id, "volume", 0);
    });
    if (labels) addTitleClip(tx, { file: labels, position: 0, duration: 0.25, layer: LABEL_LAYER + tiles.length, title: "Labels" });
  });
  return { project: doc.project, width: cols * tw };
}

/** Smooth gradients drawn as flat 8-bit bands, on the longest shots' middle frames at full size. */
async function bandingProblems(call: ToolCall, solo: Project, shots: readonly Shot[], width: number): Promise<Problem[]> {
  const picks = [...shots].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, BANDING_FRAMES);
  const banded: { at: number; area: number }[] = [];
  for (const shot of picks) {
    if (call.signal?.aborted) break;
    try {
      const { pixels } = await renderPixels(call, solo, secondsToFrame(solo, shot.mid), Math.min(1920, width));
      const b = bandingOf(pixels);
      if (b.area > BANDED_AREA) banded.push({ at: shot.mid, area: b.area });
    } catch (error) {
      if (!(error instanceof FrameRenderError)) throw error;
    }
  }
  if (banded.length === 0) return [];
  return [
    {
      kind: "banding",
      severity: "warning",
      at: banded[0]!.at,
      message: `Gradient banding (flat 8-bit plateaus with contour steps) on ${banded.map((b) => `${fmt(b.at)} (${Math.round(b.area * 100)} % of the frame)`).join(", ")}. Render with the encoder's dithered deband pass (zenvi render --deband; a cinetic house style's export does it by itself).`,
    },
  ];
}

/**
 * Sound effects of the open project whose transient lands more than a frame
 * from any visible cause: a jump in the rendered picture, or the timeline's
 * own changes (a keystroke's title, a keyframe), which are often too small
 * to stand out of the render's motion but are still seen.
 */
function syncProblems(project: Project, inspection: RenderInspection): Problem[] {
  const hits = sfxHits(project);
  const end = Math.max(0, ...project.clips.map((c) => c.position + (c.end - c.start)));
  // Only a render of this project from its start lines up with its timeline.
  if (!inspection.picture || hits.length === 0 || Math.abs(end - inspection.duration) > 0.5) return [];
  const rate = fpsFloat(project.fps) || inspection.fps;
  const causes = [...renderCauses(inspection.picture, inspection.cuts.map((c) => c.time)), ...timelineCauses(project)];
  const misses = syncMisses(hits, causes, 1 / Math.max(1, Math.min(rate, inspection.picture.fps)));
  if (misses.length === 0) return [];
  return [
    {
      kind: "sound_without_cause",
      severity: "warning",
      at: misses[0]!.time,
      message: `${misses.length} of ${hits.length} sound effects hit more than a frame from anything that changes in the render: ${misses.slice(0, 5).map((m) => `${m.recipe} at ${fmt(m.time)}${m.offset === null ? "" : ` (nearest picture change ${m.offset > 0 ? "+" : ""}${m.offset.toFixed(2)}s)`}`).join(", ")}. Move each onto its cause or remove it.`,
    },
  ];
}

/** One line per problem, problems first. */
function problemLines(problems: readonly Problem[]): string {
  const ordered = [...problems.filter((p) => p.severity === "problem"), ...problems.filter((p) => p.severity === "warning")];
  return ordered.map((p) => `- ${p.severity === "problem" ? "PROBLEM" : "warning"}: ${p.message}`).join("\n");
}

/**
 * Swaps for the repeats (every appearance after the first, the ones back too
 * soon first), read off the open timeline at each shot's middle: the render
 * must be of it. Null when it is not.
 */
function repeatSwaps(project: Project, duration: number, shots: readonly Shot[], repeats: readonly RepeatGroup[], windowSeconds: number): ShotSwap[] | null {
  const review = reviewTimeline(project);
  if (Math.abs(review.range.end - duration) > SAME_EDIT_SECONDS) return null;
  const byIndex = new Map(shots.map((s) => [s.index, s]));
  const groups = [...repeats].sort((a, b) => Number(b.minGapSeconds < windowSeconds) - Number(a.minGapSeconds < windowSeconds));
  const toFix: number[] = [];
  for (const group of groups) {
    for (const index of group.shots.slice(1)) {
      const mid = byIndex.get(index)?.mid;
      const at = mid === undefined ? undefined : review.shots.find((s) => s.start <= mid && mid < s.end);
      if (at) toFix.push(at.index);
    }
  }
  // The close repeats first, so the cap keeps them.
  return swapSuggestions(project, review, toFix.slice(0, MAX_SWAPS));
}

function swapLines(swaps: readonly ShotSwap[]): string {
  return swaps
    .map((s) => `- ${fmt(s.at)} ${s.name} → ${s.to_name} from ${fmt(s.start_seconds)} (${s.why}): swap_shot_tool ${JSON.stringify({ clip_id: s.clip_id, file_id: s.to_file_id, start_seconds: s.start_seconds })}`)
    .join("\n");
}

function tilesFor(shots: readonly Shot[], repeats: readonly RepeatGroup[], end: EndVerdict, inspection: RenderInspection, maxTiles: number): Tile[] {
  const repeatOf = new Map<number, number>();
  for (const group of repeats) for (const index of group.shots.slice(1)) repeatOf.set(index, group.shots[0]!);
  const black = (t: number): boolean => inspection.black.some((b) => b.start <= t && t <= b.end);
  const tiles: Tile[] = sheetShots(shots, repeats, maxTiles).map((shot) => {
    const tile: Tile = { time: shot.mid, label: `#${shot.index} ${fmt(shot.mid)}` };
    if (black(shot.mid)) tile.flag = "BLACK";
    else if (repeatOf.has(shot.index)) tile.flag = `REPEAT of #${repeatOf.get(shot.index)}`;
    return tile;
  });
  const last = Math.max(0, inspection.duration - 1 / Math.max(1, inspection.fps));
  tiles.push({ time: last, label: `END ${fmt(inspection.duration)}`, ...(end.ok ? {} : { flag: end.kind === "black" ? "ENDS ON BLACK" : "NO HOLD" }) });
  return tiles;
}

export const reviewRenderTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Review the rendered file",
    description:
      "Watch the final render before delivering it: reports black frames, frozen picture, audio dropouts, true peak and loudness (EBU R128), " +
      "how it ends (a hold or end card, never black or cut off), shots repeated too soon (perceptual hash of each shot's middle frame) and back-to-back shots that look the same (when the shot model is installed), " +
      "and for a fast cut its rhythm (shot lengths that never vary, shots that go still, brightness and colour that never move, cuts with no sound), " +
      "flashing past 3 flashes in a second (WCAG 2.3.1, a seizure risk), " +
      "with one contact sheet of the shots and the last frame (problems framed red). Call it on the file render/export wrote, after mastering; " +
      "fix every PROBLEM line and render again, then watch_render_tool once for the critique by eye and ear. Changes nothing.",
    input,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    requires: ["media", "frames"],
    run: async (call, args: Input) => {
      const media = call.host.media!;
      if (!media.inspectRender) return unavailable(TOOL, "reading a rendered file needs ffmpeg on this computer (the zenvi CLI and local MCP)");
      let inspection: RenderInspection;
      try {
        inspection = await media.inspectRender(args.path, { ...INSPECT_THRESHOLDS, signal: call.signal });
      } catch (error) {
        return refused(TOOL, `Error: could not read ${args.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!(inspection.duration > 0)) return refused(TOOL, `Error: ${args.path} has no picture to review`);
      const targets = {
        ...SOCIAL_TARGETS,
        loudnessLufs: args.loudness_target_lufs ?? SOCIAL_TARGETS.loudnessLufs,
        truePeakMaxDb: args.true_peak_max_db ?? SOCIAL_TARGETS.truePeakMaxDb,
      };

      const project = call.doc.project;
      const info = await media.probe(inspection.path);
      const file = { ...(info as unknown as Record<string, unknown>), id: "ZENVIRENDER", path: inspection.path } as unknown as ProjectFile;
      // The detectors stop at the host's limit; frames are read where both agree the file has picture.
      inspection = { ...inspection, duration: Math.min(inspection.duration, Number(info.duration) || inspection.duration) };
      // A canvas with the file's own aspect: a 9:16 render reviewed from a 16:9 project is not letterboxed.
      const solo = mediaFileProject({ ...project, width: inspection.width, height: inspection.height }, file, inspection.duration);
      const shots = shotsFromCuts(inspection.cuts, inspection.duration);
      const step = Math.max(1, Math.ceil(shots.length / MAX_HASHED_SHOTS));
      const hashes: (string | null)[] = [];
      const graphic: boolean[] = [];
      try {
        for (const [i, shot] of shots.entries()) {
          if (call.signal?.aborted) return refused(TOOL, "Error: cancelled");
          const pixels = i % step === 0 ? (await renderPixels(call, solo, secondsToFrame(solo, shot.mid), HASH_WIDTH)).pixels : null;
          hashes.push(pixels ? differenceHash(pixels) : null);
          graphic.push(pixels ? flatGround(pixels) : false);
        }
      } catch (error) {
        if (error instanceof FrameRenderError) return failed(TOOL, `Error: reading the frames of ${args.path} failed: ${error.message}`);
        throw error;
      }
      const repeats = repeatedShots(shots, hashes, graphic);
      const end = endVerdict(inspection, shots);
      const looks = await renderLooks(call, inspection.path, shots);
      const problems = renderProblems(inspection, shots, repeats, end, targets, looks);
      let onsets: number[] | null = null;
      if (inspection.hasAudio && call.host.audio?.decodePcm && shots.length > 1) {
        try {
          const pcm = await call.host.audio.decodePcm(inspection.path, { sampleRate: 8000, maxSeconds: inspection.duration, signal: call.signal });
          onsets = onsetRatios(pcm.samples, pcm.sampleRate, shots.slice(1).map((s) => s.start));
        } catch (error) {
          call.host.log?.(`review audio onsets failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const rhythm = rhythmReview(shots, inspection.duration, inspection.picture, onsets, inspection.frozen);
      problems.push(...rhythm.problems);
      const warnings: string[] = [];
      const flashes = await flashing(call, inspection, warnings);
      problems.push(...flashProblems(flashes ?? []));
      // A house style's finishing pass (cinetic's forensics and AV-sync audit); other styles are not held to it.
      const brief = readBrief(project);
      if (brief && houseStyle(brief.style)) {
        problems.push(...(await bandingProblems(call, solo, shots, inspection.width)));
        problems.push(...syncProblems(project, inspection));
      }
      // The open project's own finishing checks (motion speed, text overlap, a house style's copy and bans), as warnings.
      const timeline = reviewTimeline(project);
      const { boxes, svgs } = await textBoxesOf(call, timeline.titleClips);
      for (const p of filmChecks({ project, brief, titles: timeline.titleClips, svgs, textBoxes: boxes })) {
        if (p.code === "sound-without-cause") continue; // measured on the render itself above
        problems.push({ kind: p.code.startsWith("house-ban") ? "house_ban" : p.code.startsWith("copy-") ? "copy_pacing" : p.code === "text-overlap" ? "text_overlap" : "too_fast", severity: "warning", at: p.at, message: `${p.message} Fix: ${p.fix}` });
      }
      const swaps = repeats.length > 0 ? repeatSwaps(project, inspection.duration, shots, repeats, targets.repeatWindowSeconds) : [];

      const finish = finishGaps(project);
      const tiles = tilesFor(shots, repeats, end, inspection, args.max_tiles ?? 12);
      const images: ToolImage[] = [];
      try {
        const sheet = await sheetProject(call, project, file, inspection, tiles);
        images.push(await call.host.frames!.renderFrame(sheet.project, 0, { width: sheet.width, format: "jpeg" }));
      } catch (error) {
        warnings.push(`the contact sheet could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
      }

      const loud = inspection.loudness;
      const distinct = shots.length - repeats.reduce((n, g) => n + g.shots.length - 1, 0);
      const count = (severity: Problem["severity"]): number => problems.filter((p) => p.severity === severity).length;
      const loudWords = !inspection.hasAudio
        ? "no audio"
        : loud?.integratedLufs === null || !loud
          ? "silent audio"
          : `${loud.integratedLufs.toFixed(1)} LUFS, true peak ${loud.truePeakDb === null ? "?" : `${loud.truePeakDb > 0 ? "+" : ""}${loud.truePeakDb.toFixed(1)}`} dBTP`;
      const summary =
        `Reviewed ${args.path} (${fmt(inspection.duration)}, ${inspection.width}x${inspection.height}): ` +
        `${count("problem")} problem(s), ${count("warning")} warning(s). ` +
        `${shots.length} shot(s), ${distinct} distinct, ${(shots.length / inspection.duration).toFixed(1)} cuts/s; ${loudWords}; ${end.message}.` +
        (problems.length > 0 ? `\n${problemLines(problems)}` : "") +
        (swaps && swaps.length > 0 ? `\nSwap the repeats for footage not on screen yet (one call each, then render and review again):\n${swapLines(swaps)}` : "") +
        (swaps && swaps.length === 0 && repeats.length > 0 ? "\nNo unused clip or unused part of a clip is left to swap in: import more footage for the repeats." : "") +
        (finish.length > 0 ? `\nNot finished (the open project), fix in this order, then render and review again:\n${finishLines(finish).map((l) => `- FINISH: ${l}`).join("\n")}` : "") +
        (images.length > 0 ? "\nContact sheet attached: shots in order, the last tile is the end; problems are framed red." : "") +
        // Meters and frames cannot hear a silent whip or feel a sagging middle; a watch can.
        (call.host.watch
          ? count("problem") === 0
            ? `\nNext: watch_render_tool ${JSON.stringify({ path: args.path })} once, so an editor watches it with sound and names what to fix.`
            : "\nOnce the PROBLEM lines are fixed and rendered again with no PROBLEM left: watch_render_tool {path: the new render} once, so an editor watches it with sound and names what to fix."
          : "");
      const data = {
        path: args.path,
        duration: inspection.duration,
        width: inspection.width,
        height: inspection.height,
        fps: inspection.fps,
        ok: count("problem") === 0,
        finish,
        problems,
        end,
        loudness: loud,
        targets: { loudness_lufs: targets.loudnessLufs, tolerance_lu: targets.loudnessToleranceLu, true_peak_max_db: targets.truePeakMaxDb },
        shots: shots.map((s, i) => ({ ...s, hash: hashes[i] ?? null })),
        distinct_shots: distinct,
        repeats,
        swaps,
        black: inspection.black,
        frozen: inspection.frozen,
        silences: inspection.silences,
        rhythm: { fast_cut: rhythm.fastCut, shots: rhythm.pictures, weak_cuts: rhythm.weakCuts },
        flashing: flashes ?? null,
        sheet: images.length > 0 ? { tiles: tiles.map((t, i) => ({ tile: i + 1, time: t.time, label: t.label, flag: t.flag ?? null })) } : null,
      };
      return { receipt: applied(TOOL, summary, { data, warnings }, 0), images };
    },
  }),
];
