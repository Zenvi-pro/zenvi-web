/**
 * add_motion_template_tool: one motion-design template (motion/templates),
 * placed on the timeline in one undo step: its drawings written as SVG
 * titles, its media clips placed and keyframed, on the lowest free tracks
 * above the video, every entrance on the beat grid.
 *
 * The beat grid is `beats` (timeline seconds, e.g. build_reel_tool's
 * data.beats), else `bpm` from the timeline's start, else the beats of the
 * music already on the timeline (when the host can decode audio), else
 * 120 BPM.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { createLayer } from "../../model/defaults.js";
import { generateId, idFactory } from "../../model/ids.js";
import { isAudioOnlyMedia, isSingleImageMedia } from "../../model/media.js";
import { findLayer } from "../../model/query.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { addClip, setClipProperty, setClipSpeed } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import { placeOverlayClip } from "../../ops/overlays.js";
import { buildMotionTemplate } from "../../motion/build.js";
import { gridFromBeats, tempoGrid } from "../../motion/grid.js";
import { PALETTES, withAccent } from "../../motion/palettes.js";
import { MOTION_TEMPLATE_IDS, MotionInputError, type MotionContent, type MotionTemplateId } from "../../motion/template.js";
import { TEMPLATES } from "../../motion/templates/index.js";
import { PALETTE_IDS, type BeatGrid, type MotionLayer, type MotionMedia, type MotionPlan, type PaletteId } from "../../motion/types.js";
import { beatOverrideProblem } from "../beat-override.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import type { ImportedMedia } from "../types.js";
import { TRACK_STEP, clipsInWindow, colorHexAlpha, isLocked, planOverlayTrack, projectSize, snapToFrame, trackInfo } from "../titles-text.js";

const TOOL = "add_motion_template_tool";
const TRACK_LABEL = "Motion";

const DEFAULT_PALETTE: Readonly<Record<MotionTemplateId, PaletteId>> = {
  ui_cards: "ui_light",
  type_search: "ui_light",
  word_scroll: "ui_dark",
  crop_labels: "editorial",
  callout: "callout",
  kinetic_type: "editorial",
  step_card: "tutorial",
  grid_background: "ui_light",
  end_card: "ui_light",
};

const TEMPLATE_LINES = MOTION_TEMPLATE_IDS.map((id) => `${id}: ${TEMPLATES[id].summary} Reads ${TEMPLATES[id].reads}.`).join(" ");

const unit = z.number().min(0).max(1);

const input = z.strictObject({
  template: z.enum(MOTION_TEMPLATE_IDS).describe(`Which template. ${TEMPLATE_LINES}`),
  position_seconds: z.number().min(0).optional().describe("Timeline start, seconds (default 0). Entrances land on the beats after it."),
  duration_seconds: z.number().min(0.5).max(120).optional().describe("Length, seconds (default: the template's natural length in beats)."),
  palette: z.enum(PALETTE_IDS).optional().describe("Colours: ui_light, ui_dark, editorial (paper, ink, red, one blue), callout (dark, hot accent), tutorial (grid paper, ink, highlighter). Default per template."),
  accent: z.string().max(40).optional().describe("Replace the palette's accent colour (a brand colour): #rrggbb, #rgb, rgb(r,g,b) or a colour name."),
  bpm: z.number().min(40).max(400).optional().describe("Tempo of the beat grid, beats from the timeline's start or from offset_seconds (when there is no `beats`)."),
  offset_seconds: z.number().min(0).max(3600).optional().describe("With bpm: timeline seconds of the first beat (default 0)."),
  beats: z.array(z.number().min(0)).min(2).max(4000).optional().describe("Beat times on the timeline, seconds (build_reel_tool's data.beats, detect_beats_tool's beats moved to the music clip's position)."),
  text: z.string().max(200).optional().describe("Main text: the typed phrase (type_search), the headline (kinetic_type; * stands for an image tile), the title (end_card), the caption (step_card), the product name (callout)."),
  subtitle: z.string().max(120).optional().describe("A second line: end_card's subtitle, the text cards' line (ui_cards), the prompt above the search (type_search), a still header at the top (step_card)."),
  words: z.array(z.string().min(1).max(40)).max(12).optional().describe("word_scroll: the word list (2-10 words)."),
  file_ids: z.array(z.string().min(1)).max(8).optional().describe("Media-bin videos or photos: the cards (ui_cards), the shot (crop_labels), the product (callout), the step's footage (step_card), the image tiles (kinetic_type)."),
  labels: z.array(z.string().max(48)).max(8).optional().describe("Short labels: card captions (ui_cards), suggestions under the search (type_search), crop box labels (crop_labels), callout names (callout), corner labels (grid_background editorial)."),
  values: z.array(z.string().max(48)).max(8).optional().describe("callout: the second line of each callout (a spec, a number)."),
  points: z.array(z.strictObject({ x: unit, y: unit })).max(8).optional().describe("callout: anchor points on the product picture (0-1 from its top left); step_card: the point the label's arrow points at."),
  boxes: z.array(z.strictObject({ x: unit, y: unit, w: unit.gt(0), h: unit.gt(0) })).max(6).optional().describe("crop_labels: boxes on the frame (centre x, y and size w, h, 0-1). Default: a spread of boxes."),
  button: z.string().max(24).optional().describe("A button's label: type_search's search button, ui_cards' button the pointer clicks."),
  tag: z.string().max(32).optional().describe("A small tag: kinetic_type's (e.g. NO. 01), end_card plain's, step_card's label box, type_search's brand row, crop_labels' label prefix, callout's heading prefix (default ANATOMY)."),
  step: z.number().int().min(1).max(99).optional().describe("step_card: the step number."),
  highlight: z.number().int().min(0).max(30).optional().describe("kinetic_type: index of the word the highlighter marks."),
  variant: z.string().max(20).optional().describe("grid_background: paper | editorial | dots | plain; end_card: logo | save | plain."),
  align: z.enum(["left", "center"]).optional().describe("Text alignment (kinetic_type, end_card plain)."),
  position: z.enum(["top", "center", "bottom"]).optional().describe("Where the text sits (kinetic_type)."),
  backdrop: z.boolean().optional().describe("Draw the template's own background (end_card default true; type_search and word_scroll default false)."),
});

type Input = z.infer<typeof input>;

function displaySize(file: ProjectFile): { width: number; height: number } | null {
  const w = Number(file.width);
  const h = Number(file.height);
  if (!(w > 0 && h > 0)) return null;
  const ratio = file.pixel_ratio as { num?: number; den?: number } | undefined;
  const par = ratio && Number(ratio.num) > 0 && Number(ratio.den) > 0 ? Number(ratio.num) / Number(ratio.den) : 1;
  return { width: w * par, height: h };
}

/** A media-bin file as a template sees it, or why it cannot be shown. */
export function motionMedia(file: ProjectFile): MotionMedia | string {
  if (isAudioOnlyMedia(file)) return `${file.id} has no picture`;
  const size = displaySize(file);
  if (!size) return `${file.id} has no picture size`;
  const image = isSingleImageMedia(file);
  if (!image && !file.has_video) return `${file.id} has no picture`;
  return { fileId: String(file.id), kind: image ? "image" : "video", width: size.width, height: size.height, duration: image ? 0 : Number(file.duration) || 0 };
}

/** Beats of the music bed on the timeline (the longest audio-only clip), in timeline seconds. */
async function timelineMusicGrid(call: ToolCall, project: Project, warnings: string[]): Promise<BeatGrid | null> {
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const beds = project.clips
    .filter((c) => {
      const file = files.get(String(c.file_id));
      return file !== undefined && isAudioOnlyMedia(file);
    })
    .sort((a, b) => b.end - b.start - (a.end - a.start));
  const bed = beds[0];
  if (!bed || !canTrackBeats(call)) return null;
  const tracked = await beatsOfFile(call, files.get(String(bed.file_id))!);
  if (typeof tracked === "string") {
    warnings.push(`${tracked} The template follows 120 BPM instead.`);
    return null;
  }
  const onTimeline = (t: number) => bed.position + (t - bed.start);
  const inClip = (t: number) => t >= bed.start - 1e-6 && t <= bed.end + 1e-6;
  const beats = tracked.beats.map((b) => b.timeSec).filter(inClip).map(onTimeline);
  if (beats.length < 2) return null;
  return gridFromBeats(beats, tracked.downbeats.map((d) => d.timeSec).filter(inClip).map(onTimeline));
}

/**
 * `count` tracks for a template shown over [start, end), bottom to top: the
 * lowest free unlocked track above every picture there (planOverlayTrack),
 * then the free tracks above it, then new tracks on top.
 */
export function planOverlayStack(project: Project, start: number, end: number, count: number): { layers: number[]; created: number[] } {
  const first = planOverlayTrack(project, start, end, undefined);
  const layers = [first.layer];
  const created = first.created ? [first.layer] : [];
  const numbers = project.layers.map((l) => Math.trunc(Number(l.number) || 0)).sort((a, b) => a - b);
  let top = Math.max(first.layer, ...numbers);
  for (let i = 1; i < count; i += 1) {
    const below = layers[i - 1]!;
    const next = created.length === 0 ? numbers.find((n) => n > below && !isLocked(project, n) && clipsInWindow(project, n, start, end).length === 0) : undefined;
    if (next !== undefined) layers.push(next);
    else {
      top += TRACK_STEP;
      layers.push(top);
      created.push(top);
    }
  }
  return { layers, created };
}

function ensureTrack(tx: Transaction, layer: number): void {
  if (findLayer(tx.project, layer)) return;
  const id = generateId((candidate) => tx.project.layers.some((l) => l.id === candidate));
  tx.insert(["layers"], createLayer(layer, id, TRACK_LABEL));
}

/** Prepared drawing files, by layer name. */
type Written = Map<string, ImportedMedia>;

async function writeDrawings(call: ToolCall, plan: MotionPlan, prefix: string): Promise<Written | string> {
  const media = call.host.media!;
  const out: Written = new Map();
  for (const layer of plan.layers) {
    if (layer.source.kind !== "svg") continue;
    const name = `${prefix}-${layer.source.name}.svg`;
    try {
      const path = await media.writeGenerated!(name, new TextEncoder().encode(layer.source.svg), "image/svg+xml");
      out.set(layer.name, { path, info: await media.probe(path), name });
    } catch (error) {
      return `Error: could not write the template's drawing ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return out;
}

/** Place a plan's layers (inside a transaction). Returns the clip of each layer. */
export function placeMotionPlan(tx: Transaction, plan: MotionPlan, written: Written, position: number, fps: number, tracks: readonly number[], title: string): { layer: MotionLayer; clip: Clip; fileId: string }[] {
  for (const layer of tracks) ensureTrack(tx, layer);
  const nextId = idFactory(tx.project);
  const placed: { layer: MotionLayer; clip: Clip; fileId: string }[] = [];
  for (const layer of plan.layers) {
    const at = position + layer.start / fps;
    const seconds = layer.frames / fps;
    const track = tracks[layer.track]!;
    const effects = layer.effects.map((e) => ({ ...e, id: nextId() }));
    const clipTitle = `${title} ${layer.name}`;
    if (layer.source.kind === "svg") {
      const file = addFile(tx, written.get(layer.name)!, { mediaType: "image" });
      const clip = placeOverlayClip(tx, { fileId: String(file.id), position: at, duration: seconds, layer: track, title: clipTitle, props: { ...layer.props, ...(effects.length > 0 ? { effects } : {}) } });
      placed.push({ layer, clip, fileId: String(file.id) });
    } else {
      const src = layer.source;
      const clip = addClip(tx, { fileId: src.fileId, position: at, layer: track, start: src.start, end: src.end, title: clipTitle });
      if (src.speed < 0.999) setClipSpeed(tx, clip.id, src.speed);
      if (!src.sound) setClipProperty(tx, clip.id, "volume", 0);
      const after = patchClip(tx, clip.id, { ...structuredClone(layer.props), ...(effects.length > 0 ? { effects } : {}) });
      placed.push({ layer, clip: after, fileId: src.fileId });
    }
  }
  return placed;
}

export const motionTemplateTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Add a motion template",
    description:
      "Place one motion-design template on the timeline, timed to the beat: UI cards that slide in with depth, a search field that types, a scrolling word list with a selection box, " +
      "labelled crop boxes over a shot, a product callout with leader lines, kinetic type with image tiles, a tutorial step card, a grid background or an end card. " +
      "Drawings are SVG titles and the media plays inside them, all animated with clip keyframes, so the result renders the same on every Zenvi surface and stays editable. " +
      "One undo step; the layers go on the lowest free tracks above the video. For a whole motion-led video use build_reel_tool with a motion style (ui_promo, editorial_motion, product_callout, tutorial).",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      if (!call.host.media?.writeGenerated) return unavailable(TOOL, "it cannot store the template's generated drawings.");
      const project = call.doc.project;
      const files = new Map(project.files.map((f) => [String(f.id), f]));
      const media = new Map<string, MotionMedia>();
      for (const id of args.file_ids ?? []) {
        const file = files.get(id);
        if (!file) return refused(TOOL, `Error: unknown file id ${id}.`);
        const m = motionMedia(file);
        if (typeof m === "string") return refused(TOOL, `Error: ${m}; give a video or a photo.`);
        media.set(id, m);
      }
      const content: MotionContent = {
        ...(args.text !== undefined ? { text: args.text } : {}),
        ...(args.subtitle !== undefined ? { subtitle: args.subtitle } : {}),
        ...(args.words ? { words: args.words } : {}),
        ...(args.file_ids ? { fileIds: args.file_ids } : {}),
        ...(args.labels ? { labels: args.labels } : {}),
        ...(args.values ? { values: args.values } : {}),
        ...(args.points ? { points: args.points } : {}),
        ...(args.boxes ? { boxes: args.boxes } : {}),
        ...(args.button !== undefined ? { button: args.button } : {}),
        ...(args.tag !== undefined ? { tag: args.tag } : {}),
        ...(args.step !== undefined ? { step: args.step } : {}),
        ...(args.highlight !== undefined ? { highlight: args.highlight } : {}),
        ...(args.variant !== undefined ? { variant: args.variant } : {}),
        ...(args.align ? { align: args.align } : {}),
        ...(args.position ? { position: args.position } : {}),
        ...(args.backdrop !== undefined ? { backdrop: args.backdrop } : {}),
      };
      const [width, height] = projectSize(project);
      const fps = Number(project.fps?.num) / Number(project.fps?.den || 1) || 30;
      const frame = { width, height, fps };
      const start = snapToFrame(project, args.position_seconds ?? 0);
      let accent: string | undefined;
      if (args.accent) {
        try {
          accent = colorHexAlpha(args.accent, "accent")[0];
        } catch (error) {
          return refused(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}.`);
        }
      }
      const palette = withAccent(PALETTES[args.palette ?? DEFAULT_PALETTE[args.template]], accent);

      const warnings: string[] = [];
      const problem = beatOverrideProblem(args);
      if (problem) return refused(TOOL, problem);
      let grid: BeatGrid | null = null;
      let gridSource: string;
      if (args.beats) {
        grid = gridFromBeats(args.beats);
        gridSource = "the given beats";
      } else if (args.bpm) {
        gridSource = args.offset_seconds ? `${args.bpm} BPM from ${args.offset_seconds} s` : `${args.bpm} BPM`;
      } else {
        grid = await timelineMusicGrid(call, project, warnings);
        gridSource = grid ? "the music on the timeline" : "120 BPM";
      }

      // A steady grid from the timeline's start, long enough for any template.
      grid ??= tempoGrid(args.bpm ?? 120, start + (args.duration_seconds ?? 0) + 130, args.offset_seconds ?? 0);
      let plan: MotionPlan;
      try {
        plan = buildMotionTemplate({ template: args.template, frame, start, seconds: args.duration_seconds, grid, palette, media, content });
      } catch (error) {
        if (error instanceof MotionInputError) return refused(TOOL, `Error: ${error.message}.`);
        return failed(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      const end = start + plan.frames / fps;
      const stack = planOverlayStack(project, start, end, plan.tracks);
      const written = await writeDrawings(call, plan, args.template);
      if (typeof written === "string") return failed(TOOL, written);

      const placed = call.commit((tx) => placeMotionPlan(tx, plan, written, start, fps, stack.layers, `Motion ${args.template}`), `Add motion template ${args.template}`);
      const doc = call.doc.project;
      const g = grid;
      const beatsIn = g.beats.filter((t) => t >= start - 1e-6 && t <= end + 1e-6);
      const round = (t: number) => Math.round(t * 1000) / 1000;
      return applied(TOOL, `Added ${args.template} at ${start.toFixed(2)}-${end.toFixed(2)}s on ${plan.tracks} track(s), entrances on ${gridSource}.`, {
        warnings,
        data: {
          template: args.template,
          position: round(start),
          duration: round(end - start),
          frames: plan.frames,
          palette: palette.name,
          bpm: Math.round(g.bpm * 10) / 10,
          beats: beatsIn.map(round),
          cues: plan.cues.map((f) => round(start + f / fps)),
          tracks: stack.layers.map((layer) => trackInfo(doc, layer)),
          new_tracks: stack.created.length,
          layers: placed.map(({ layer, clip, fileId }) => ({
            name: layer.name,
            timeline_clip_id: clip.id,
            file_id: fileId,
            kind: layer.source.kind,
            track: trackInfo(doc, Number(clip.layer)).track,
            start: round(Number(clip.position)),
            end: round(Number(clip.position) + Number(clip.end) - Number(clip.start)),
          })),
        },
      });
    },
  }),
];
