/**
 * build_reel_tool's motion-led styles (motion/styles.ts): the music window
 * and beat grid are planned exactly as for the footage styles
 * (`planReelGrid`), the storyboard splits the reel into scenes on its bars,
 * every scene's templates are generated on that grid and the whole video is
 * placed in ONE transaction: the music bed on the lowest track, the scenes on
 * the tracks above it (each template stacked over the one before it).
 */

import type { Transaction } from "../../history/document.js";
import type { ProjectFile } from "../../model/types.js";
import { addTrack } from "../../ops/tracks.js";
import { deleteClips } from "../../ops/clips.js";
import { removeTransition } from "../../ops/transitions.js";
import { buildMotionTemplate } from "../../motion/build.js";
import { PALETTES } from "../../motion/palettes.js";
import { MOTION_STYLES, storyboard, type MotionScene, type MotionStyleId } from "../../motion/styles.js";
import { MotionInputError } from "../../motion/template.js";
import type { BeatGrid, MotionMedia, MotionPlan } from "../../motion/types.js";
import { onFrameGrid, planReelGrid, type MusicBeats } from "../../reels/plan.js";
import type { ToolCall, ToolOutcome } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import type { ImportedMedia } from "../types.js";
import { motionMedia, placeMotionPlan } from "./motion-templates.js";
import type { MusicSegment } from "../../reels/loop.js";
import { placeMusicBed } from "./music-bed.js";

const TOOL = "build_reel_tool";

export interface MotionReelInput {
  style: MotionStyleId;
  /** Visual files, story order (validated). */
  ids: readonly string[];
  music: ProjectFile | null;
  beats: MusicBeats | null;
  /** The music's stretches when it loops to reach the asked length (reels/loop.ts). */
  loop?: readonly MusicSegment[];
  /** Tempo of the grid when there is no music (default: the style's). */
  fallbackBpm?: number;
  /** Receipt fields about where the beat grid came from. */
  beatInfo?: Record<string, unknown>;
  names: ReadonlyMap<string, string>;
  warnings: string[];
  args: {
    duration_seconds?: number;
    hook?: string;
    end_card?: string;
    end_card_subtitle?: string;
    labels?: string[];
    words?: string[];
  };
}

interface PlacedScene {
  scene: MotionScene;
  start: number;
  end: number;
  parts: { plan: MotionPlan; base: number; written: Map<string, ImportedMedia> }[];
}

function aspectName(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.02) return "vertical 9:16";
  if (Math.abs(ratio - 16 / 9) < 0.02) return "landscape 16:9";
  if (Math.abs(ratio - 1) < 0.02) return "square 1:1";
  if (Math.abs(ratio - 4 / 5) < 0.02) return "portrait 4:5";
  return `${width}×${height}`;
}

/** The lowest `count` tracks, adding tracks when the project has fewer. */
function lowestTracks(tx: Transaction, count: number): number[] {
  while (tx.project.layers.length < count) addTrack(tx, {});
  return [...tx.project.layers].map((l) => Number(l.number)).sort((a, b) => a - b).slice(0, count);
}

export async function buildMotionReel(call: ToolCall, input: MotionReelInput): Promise<ToolOutcome> {
  const project = call.doc.project;
  const style = MOTION_STYLES[input.style];
  const { args, warnings } = input;
  const width = Number(project.width) || 1920;
  const height = Number(project.height) || 1080;
  const rate = Number(project.fps?.num) / Number(project.fps?.den || 1);
  const fps = Number.isFinite(rate) && rate > 0 ? rate : 30;
  if (!call.host.media?.writeGenerated) return refused(TOOL, `Error: ${style.name} reels are drawn as generated SVG layers, and this Zenvi surface cannot store generated media.`);

  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const media: MotionMedia[] = [];
  for (const id of input.ids) {
    const m = motionMedia(files.get(id)!);
    if (typeof m === "string") return refused(TOOL, `Error: ${m}; ${style.name} reels show videos and photos.`);
    media.push(m);
  }
  const byId = new Map(media.map((m) => [m.fileId, m]));

  // The grid, the length and the bars, exactly as a footage reel plans them.
  const target = Math.max(2, args.duration_seconds ?? style.defaultSeconds);
  const grid = planReelGrid({ music: input.beats, seconds: target, fallbackBpm: input.fallbackBpm ?? style.defaultBpm, frameRate: fps });
  const duration = onFrameGrid(grid.duration, fps);
  const downs = grid.downbeats.filter((t) => t < duration - 0.05);
  if (downs.length === 0 || downs[0]! > 0.05) downs.unshift(0);
  const bounds = [...downs, duration];
  const scenes = storyboard({
    style: input.style,
    bars: downs.length,
    media,
    ...(args.hook ? { hook: args.hook } : {}),
    ...(args.end_card ? { endCard: args.end_card } : {}),
    ...(args.end_card_subtitle ? { endCardSubtitle: args.end_card_subtitle } : {}),
    ...(args.labels ? { labels: args.labels } : {}),
    ...(args.words ? { words: args.words } : {}),
  });

  // Every template's layers, generated and written before the edit is recorded.
  const beatGrid: BeatGrid = { bpm: grid.bpm, beats: grid.beats, downbeats: grid.downbeats };
  const placed: PlacedScene[] = [];
  let motionTracks = 0;
  for (const scene of scenes) {
    const start = onFrameGrid(bounds[scene.bar]!, fps);
    const end = onFrameGrid(bounds[Math.min(bounds.length - 1, scene.bar + scene.bars)]!, fps);
    if (end - start < 1 / fps) continue;
    const parts: PlacedScene["parts"] = [];
    let base = 0;
    for (const [i, part] of scene.templates.entries()) {
      let plan: MotionPlan;
      try {
        plan = buildMotionTemplate({ template: part.template, frame: { width, height, fps }, start, seconds: end - start, grid: beatGrid, palette: PALETTES[part.palette], media: byId, content: part.content });
      } catch (error) {
        if (error instanceof MotionInputError) return refused(TOOL, `Error: the ${scene.name} scene: ${error.message}.`);
        return failed(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      const written = new Map<string, ImportedMedia>();
      for (const layer of plan.layers) {
        if (layer.source.kind !== "svg") continue;
        const name = `reel-${scene.name}-${i + 1}-${layer.source.name}.svg`;
        try {
          const path = await call.host.media.writeGenerated(name, new TextEncoder().encode(layer.source.svg), "image/svg+xml");
          written.set(layer.name, { path, info: await call.host.media.probe(path), name });
        } catch (error) {
          return failed(TOOL, `Error: failed to write the reel's drawings: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      parts.push({ plan, base, written });
      base += plan.tracks;
    }
    motionTracks = Math.max(motionTracks, base);
    placed.push({ scene, start, end, parts });
  }

  const music = input.music;
  const built = call.commit((tx) => {
    if (tx.project.clips.length > 0) {
      for (const t of [...tx.project.effects]) removeTransition(tx, String(t.id));
      deleteClips(tx, tx.project.clips.map((c) => String(c.id)), { ripple: false });
    }
    const layers = lowestTracks(tx, (music ? 1 : 0) + motionTracks);
    const musicLayer = music ? layers[0]! : null;
    const motion = music ? layers.slice(1) : layers;
    if (music && musicLayer !== null) placeMusicBed(tx, String(music.id), grid.musicStart, duration, musicLayer, input.names.get(String(music.id)), input.loop);
    for (const { scene, start, parts } of placed) {
      for (const { plan, base, written } of parts) placeMotionPlan(tx, plan, written, start, fps, motion.slice(base, base + plan.tracks), `${style.name}: ${scene.name}`);
    }
    return { music: musicLayer, motion };
  }, `Build ${style.name.toLowerCase()} reel`);

  const round = (t: number) => Math.round(t * 1000) / 1000;
  const story = placed.map((p) => p.scene.name.replace(/-\d+$/, "")).filter((n, i, all) => all.indexOf(n) === i);
  const brief = {
    format: `${Math.round(duration * 10) / 10} seconds, ${aspectName(width, height)}`,
    story: story.join(", "),
    pace: `${style.pace} (${Math.round(grid.bpm)} BPM)`,
    look: style.look,
  };
  return applied(TOOL, `Built a ${style.name.toLowerCase()} reel: ${placed.length} scenes on ${Math.round(grid.bpm)} BPM, ${brief.format}. Length ${grid.lengthNote}.`, {
    warnings,
    data: {
      style: style.id,
      duration,
      bpm: grid.bpm,
      length_note: grid.lengthNote,
      ...input.beatInfo,
      music_file_id: music ? String(music.id) : null,
      music_start: grid.musicStart,
      beats: grid.beats.filter((t) => t <= duration + 1e-6),
      downbeats: grid.downbeats.filter((t) => t <= duration + 1e-6),
      scenes: placed.map((p) => ({ name: p.scene.name, start: round(p.start), end: round(p.end), templates: p.parts.map((x) => x.plan.template) })),
      tracks: { music: built.music, motion: built.motion },
      brief,
    },
  });
}
