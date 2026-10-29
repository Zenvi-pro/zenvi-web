/**
 * The creative brief: step 0 of every whole-video edit
 * (plugins/zenvi/skills/zenvi-styles/BRIEF.md). The agent compiles it from
 * the person's first prompt and the media inventory, saves it with
 * save_brief_tool, and the review and finish receipts check the edit against
 * it, so a run that drifts from its own plan hears about it.
 *
 * Kept in the project's `settings` under `zenvi_brief` (next to the master
 * mark; the desktop keeps unknown settings), inside the undo history: saving
 * a brief is one step. Undoing it restores the settings as they were, so a
 * master mark written after the brief goes with it and the edit reads as
 * unmastered: the safe side. Sizes are bounded because a brief can arrive
 * from a network client.
 */

import { z } from "zod";
import type { Project } from "../model/types.js";

/** The `settings` key a saved brief lives under. */
export const BRIEF_KEY = "zenvi_brief";

export const BRIEF_ASPECTS = ["9:16", "16:9", "1:1", "4:5"] as const;
export type BriefAspect = (typeof BRIEF_ASPECTS)[number];

const line = (max: number) => z.string().trim().min(1).max(max);
/** Times may arrive as strings from the Assistant (tool arguments are text there). */
const seconds = z.coerce.number().min(0).max(3600);

export const briefTechniqueSchema = z.strictObject({
  id: line(80).describe("Technique id from the styles index (techniques/<id>.md), e.g. flash-frames."),
  why: line(240).describe("Why this piece borrows it: the moment it serves."),
  tools: z.array(line(80)).max(6).optional().describe("The Zenvi tools that build it (the index's tools column), so review can see it on the timeline."),
});

export const briefBeatSchema = z.strictObject({
  start: seconds.describe("Timeline seconds the beat starts."),
  end: seconds.describe("Timeline seconds it ends."),
  name: line(60).describe("hook, problem, proof, drop, end card..."),
  does: line(240).optional().describe("What the viewer sees and feels."),
});

export const BRIEF_SOURCES = ["media", "stock", "generate", "motion", "3d", "title"] as const;

export const briefShotSchema = z.strictObject({
  beat: line(60).optional().describe("The beat's name."),
  source: z.enum(BRIEF_SOURCES).describe("media (the person's file), stock (fetch), generate (AI image or video), motion (a motion block), 3d (a 3D scene), title (type only)."),
  file_id: line(40).optional().describe("The media-bin file id when source is media."),
  note: line(240).describe("The shot: framing, action, query or prompt."),
});

/** One storyboard row; the last four columns exist to make repetition visible before the edit (Tweenkit kinetic-cut-video, MIT). */
export const briefStoryRowSchema = z.strictObject({
  start: seconds.describe("Timeline seconds the shot starts."),
  beats: z.coerce.number().positive().max(64).describe("Its length in beats (1, 2, 4, 8...): mix them."),
  picture: line(240).describe("What is on screen."),
  motif: line(80).describe("The motif it grows from (one of motifs)."),
  source: z.enum(BRIEF_SOURCES),
  file_id: line(40).optional().describe("The media-bin file id when source is media."),
  composition: line(60).describe("centred, object left / type right, full bleed, type cropped by the frame, split, diagonal, empty space..."),
  text_entrance: line(60).describe("slam, typed, built from the motif, mask wipe, flip, stretch, none..."),
  tone: line(80).describe("Brightness and main colour: dark navy, bright paper, inverted, accent fill..."),
  transition: line(80).optional().describe("How it hands over to the next shot (a motif match cut first)."),
  climax: z.boolean().optional().describe("The one heaviest moment: its tone breaks the system the rest set up."),
});

/** One axis of the creative-direction draw. */
export const briefDirectionSchema = z.strictObject({
  axis: line(40).describe("art style, palette, type, rhythm, camera, transitions, finish, copy tone, opening, ending..."),
  pick: line(100),
  why: line(200).describe("Why this pick for this subject, and how it differs from the last edit's."),
});

export const briefShape = {
  goal: line(300).describe("What the video must make the viewer do or feel, in one sentence."),
  audience: line(200).optional(),
  platform: line(60).describe("Reels, TikTok, YouTube, LinkedIn, a site hero..."),
  aspect: z.enum(BRIEF_ASPECTS),
  length_seconds: z.coerce.number().min(1).max(600),
  style: line(80).describe("One style id from the styles index (zenvi-styles SKILL.md)."),
  techniques: z.array(briefTechniqueSchema).max(4).default([]).describe("Up to 4 borrowed techniques, each with its reason."),
  hook: line(300).describe("The first 2 seconds: what is on screen and heard at 0.0 s."),
  beats: z.array(briefBeatSchema).min(1).max(24).describe("The structure with timings, in order."),
  shots: z.array(briefShotSchema).max(60).default([]).describe("Older briefs' shot plan; new briefs plan shots in storyboard."),
  motifs: z.array(line(80)).max(12).default([]).describe("8-12 visual elements only this subject has: tools, materials, signs, screens, places, the one gesture of the trade."),
  through_line: line(80).optional().describe("The motif that recurs and opens and closes the piece (one of motifs)."),
  storyboard: z.array(briefStoryRowSchema).max(40).default([]).describe("The shot plan, one row per shot, mapped to the media or to what to fetch / generate."),
  reskin: z
    .strictObject({
      generic: z.coerce.number().int().min(0).describe("Storyboard rows whose picture would still work if the copy named another subject."),
      note: line(300).optional(),
    })
    .optional()
    .describe("The reskin test: more than a third generic means the plan is a template; redo it."),
  direction: z.array(briefDirectionSchema).max(16).default([]).describe("The creative-direction draw: at least 3 axes picked on purpose, differently from the last edit."),
  type: line(300).optional().describe("Type system: families, sizes, how type moves."),
  palette: line(300).optional().describe("Palette and grade: the look, the accent colour."),
  music: line(300).optional().describe("Music: tempo, energy curve, where the drop lands."),
  sound: line(300).optional().describe("Sound palette: what lands on cuts, UI events, the climax."),
  captions: line(300).optional().describe("Captions and voice-over."),
  end_card: line(300).optional(),
  checklist: z.array(line(200)).max(16).default([]).describe("The style's finish checklist, the lines review checks before done."),
  critique: line(800).optional().describe("What the self-critique against the style's best-vs-average list changed."),
  missing: z.array(line(200)).max(8).default([]).describe("Facts the person must supply (brand name, URL, price): never invented."),
};

export const briefSchema = z.strictObject(briefShape);

export type Brief = z.output<typeof briefSchema>;
export type BriefBeat = z.output<typeof briefBeatSchema>;
export type BriefTechnique = z.output<typeof briefTechniqueSchema>;

/** The brief saved on `project`, or null (none, or one this version cannot read). */
export function readBrief(project: Project): Brief | null {
  const raw = (project.settings as Record<string, unknown> | undefined)?.[BRIEF_KEY];
  if (raw === undefined || raw === null) return null;
  const parsed = briefSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Width:height of an aspect id. */
export function aspectRatio(aspect: BriefAspect): number {
  const [w, h] = aspect.split(":").map(Number) as [number, number];
  return w / h;
}

/** The brief in a few lines, for receipts and prompts. */
export function briefSummary(brief: Brief): string {
  const beats = brief.beats.map((b) => `${b.name} ${b.start}-${b.end}s`).join(", ");
  const techniques = brief.techniques.map((t) => t.id).join(", ");
  return [
    `Brief: ${brief.style}, ${brief.aspect} ${brief.length_seconds}s for ${brief.platform}. Goal: ${brief.goal}`,
    `Hook: ${brief.hook}`,
    `Beats: ${beats}.`,
    techniques ? `Techniques: ${techniques}.` : "",
    brief.missing.length > 0 ? `Missing from the person: ${brief.missing.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
