/**
 * add_kinetic_title_tool: a title card that moves like the references'
 * type instead of fading: the kinetic captions' builder (captions/build.ts)
 * with the whole text as one group, its words revealed `stagger_seconds`
 * apart, so a title takes any caption animation (pop, slam, tilt,
 * typewriter, scramble, letters...) and stays native outlined-SVG clips
 * with keyframes. Scramble and letters move every word of a title, not only
 * the emphasis words. The clips and drawing files are tagged
 * `zenvi_kinetic_title`.
 */

import { z } from "zod";
import { buildKineticCaptions, type AvoidBox, type KineticCaptionPlan } from "../../captions/build.js";
import { CAPTION_ANIMATIONS, CAPTION_ANIMATION_IDS, CAPTION_STYLES, type CaptionAnimationId, type CaptionStyleId } from "../../captions/styles.js";
import type { ProjectFile } from "../../model/types.js";
import { updateFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import { captionScenes } from "../caption-scenes.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { loadFamilies } from "../fonts.js";
import { projectFps } from "../frame-time.js";
import { applied, failed, refused } from "../receipt.js";
import { colorHexAlpha, projectSize, trackInfo } from "../titles-text.js";
import { emphasisArg, kineticTag, matteOf } from "./kinetic-captions.js";
import { commitDrawn, placeMotionPlan, planOverlayStack, writeDrawings } from "./motion-templates.js";

const TOOL = "add_kinetic_title_tool";
const TRACK_LABEL = "Titles";
/** Tag on the clips and drawing files this tool makes. */
export const KINETIC_TITLE_KEY = "zenvi_kinetic_title";

const TITLE_STYLE_IDS = ["stack", "creator", "editorial", "documentary"] as const satisfies readonly CaptionStyleId[];
type TitleStyleId = (typeof TITLE_STYLE_IDS)[number];

/** Each title style's own entrance (the caption style's), named. */
const OWN_ANIMATION: Readonly<Record<TitleStyleId, CaptionAnimationId>> = { stack: "slide_up", creator: "pop", editorial: "rise", documentary: "fade" };
const STYLE_LINES: Readonly<Record<TitleStyleId, string>> = {
  stack: "condensed capitals (Bebas Neue), a word per line, left aligned",
  creator: "connectors in white Inter, the emphasis word huge red condensed capitals",
  editorial: "serif (Instrument Serif), the emphasis word italic in the accent",
  documentary: "a quiet line of Inter, shown at once",
};
const ANIMATION_LINES = CAPTION_ANIMATION_IDS.map((id) => `${id}: ${CAPTION_ANIMATIONS[id].summary}`).join("; ");
const unit = z.number().min(0).max(1);
/** A title is set larger than a caption in the same style: it is read at once, not word by word. */
const TITLE_SCALE: Readonly<Record<TitleStyleId, number>> = { stack: 1.5, creator: 1.6, editorial: 1.5, documentary: 1.5 };
const baseShare = (style: TitleStyleId): number => (CAPTION_STYLES[style].base.size / 1080) * TITLE_SCALE[style];
const share = (style: TitleStyleId): string => baseShare(style).toFixed(3).replace(/0+$/, "");

const input = z.strictObject({
  text: z.string().min(1).max(120).describe("The title, 1-12 words."),
  position_seconds: z.number().min(0).optional().describe("Timeline start, seconds (default 0)."),
  duration_seconds: z.number().min(0.4).max(30).optional().describe("How long it shows, seconds (default 2)."),
  style: z.enum(TITLE_STYLE_IDS).optional().describe(`Type (default stack): ${TITLE_STYLE_IDS.map((id) => `${id}: ${STYLE_LINES[id]}`).join("; ")}.`),
  animation: z.enum(CAPTION_ANIMATION_IDS).optional().describe(`How it enters (default the style's: stack slide_up, creator pop, editorial rise, documentary fade). ${ANIMATION_LINES}.`),
  stagger_seconds: z.number().min(0).max(1).optional().describe("Seconds between one word's entrance and the next (default 0.12; 0: all at once)."),
  emphasis: z
    .union([z.string().max(300), z.array(z.string().min(1).max(40)).max(12)])
    .optional()
    .describe("Words set in the emphasis face and accent: auto (default: the strongest word), none, or a list."),
  accent: z.string().max(40).optional().describe("Emphasis colour (#rrggbb or a name; default per style)."),
  ink: z.string().max(40).optional().describe("Colour of the other words (default white)."),
  text_size: z.number().min(0.015).max(0.3).optional().describe(`Size of the plain words, share of the frame's short side (style default: ${TITLE_STYLE_IDS.map((id) => `${id} ${share(id)}`).join(", ")}); emphasis words keep their ratio.`),
  y: unit.optional().describe("Vertical centre, 0 top - 1 bottom (default: the style's spots, in the shot's calmest area). Kept inside the title-safe area."),
  avoid: z
    .array(z.strictObject({ x: unit, y: unit, w: unit.gt(0), h: unit.gt(0) }))
    .max(8)
    .optional()
    .describe("Boxes to keep the title off, 0-1 of the frame (centre x, y and size w, h): a face, a product."),
});

type Input = z.infer<typeof input>;

export const kineticTitleTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Add kinetic title",
    description:
      "A title card whose words move like reference reels' type instead of fading: each word (or letter) its own outlined SVG title clip with keyframes, native and editable on every Zenvi surface. " +
      "Pick an animation (pop, slam, slide_up, rise, fade, tilt, typewriter, scramble, letters) and a style; words enter stagger_seconds apart, the emphasis word in the display face. Placed in the safe area over the shot's calm negative space. " +
      "One undo step. For speech use kinetic_captions_tool; for a word behind a person text_behind_subject_tool.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      if (!call.host.media?.writeGenerated) return unavailable(TOOL, "it cannot store the title's generated drawings.");
      if (!call.host.assets?.readBytes) return unavailable(TOOL, "it cannot read the bundled fonts the title is set in.");
      const project = call.doc.project;
      const style: TitleStyleId = args.style ?? "stack";
      const animation = args.animation ?? OWN_ANIMATION[style];
      const parts = args.text.split(/\s+/).filter(Boolean);
      if (parts.length > 12) return refused(TOOL, `Error: a title has at most 12 words (got ${parts.length}); split it into two titles.`);
      const colours: { ink?: string; accent?: string } = {};
      for (const key of ["ink", "accent"] as const) {
        if (args[key] === undefined) continue;
        try {
          colours[key] = colorHexAlpha(args[key], key)[0];
        } catch (error) {
          return refused(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}.`);
        }
      }
      const start = args.position_seconds ?? 0;
      const duration = args.duration_seconds ?? 2;
      // Every word is on screen for at least the last 40 % of the title.
      const stagger = Math.min(args.stagger_seconds ?? 0.12, (duration * 0.6) / Math.max(1, parts.length));
      const words = parts.map((text, i) => ({ text, start: start + i * stagger, end: start + (i + 1) * Math.max(stagger, 0.05) }));
      const spec = CAPTION_STYLES[style];
      const lib = await loadFamilies(call, [spec.base.family, spec.emphasis.family]);
      if (typeof lib === "string") return refused(TOOL, lib);

      const [width, height] = projectSize(project);
      const fpsFraction = projectFps(project);
      const fps = fpsFraction.num / fpsFraction.den;
      const scenes = await captionScenes(call, project, start, start + duration, (c) => kineticTag(c) !== undefined, (c) => matteOf(project, c));
      let built: KineticCaptionPlan;
      try {
        built = buildKineticCaptions({
          frame: { width, height, fps },
          words,
          style,
          emphasis: emphasisArg(args.emphasis),
          avoid: (args.avoid ?? []) as AvoidBox[],
          ...colours,
          size: (args.text_size ?? baseShare(style)) / (CAPTION_STYLES[style].base.size / 1080),
          ...(args.y !== undefined ? { y: args.y } : {}),
          motion: CAPTION_ANIMATIONS[animation].motion,
          groups: [{ first: 0, end: words.length, start, stop: start + duration }],
          letterWords: "all",
          scenes,
          lib,
        });
      } catch (error) {
        return failed(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      const warnings = built.missing.length > 0 ? [`no bundled font draws ${built.missing.join(" ")}; those characters are left out`] : [];
      const plan = built.plan;
      const end = built.start + plan.frames / fps;
      const stack = planOverlayStack(project, built.start, end, plan.tracks);
      const written = await writeDrawings(call, plan, `title-${animation}`);
      if (typeof written === "string") return failed(TOOL, written);
      const tag = { text: args.text, style, animation };
      const placed = await commitDrawn(
        call,
        written,
        (tx) => {
          const out = placeMotionPlan(tx, plan, written, built.start, fps, stack.layers, `Title ${animation}`, TRACK_LABEL);
          const files = new Set<string>();
          for (const p of out) {
            patchClip(tx, p.clip.id, { [KINETIC_TITLE_KEY]: tag });
            if (!files.has(p.fileId)) updateFile(tx, p.fileId, { [KINETIC_TITLE_KEY]: tag } as Partial<ProjectFile>);
            files.add(p.fileId);
          }
          return out;
        },
        `Add kinetic title (${animation})`,
      );
      const g = built.groups[0]!;
      const round = (t: number) => Math.round(t * 1000) / 1000;
      return applied(TOOL, `Added the title "${args.text}" (${style}, ${animation}) at ${built.start.toFixed(2)}-${end.toFixed(2)}s: ${placed.length} clip(s) on ${plan.tracks} track(s).`, {
        warnings,
        data: {
          style,
          animation,
          start: round(built.start),
          end: round(end),
          box: [g.box.x / width, g.box.y / height, g.box.width / width, g.box.height / height].map((v) => Math.round(v * 1000) / 1000),
          emphasis: g.words.filter((w) => w.emphasis).map((w) => w.text),
          tracks: stack.layers.map((layer) => trackInfo(call.doc.project, layer)),
          created_clip_ids: placed.map((p) => p.clip.id),
        },
      });
    },
  }),
];
