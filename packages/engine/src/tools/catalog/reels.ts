/**
 * build_reel_tool: a finished short-form edit in one call, from media already
 * in the project. Cuts land on the music's beats; every shot gets the style's
 * camera move and look; flashes hit the downbeats; the hook title, shot
 * labels, end card and the music bed (faded out) go on their own tracks. The
 * whole edit is ONE undo step.
 *
 * reels/styles.ts says how each style cuts, moves, grades and titles,
 * reels/plan.ts places every shot, reels/typography.ts draws the titles.
 * This tool reads the media and the music's beats (tools/beats.ts), writes
 * the title images through the host, then records the edit.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { isAudioOnlyMedia, isSingleImageMedia } from "../../model/media.js";
import { Interpolation, type Clip, type Project, type ProjectFile } from "../../model/types.js";
import { addClip, deleteClips, setClipKeyframes, setClipProperty, setClipSpeed } from "../../ops/clips.js";
import { applyLookPreset } from "../../ops/look.js";
import { applyClipPreset } from "../../ops/presets.js";
import { addTitleClip } from "../../ops/titles.js";
import { addTrack } from "../../ops/tracks.js";
import { removeTransition } from "../../ops/transitions.js";
import { planReel, type MusicBeats, type PlannedShot, type ReelMedia, type ReelPlan } from "../../reels/plan.js";
import { REEL_STYLE_IDS, REEL_STYLES, type ReelStyle } from "../../reels/styles.js";
import { cardSvg, flashSvg, type CardRole } from "../../reels/typography.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import type { ImportedMedia } from "../types.js";

const TOOL = "build_reel_tool";
/** How long a white flash fades, seconds (three frames at 30 fps). */
const FLASH_SECONDS = 0.1;
/** Flash at most once per this many seconds: a flash on every bar strobes. */
const FLASH_SPACING_SECONDS = 3;
/** Tracks the reel uses, bottom to top. */
const TRACKS = ["music", "video", "flash", "labels", "titles"] as const;
type TrackRole = (typeof TRACKS)[number];

const STYLE_LINES = REEL_STYLE_IDS.map((id) => `${id}: ${REEL_STYLES[id].summary}`).join(" ");

const input = z.strictObject({
  style: z.enum(REEL_STYLE_IDS).optional().describe(`How the reel is cut and looks (default hype). ${STYLE_LINES}`),
  file_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(60)
    .optional()
    .describe("Media-bin videos and images to use, in story order; the last one closes the reel. Default: every video and image in the bin, in bin order."),
  music_file_id: z.string().optional().describe("Music in the media bin to cut to. Default: the longest audio file in the bin. Without music the cuts follow the style's own tempo."),
  duration_seconds: z.number().min(4).max(120).optional().describe("Target length, seconds (default per style, 12-20). The reel ends on the last downbeat before it."),
  hook: z.string().max(80).optional().describe("Opening title over the first shots: 2-6 punchy words."),
  end_card: z.string().max(80).optional().describe("Closing title over the last shot (a call to action, a name, a date)."),
  end_card_subtitle: z.string().max(80).optional().describe("A smaller line under the end card."),
  labels: z.array(z.string().max(40)).max(60).optional().describe("Small labels shown on each file's shots, in file_ids order (\"\" for none)."),
  beats: z
    .array(z.number().min(0))
    .max(4000)
    .optional()
    .describe("Beat times of the music in seconds (e.g. from detect_beats_tool) instead of analysing it here."),
  replace: z.boolean().optional().describe("Clear the timeline first when it already has clips (they are removed in the same undo step)."),
});

type Input = z.infer<typeof input>;

function displayName(file: ProjectFile): string {
  const base = String(file.name ?? file.path ?? file.id).split(/[\\/]/).pop() ?? String(file.id);
  return base.replace(/\.[A-Za-z0-9]+$/, "").replace(/[_-]+/g, " ").trim() || String(file.id);
}

function visualKind(file: ProjectFile): "video" | "image" | null {
  if (isAudioOnlyMedia(file)) return null;
  if (isSingleImageMedia(file)) return "image";
  return file.has_video ? "video" : null;
}

/** The usable part of a video: skip the first fifth of a second (camera settling) on longer clips. */
function usableRange(file: ProjectFile): [number, number] {
  const duration = Number(file.duration) || 0;
  return duration > 3 ? [0.2, duration - 0.1] : [0, duration];
}

/** Music from evenly spaced beat times given by the caller. */
function musicFromBeats(times: number[], duration: number): MusicBeats {
  const beats = [...times].sort((a, b) => a - b);
  const gaps = beats.slice(1).map((t, i) => t - beats[i]!).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0.5;
  return { bpm: median > 0 ? 60 / median : 120, beats, downbeats: beats.filter((_, i) => i % 4 === 0), duration };
}

function aspectName(project: Project): string {
  const w = Number(project.width) || 1920;
  const h = Number(project.height) || 1080;
  const ratio = w / h;
  if (Math.abs(ratio - 9 / 16) < 0.02) return "vertical 9:16";
  if (Math.abs(ratio - 16 / 9) < 0.02) return "landscape 16:9";
  if (Math.abs(ratio - 1) < 0.02) return "square 1:1";
  if (Math.abs(ratio - 4 / 5) < 0.02) return "portrait 4:5";
  return `${w}×${h}`;
}

function storyLine(plan: ReelPlan, names: Map<string, string>): string {
  const order: string[] = [];
  for (const shot of plan.shots) {
    const name = names.get(shot.fileId) ?? shot.fileId;
    if (order[order.length - 1] !== name) order.push(name);
  }
  const unique = order.filter((name, i) => order.indexOf(name) === i);
  if (unique.length === 1) return unique[0]!;
  const last = order[order.length - 1]!;
  const middle = unique.filter((n) => n !== unique[0] && n !== last).slice(0, 5);
  return [unique[0], ...middle].join(", ") + `, ends on ${last}`;
}

/** The shots whose cut flashes: downbeats (in the climax only, for some styles), spaced so it never strobes. */
function flashIndexes(style: ReelStyle, shots: readonly PlannedShot[]): Set<number> {
  const out = new Set<number>();
  let last = -Infinity;
  shots.forEach((shot, index) => {
    if (index === 0 || !shot.onDownbeat || style.flash === "none") return;
    if (style.flash === "climax_downbeats" && !shot.climax) return;
    if (shot.start - last < FLASH_SPACING_SECONDS) return;
    out.add(index);
    last = shot.start;
  });
  return out;
}

interface Prepared {
  hook?: ImportedMedia;
  end?: ImportedMedia;
  flash?: ImportedMedia;
  labels: Map<string, ImportedMedia>;
}

async function writeCard(call: ToolCall, name: string, svg: string): Promise<ImportedMedia> {
  const media = call.host.media!;
  const path = await media.writeGenerated!(name, new TextEncoder().encode(svg), "image/svg+xml");
  return { path, info: await media.probe(path), name };
}

/** The reel's tracks, bottom to top: the lowest five, adding tracks when the project has fewer. */
function reelTracks(tx: Transaction): Record<TrackRole, number> {
  while (tx.project.layers.length < TRACKS.length) addTrack(tx, {});
  const numbers = [...tx.project.layers].map((l) => Number(l.number)).sort((a, b) => a - b);
  return Object.fromEntries(TRACKS.map((role, i) => [role, numbers[i]!])) as Record<TrackRole, number>;
}

function fadeAlpha(tx: Transaction, clip: Clip, from: number, to: number, start: number, end: number): void {
  setClipKeyframes(
    tx,
    clip.id,
    "alpha",
    [
      { time: start, value: from, interpolation: Interpolation.LINEAR },
      { time: end, value: to, interpolation: Interpolation.LINEAR },
    ],
    { mode: "merge" },
  );
}

function placeTitle(tx: Transaction, media: ImportedMedia, position: number, duration: number, layer: number, entrance: string | null): Clip {
  const { clip } = addTitleClip(tx, { file: media, position, duration, layer, title: media.name });
  if (entrance && entrance !== "animate.none") applyClipPreset(tx, clip.id, entrance as Parameters<typeof applyClipPreset>[2]);
  // Leave a little before the next thing happens.
  const out = Math.min(0.25, duration / 4);
  fadeAlpha(tx, clip, 1, 0, position + duration - out, position + duration);
  return clip;
}

export const reelTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Build a reel",
    description:
      "Cut a finished short-form video (Reels, TikTok, Shorts, ads) in one step from media already in the project: shots cut on the music's beats, " +
      "camera moves, flashes, a look, an opening hook title, shot labels, an end card and the music faded out. One undo step. " +
      "Put the videos/images and one music track in the media bin first (stock, AI, uploads, URLs); give them in story order.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const style = REEL_STYLES[args.style ?? "hype"];
      const files = new Map(project.files.map((f) => [String(f.id), f]));
      const names = new Map([...files].map(([id, f]) => [id, displayName(f)]));

      // Validate everything before any work (a refused call leaves history untouched).
      const ids = args.file_ids ?? project.files.filter((f) => visualKind(f) !== null).map((f) => String(f.id));
      const unknown = ids.filter((id) => !files.has(id));
      if (unknown.length > 0) return refused(TOOL, `Error: unknown file id(s): ${unknown.join(", ")}.`);
      const notVisual = ids.filter((id) => visualKind(files.get(id)!) === null);
      if (notVisual.length > 0) return refused(TOOL, `Error: these are not videos or images: ${notVisual.join(", ")}.`);
      if (ids.length === 0) return refused(TOOL, "Error: the media bin has no videos or images to cut. Import some first.");
      if (project.clips.length > 0 && !args.replace) {
        return refused(TOOL, `Error: the timeline already has ${project.clips.length} clip(s). Pass replace=true to rebuild it, or build in a new project.`);
      }
      const musicId = args.music_file_id ? String(args.music_file_id) : undefined;
      let music: ProjectFile | undefined;
      if (musicId) {
        music = files.get(musicId);
        if (!music) return refused(TOOL, `Error: unknown music_file_id ${musicId}.`);
        if (!music.has_audio) return refused(TOOL, `Error: ${musicId} has no audio.`);
      } else {
        music = project.files
          .filter((f) => isAudioOnlyMedia(f) && !ids.includes(String(f.id)))
          .sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0];
      }

      const labels = new Map<string, string>();
      (args.labels ?? []).forEach((label, i) => {
        const id = ids[i];
        if (id && label.trim()) labels.set(id, label.trim());
      });
      const media: ReelMedia[] = ids.map((id) => {
        const file = files.get(id)!;
        const kind = visualKind(file)!;
        const [start, end] = kind === "video" ? usableRange(file) : [0, 0];
        return { fileId: id, kind, start, end, ...(labels.has(id) ? { label: labels.get(id)! } : {}) };
      });

      // The music's beats: given, tracked here, or none (cut to the style's tempo).
      const warnings: string[] = [];
      let beats: MusicBeats | null = null;
      if (music) {
        const musicLength = Number(music.duration) || 0;
        if (args.beats && args.beats.length >= 2) {
          beats = musicFromBeats(args.beats, musicLength);
        } else if (canTrackBeats(call)) {
          const tracked = await beatsOfFile(call, music);
          if (typeof tracked === "string") warnings.push(`${tracked} Cut to the style's tempo instead.`);
          else if (tracked.beats.length >= 2) beats = { ...tracked, beats: tracked.beats.map((b) => b.timeSec), downbeats: tracked.downbeats.map((d) => d.timeSec), duration: Math.max(musicLength, tracked.duration) };
          else warnings.push("No steady beat in the music: cut to the style's tempo instead.");
        } else {
          warnings.push("This surface cannot analyse audio: the cuts follow the style's tempo, not the music's beats.");
        }
      }

      let plan: ReelPlan;
      try {
        const fps = Number(project.fps?.num) / Number(project.fps?.den || 1);
        plan = planReel({ style, media, music: beats, seconds: args.duration_seconds, frameRate: Number.isFinite(fps) ? fps : undefined });
      } catch (error) {
        return failed(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Title images (written through the host before the edit is recorded).
      const prepared: Prepared = { labels: new Map() };
      const flashes = flashIndexes(style, plan.shots);
      const width = Number(project.width) || 1920;
      const height = Number(project.height) || 1080;
      const card = (text: string, role: CardRole, subtitle?: string) => cardSvg({ width, height, text, role, typography: style.typography, subtitle });
      if (call.host.media?.writeGenerated) {
        try {
          if (args.hook?.trim()) prepared.hook = await writeCard(call, "reel-hook.svg", card(args.hook, "hook"));
          if (args.end_card?.trim()) prepared.end = await writeCard(call, "reel-end.svg", card(args.end_card, "end", args.end_card_subtitle));
          if (flashes.size > 0) prepared.flash = await writeCard(call, "reel-flash.svg", flashSvg(width, height));
          for (const label of new Set(plan.shots.map((s) => s.label).filter((l): l is string => Boolean(l)))) {
            prepared.labels.set(label, await writeCard(call, `reel-label-${prepared.labels.size + 1}.svg`, card(label, "label")));
          }
        } catch (error) {
          return failed(TOOL, `Error: failed to write the reel's titles: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (args.hook || args.end_card || labels.size > 0) {
        warnings.push("This surface cannot store generated title images: the reel has no titles.");
      }

      const built = call.commit((tx) => {
        if (tx.project.clips.length > 0) {
          for (const t of [...tx.project.effects]) removeTransition(tx, String(t.id));
          deleteClips(tx, tx.project.clips.map((c) => String(c.id)), { ripple: false });
        }
        const track = reelTracks(tx);

        if (music) {
          const start = plan.musicStart ?? 0;
          const bed = addClip(tx, { fileId: String(music.id), position: 0, layer: track.music, start, end: start + plan.duration, title: names.get(String(music.id)) });
          const out = Math.min(1.2, plan.duration / 4);
          setClipKeyframes(tx, bed.id, "volume", [
            { time: 0, value: start > 0 ? 0 : 1, interpolation: Interpolation.LINEAR },
            ...(start > 0 ? [{ time: 0.12, value: 1, interpolation: Interpolation.LINEAR }] : []),
            { time: plan.duration - out, value: 1, interpolation: Interpolation.LINEAR },
            { time: plan.duration, value: 0, interpolation: Interpolation.LINEAR },
          ]);
        }

        plan.shots.forEach((shot, index) => {
          const file = files.get(shot.fileId)!;
          const length = shot.end - shot.start;
          const clip = addClip(tx, {
            fileId: shot.fileId,
            position: shot.start,
            layer: track.video,
            start: shot.kind === "video" ? shot.sourceStart : 0,
            end: shot.kind === "video" ? shot.sourceEnd : length,
          });
          if (shot.speed < 0.999) setClipSpeed(tx, clip.id, shot.speed);
          const motion = shot.kind === "image" ? style.motion.image : style.motion.video;
          if (motion && motion !== "animate.none") applyClipPreset(tx, clip.id, motion);
          if (file.has_audio) setClipProperty(tx, clip.id, "volume", style.clipVolume);
          for (const look of style.looks) applyLookPreset(tx, clip.id, look);
          const current = tx.project.clips.find((c) => c.id === clip.id)!;
          if (index === 0 && style.fadeIn) fadeAlpha(tx, current, 0, 1, shot.start, shot.start + Math.min(0.6, length / 2));
          if (index === plan.shots.length - 1 && style.fadeOut) fadeAlpha(tx, current, 1, 0, shot.end - Math.min(0.8, length / 2), shot.end);
          if (prepared.flash && flashes.has(index)) {
            const flash = addTitleClip(tx, { file: prepared.flash, position: shot.start, duration: FLASH_SECONDS, layer: track.flash, title: "Flash" }).clip;
            fadeAlpha(tx, flash, 0.75, 0, shot.start, shot.start + FLASH_SECONDS);
          }
          const label = shot.label ? prepared.labels.get(shot.label) : undefined;
          if (label) placeTitle(tx, label, shot.start, length, track.labels, null);
        });

        if (prepared.hook) {
          const first = plan.shots[0]!;
          const hold = Math.min(3, Math.max(1.6, first.end - first.start));
          placeTitle(tx, prepared.hook, 0, Math.min(hold, plan.duration), track.titles, style.typography.hookIn);
        }
        if (prepared.end) {
          const last = plan.shots[plan.shots.length - 1]!;
          const at = last.start + Math.min(0.3, (last.end - last.start) * 0.15);
          placeTitle(tx, prepared.end, at, plan.duration - at, track.titles, style.typography.hookIn);
        }
        return { tracks: track };
      }, `Build ${style.name.toLowerCase()} reel`);

      const brief = {
        format: `${Math.round(plan.duration * 10) / 10} seconds, ${aspectName(call.doc.project)}`,
        story: storyLine(plan, names),
        pace: `${style.pace} (${Math.round(plan.bpm)} BPM)`,
        look: style.look,
      };
      return applied(TOOL, `Built a ${style.name.toLowerCase()} reel: ${plan.shots.length} shots cut to ${Math.round(plan.bpm)} BPM, ${brief.format}.`, {
        warnings,
        data: {
          style: style.id,
          duration: plan.duration,
          bpm: plan.bpm,
          music_file_id: music ? String(music.id) : null,
          music_start: plan.musicStart,
          // The timeline's beat grid: where to put anything else that should land on the beat.
          beats: plan.beats,
          downbeats: plan.downbeats,
          shots: plan.shots.map((s) => ({ file_id: s.fileId, start: s.start, end: s.end, source_start: s.sourceStart, source_end: s.sourceEnd })),
          tracks: built.tracks,
          brief,
        },
      });
    },
  }),
];
