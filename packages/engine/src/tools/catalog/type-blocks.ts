/**
 * add_type_block_tool: the typographic moves the kinetic title and the
 * motion templates cannot make, as native outlined-SVG title clips with
 * keyframes (motion/typeblocks): text on a path (a spinning ring, an arc,
 * a wave), a write-on (strokes drawn along their paths by a Mask time
 * map, then filled), a stencil (the title cut out of a card over the shot,
 * flying through a letter), an echo stack (copies that build and collapse)
 * and a type strobe (a word per hit on flipping full-bleed cards, ending on
 * a lockup). One undo step; the clips and drawings are tagged
 * `zenvi_type_block`.
 */

import { z } from "zod";
import type { ProjectFile } from "../../model/types.js";
import { updateFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import {
  ECHO_STYLES,
  PATH_SHAPES,
  STENCIL_OPENS,
  STROBE_LAYOUTS,
  TypeBlockError,
  buildEchoStack,
  buildPathText,
  buildStencil,
  buildStrobe,
  buildPaper,
  buildWheel,
  buildWriteOn,
  type TypeBlockBase,
  type TypeBlockOutput,
} from "../../motion/typeblocks/index.js";
import { bundledFamily, type FontFamilyId } from "../../typography/families.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { FONT_FAMILY_LIST, loadFamilies, missingGlyphWarnings, unknownFamily } from "../fonts.js";
import { ASSET_KEY, generatedSvg, maskReaderOf } from "../mattes.js";
import { applied, failed, refused } from "../receipt.js";
import { colorHexAlpha, projectSize, snapToFrame, trackInfo } from "../titles-text.js";
import { commitDrawn, discardDrawings, placeMotionPlan, planOverlayStack, writeDrawings } from "./motion-templates.js";

const TOOL = "add_type_block_tool";
const TRACK_LABEL = "Titles";
/** Tag on the clips and drawing files this tool makes. */
export const TYPE_BLOCK_KEY = "zenvi_type_block";

const BLOCKS = ["text_on_path", "write_on", "stencil", "echo_stack", "strobe", "wheel", "paper"] as const;
type Block = (typeof BLOCKS)[number];

const BLOCK_LINES: Readonly<Record<Block, string>> = {
  text_on_path: "one line set along a ring (spins), an arc or a wave; caps with separators (·) read best on a ring",
  write_on: "the text's outlines (or your SVG paths: a signature, an underline, an arrow, an icon) draw on along their paths, then the fill comes up",
  stencil: "the text cut out of a full-frame card so the shot below plays inside the letters, a soft shadow in the cuts; it pushes in, then flies through a letter (open zoom) or cuts to the shot (open cut)",
  echo_stack: "copies of one line up and down the frame, the echoes outlined, arriving gap_frames apart from the centre out, then collapsing into the centre line",
  strobe: "a word per hit on full-bleed cards hard-cut every hold_frames (or on beats), ground and ink flipping, the layout changing each cut (fit, bleed, outline, mirror, tall, stack), ending on a held lockup",
  wheel: "words on a turning drum (a word flipper): it snaps from one word to the next every hold_frames (or on beats), the lines squashed, dimmed and blurred as they turn away; it rests on the last word",
  paper: "type cut from paper (ink is the paper, accent the cut edge; the marks take accent, else the paper's colour) with a drop shadow, boiling like stop motion on twos, hand-drawn marks orbiting it",
};

const FAMILY: Readonly<Record<Block, FontFamilyId>> = {
  text_on_path: "archivo-black",
  write_on: "instrument-serif",
  stencil: "anton",
  echo_stack: "anton",
  strobe: "anton",
  wheel: "archivo-black",
  paper: "archivo-black",
};

const DURATION: Readonly<Record<Exclude<Block, "strobe" | "wheel">, number>> = { text_on_path: 3, write_on: 2.5, stencil: 2.4, echo_stack: 1.8, paper: 2.4 };

const unit = z.number().min(0).max(1);

const input = z.strictObject({
  block: z.enum(BLOCKS).describe(`Which move. ${BLOCKS.map((b) => `${b}: ${BLOCK_LINES[b]}`).join("; ")}.`),
  text: z.string().max(200).optional().describe("The type: the ring's line, the words to write, the stencil title (1-2 words), the echoed line, or the strobe's words (split at spaces when there is no `words`)."),
  position_seconds: z.number().min(0).optional().describe("Timeline start, seconds (default 0)."),
  duration_seconds: z.number().min(0.2).max(30).optional().describe("Length, seconds (default: text_on_path 3, write_on 2.5, stencil 2.4, echo_stack 1.8, paper 2.4, strobe the words' holds + 1.2 s of lockup, wheel its turns + 1 s)."),
  font_family: z.string().max(40).optional().describe(`A bundled family, drawn as outlines (same on every surface): ${FONT_FAMILY_LIST}. Default: write_on instrument-serif; text_on_path, wheel and paper archivo-black; the others anton.`),
  font_weight: z.number().int().min(100).max(900).optional().describe("Weight for families that have several (inter): 100-900."),
  ink: z.string().max(40).optional().describe("Colour of the type (default white; paper: the paper, default cream)."),
  ground: z.string().max(40).optional().describe("stencil: the card's colour (default near-black); strobe: the first ground (default near-black; it flips with ink and accent)."),
  accent: z.string().max(40).optional().describe("strobe: the third ground (default #ff3b1f); paper: the cut edge and the marks (default near-black)."),
  text_size: z.number().min(0.02).max(1).optional().describe("Em size as a share of the frame's short side (default: fitted to the block)."),
  x: unit.optional().describe("text_on_path, write_on, wheel, paper: horizontal centre, 0 left - 1 right (default 0.5)."),
  y: unit.optional().describe("text_on_path, write_on, stencil, wheel, paper: vertical centre, 0 top - 1 bottom (default 0.5)."),
  shape: z.enum(PATH_SHAPES).optional().describe("text_on_path: ring (default; the line closes on itself), arc (over the centre), wave (across the frame)."),
  radius: z.number().min(0.05).max(0.6).optional().describe("text_on_path ring/arc: radius as a share of the short side (default 0.3)."),
  spin: z.number().min(-720).max(720).optional().describe("text_on_path ring/arc: degrees per second, clockwise (default: ring 40, arc 0)."),
  paths: z.array(z.string().min(1).max(20000)).min(1).max(24).optional().describe("write_on: SVG path data (the `d` of each path), drawn one after another in order; instead of text."),
  view_box: z.tuple([z.number(), z.number(), z.number().gt(0), z.number().gt(0)]).optional().describe("write_on paths: their viewBox [min x, min y, width, height] (default: their bounds)."),
  width: z.number().min(0.05).max(1).optional().describe("write_on paths: width on the frame, share of the frame's width (default 0.6)."),
  stroke_width: z.number().min(0.5).max(80).optional().describe("write_on: stroke width, px at 1080 (default 3 % of the letter size; paths 1 % of the short side)."),
  fill: z.boolean().optional().describe("write_on: fill the shapes once drawn (default: text yes, paths no)."),
  draw_seconds: z.number().min(0.1).max(20).optional().describe("write_on: seconds the strokes take (default 60 % of the block with a fill, 80 % without)."),
  open: z.enum(STENCIL_OPENS).optional().describe("stencil: zoom (default: flies through the fattest letter into the shot in the last 0.5 s), cut (the card cuts away on the last frame), hold (stays)."),
  shadow: z.boolean().optional().describe("stencil: the soft shadow inside the cuts (default true)."),
  copies: z.number().int().min(3).max(13).optional().describe("echo_stack: copies including the centre line, odd (default 7)."),
  echo: z.enum(ECHO_STYLES).optional().describe("echo_stack: outline (default: echoes as outlines) or solid (dimmer fills)."),
  gap_frames: z.number().int().min(1).max(12).optional().describe("echo_stack: frames between one pair of copies and the next (default 2)."),
  words: z.array(z.string().min(1).max(40)).min(1).max(40).optional().describe("strobe: the words, one per cut; wheel: the drum's lines in order, 2-12 (default: text split at spaces)."),
  lockup: z.string().max(80).optional().describe("strobe: the held end card (default: the whole text; empty string: none, the last word holds)."),
  hold_frames: z.number().int().min(1).max(90).optional().describe("strobe: frames each word holds (default 4, ~0.13 s at 30 fps: a strobe; 8-12 for a staccato list); wheel: frames each word rests before the drum turns (default 0.7 s); paper: frames per stop-motion pose (default 2)."),
  beats: z.array(z.number().min(0)).min(2).max(400).optional().describe("strobe: timeline seconds to cut on instead of hold_frames (detect_beats_tool's beats moved to the music's position); a word per beat from the first one at or after position_seconds, the lockup on the next. wheel: the drum turns on these beats (the first n-1 after position_seconds)."),
  seed: z.number().int().min(0).max(2 ** 31).optional().describe("paper: seed of the boil (default 1): the same seed boils the same."),
  marks: z.boolean().optional().describe("paper: the hand-drawn marks orbiting the word (default true)."),
  layouts: z.array(z.enum(STROBE_LAYOUTS)).min(1).max(12).optional().describe(`strobe: layouts cycled cut by cut (default all: ${STROBE_LAYOUTS.join(", ")}).`),
});

type Input = z.infer<typeof input>;

/** Arguments each block reads (the common ones aside). */
const OWN: Readonly<Record<Block, readonly (keyof Input)[]>> = {
  text_on_path: ["x", "y", "shape", "radius", "spin"],
  write_on: ["x", "y", "paths", "view_box", "width", "stroke_width", "fill", "draw_seconds"],
  stencil: ["y", "ground", "open", "shadow"],
  echo_stack: ["copies", "echo", "gap_frames"],
  strobe: ["ground", "accent", "words", "lockup", "hold_frames", "beats", "layouts"],
  wheel: ["x", "y", "words", "hold_frames", "beats"],
  paper: ["x", "y", "accent", "hold_frames", "seed", "marks"],
};
const COMMON: readonly (keyof Input)[] = ["block", "text", "position_seconds", "duration_seconds", "font_family", "font_weight", "ink", "text_size"];

export const typeBlockTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Add a type block",
    description:
      "Typographic moves as native, editable title clips (outlined glyphs moved by keyframes; same on every Zenvi surface): " +
      "text_on_path (a spinning ring of type, an arc, a wave), write_on (outlines or SVG paths drawn on stroke by stroke, then filled), stencil (the title as a window into the shot below, flying through a letter), " +
      "echo_stack (copies that build out from the centre and collapse), strobe (a word every few frames on flipping full-bleed cards, ending on a lockup), " +
      "wheel (a drum of words that snaps from one to the next), paper (paper-cut type boiling like stop motion, marks orbiting it). " +
      "Put the footage on the timeline first for stencil (it shows inside the letters). data.hits lists the timeline seconds where a sound should land. One undo step. For word-by-word titles use add_kinetic_title_tool.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      if (!call.host.media?.writeGenerated) return unavailable(TOOL, "it cannot store the block's generated drawings.");
      if (!call.host.assets?.readBytes) return unavailable(TOOL, "it cannot read the bundled fonts the block is set in.");
      const block = args.block;
      const stray = (Object.keys(args) as (keyof Input)[]).filter((k) => args[k] !== undefined && !COMMON.includes(k) && !OWN[block].includes(k));
      if (stray.length > 0) return refused(TOOL, `Error: ${stray.join(", ")} do not apply to ${block} (it reads ${[...OWN[block]].join(", ")}).`);
      if (block !== "strobe" && block !== "wheel" && !(block === "write_on" && args.paths) && !args.text?.trim()) return refused(TOOL, `Error: ${block} needs text.`);
      const colour = (value: string | undefined, fallback: string, what: string): string => (value === undefined ? fallback : colorHexAlpha(value, what)[0]);
      let ink: string;
      let ground: string;
      let accent: string;
      try {
        ink = colour(args.ink, "#ffffff", "ink");
        ground = colour(args.ground, "#0a0a0a", "ground");
        accent = colour(args.accent, "#ff3b1f", "accent");
      } catch (error) {
        return refused(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}.`);
      }
      let family: FontFamilyId = FAMILY[block];
      if (args.font_family !== undefined) {
        const named = bundledFamily(args.font_family);
        if (!named) return refused(TOOL, unknownFamily(args.font_family));
        family = named;
      }
      const lib = await loadFamilies(call, [family]);
      if (typeof lib === "string") return refused(TOOL, lib);

      const project = call.doc.project;
      const [width, height] = projectSize(project);
      const fps = Number(project.fps?.num) / Number(project.fps?.den || 1) || 30;
      const frame = { width, height, fps };
      const short = Math.min(width, height);
      const scale = short / 1080;
      const start = snapToFrame(project, args.position_seconds ?? 0);
      const size = args.text_size !== undefined ? args.text_size * short : undefined;
      const listed = block === "strobe" || block === "wheel";
      const words = listed ? (args.words ?? (args.text ?? "").split(/\s+/).filter(Boolean)) : [];
      if (listed && words.length === 0) return refused(TOOL, `Error: ${block} needs words or text.`);
      if (block === "wheel" && (words.length < 2 || words.length > 12)) return refused(TOOL, `Error: wheel takes 2-12 words (got ${words.length}).`);

      // The strobe's cuts: on the given beats, or every hold_frames.
      let starts: number[] = [];
      let frames: number;
      const warnings: string[] = [];
      if (block === "strobe") {
        if (args.beats) {
          const ahead = [...args.beats].sort((a, b) => a - b).filter((t) => t >= start - 1e-6);
          const marks = [...new Set(ahead.map((t) => Math.round((t - start) * fps)))];
          if (marks.length < words.length + 1) return refused(TOOL, `Error: strobe needs ${words.length + 1} beats at or after ${start.toFixed(2)} s (one per word and one for the lockup); got ${marks.length}.`);
          // The first word lands on the first beat: the block starts there.
          starts = marks.slice(0, words.length + 1).map((f) => f - marks[0]!);
        } else {
          const hold = args.hold_frames ?? 4;
          starts = Array.from({ length: words.length + 1 }, (_, i) => i * hold);
        }
        const lockFrames = Math.round((args.lockup === "" ? 0.4 : 1.2) * fps);
        frames = args.duration_seconds !== undefined ? Math.round(args.duration_seconds * fps) : starts.at(-1)! + lockFrames;
        if (frames <= starts[words.length - 1]!) return refused(TOOL, `Error: ${words.length} words need more than ${(starts[words.length - 1]! / fps).toFixed(2)} s; give a longer duration_seconds or fewer words.`);
        if (frames < starts.at(-1)! + Math.round(0.3 * fps) && args.lockup !== "") warnings.push("the lockup shows for under 0.3 s; give a longer duration_seconds");
      } else if (block === "wheel") {
        const turn = Math.max(2, Math.round(0.32 * fps));
        if (args.beats) {
          const ahead = [...new Set([...args.beats].sort((a, b) => a - b).filter((t) => t > start + 1e-6).map((t) => Math.round((t - start) * fps)))].filter((f) => f >= 1);
          if (ahead.length < words.length - 1) return refused(TOOL, `Error: wheel needs ${words.length - 1} beats after ${start.toFixed(2)} s (one per turn); got ${ahead.length}.`);
          starts = ahead.slice(0, words.length - 1);
        } else {
          const hold = args.hold_frames ?? Math.round(0.7 * fps);
          starts = Array.from({ length: words.length - 1 }, (_, i) => (i + 1) * hold + i * turn);
        }
        frames = args.duration_seconds !== undefined ? Math.round(args.duration_seconds * fps) : starts.at(-1)! + turn + Math.round(1 * fps);
      } else {
        frames = Math.max(2, Math.round((args.duration_seconds ?? DURATION[block]) * fps));
      }
      const blockStart = block === "strobe" && args.beats ? snapToFrame(project, [...args.beats].sort((a, b) => a - b).find((t) => t >= start - 1e-6)!) : start;
      const base: TypeBlockBase = { frame, frames, lib, family, ...(args.font_weight !== undefined ? { weight: args.font_weight } : {}) };
      const cx = (args.x ?? 0.5) * width;
      const cy = (args.y ?? 0.5) * height;
      let out: TypeBlockOutput;
      try {
        switch (block) {
          case "text_on_path": {
            const shape = args.shape ?? "ring";
            out = buildPathText({ ...base, text: args.text!, shape, ink, x: cx, y: cy, radius: (args.radius ?? 0.3) * short, ...(size !== undefined ? { size } : {}), spin: args.spin ?? (shape === "ring" ? 40 : 0) });
            break;
          }
          case "write_on":
            out = buildWriteOn({
              ...base,
              ...(args.paths ? { paths: args.paths } : { text: args.text! }),
              ...(args.view_box ? { viewBox: args.view_box } : {}),
              ink,
              x: cx,
              y: cy,
              ...(size !== undefined ? { size } : {}),
              ...(args.width !== undefined ? { width: args.width * width } : {}),
              ...(args.stroke_width !== undefined ? { stroke: args.stroke_width * scale } : {}),
              ...(args.fill !== undefined ? { fill: args.fill } : {}),
              ...(args.draw_seconds !== undefined ? { draw: args.draw_seconds } : {}),
            });
            break;
          case "stencil":
            out = buildStencil({ ...base, text: args.text!, ground, open: args.open ?? "zoom", shadow: args.shadow ?? true, ...(size !== undefined ? { size } : {}), ...(args.y !== undefined ? { y: cy } : {}) });
            break;
          case "echo_stack":
            out = buildEchoStack({ ...base, text: args.text!, ink, copies: args.copies ?? 7, echo: args.echo ?? "outline", gap: args.gap_frames ?? 2, ...(size !== undefined ? { size } : {}) });
            break;
          case "wheel":
            out = buildWheel({ ...base, words, steps: starts, ink, x: cx, y: cy, ...(size !== undefined ? { size } : {}) });
            break;
          case "paper":
            out = buildPaper({
              ...base,
              text: args.text!,
              paper: colour(args.ink, "#f4efe6", "ink"),
              edge: colour(args.accent, "#1a1a1a", "accent"),
              ink: colour(args.accent ?? args.ink, "#f4efe6", "accent"),
              x: cx,
              y: cy,
              ...(size !== undefined ? { size } : {}),
              hold: args.hold_frames ?? 2,
              seed: args.seed ?? 1,
              marks: args.marks ?? true,
            });
            break;
          case "strobe":
            out = buildStrobe({ ...base, words, starts, lockup: args.lockup ?? (args.words ? (args.text ?? "") : words.join(" ")), ground, ink, accent, layouts: args.layouts ?? STROBE_LAYOUTS });
            break;
        }
      } catch (error) {
        if (error instanceof TypeBlockError) return refused(TOOL, `Error: ${error.message}.`);
        return failed(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      warnings.push(...out.warnings, ...missingGlyphWarnings(out.missing));

      const plan = out.plan;
      const end = blockStart + plan.frames / fps;
      const stack = planOverlayStack(project, blockStart, end, plan.tracks);
      const prefix = `type-${block.replace(/_/g, "-")}`;
      const written = await writeDrawings(call, plan, prefix);
      if (typeof written === "string") return failed(TOOL, written);
      try {
        for (const m of out.masks) {
          const asset = await generatedSvg(call, `${prefix}-${m.name}`, m.svg);
          const layer = plan.layers.find((l) => l.name === m.layer);
          if (!layer) throw new Error(`no layer ${m.layer} for mask ${m.name}`);
          layer.effects = [...layer.effects, { ...m.effect, mask_reader: maskReaderOf(asset), [ASSET_KEY]: asset.hash }];
        }
      } catch (error) {
        await discardDrawings(call, [...written.values()].map((m) => m.path));
        return failed(TOOL, `Error: could not write the block's mask drawing: ${error instanceof Error ? error.message : String(error)}`);
      }
      const tag = { block, ...(args.text ? { text: args.text } : {}) };
      const placed = await commitDrawn(
        call,
        written,
        (tx) => {
          const placedClips = placeMotionPlan(tx, plan, written, blockStart, fps, stack.layers, `Type ${block}`, TRACK_LABEL);
          const files = new Set<string>();
          for (const p of placedClips) {
            patchClip(tx, p.clip.id, { [TYPE_BLOCK_KEY]: tag });
            if (!files.has(p.fileId)) updateFile(tx, p.fileId, { [TYPE_BLOCK_KEY]: tag } as Partial<ProjectFile>);
            files.add(p.fileId);
          }
          return placedClips;
        },
        `Add type block (${block.replace(/_/g, " ")})`,
      );
      const round = (t: number) => Math.round(t * 1000) / 1000;
      const doc = call.doc.project;
      return applied(TOOL, `Added ${block} at ${blockStart.toFixed(2)}-${end.toFixed(2)}s: ${placed.length} clip(s) on ${plan.tracks} track(s).`, {
        warnings,
        data: {
          block,
          family,
          start: round(blockStart),
          end: round(end),
          hits: out.hits.map((f) => round(blockStart + f / fps)),
          tracks: stack.layers.map((layer) => trackInfo(doc, layer)),
          new_tracks: stack.created.length,
          created_clip_ids: placed.map((p) => p.clip.id),
        },
      });
    },
  }),
];
