/**
 * The styles library as tools (zenvi-styles and the director recipes, the
 * markdown in plugins/zenvi/skills, through library.gen.ts):
 * find_style_tool (the request and the bin → the three best styles, a reason
 * each), get_style_tool (one style's compact recipe for the asked length)
 * and get_technique_tool (one technique's build steps). Fleet ab10 (36 runs)
 * found no agent read a style file and connectors cannot read files at all;
 * tools reach every surface. Read-only, no undo step.
 */

import { z } from "zod";
import { readBrief } from "../../brief/brief.js";
import { nearestAspect } from "../../brief/auto.js";
import { inventoryEntry, inventoryFiles } from "../../brief/inventory.js";
import type { Project } from "../../model/types.js";
import { STYLE_FILES } from "../../styles/index.js";
import { compactStyle, compactTechnique, nearestIds, rankStyles, styleChecklist, styleFinishCalls, type BinSignals, type StyleFile } from "../../styles/recipe.js";
import { timelineEnd } from "../../timeline/queries.js";
import { directTool, type CatalogTool } from "../define.js";
import { isLookId } from "../luts.js";
import { applied, refused } from "../receipt.js";

const FIND = "find_style_tool";
const GET = "get_style_tool";
const TECHNIQUE = "get_technique_tool";
/** The length a recipe is cut for when neither the call, the brief nor the timeline gives one: a social reel. */
const DEFAULT_SECONDS = 15;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

/** What the bin holds, for ranking styles. */
export function binSignals(project: Project): BinSignals {
  const entries = inventoryFiles(project).map((f) => inventoryEntry(project, f));
  return {
    videos: entries.filter((e) => e.kind === "video").length,
    images: entries.filter((e) => e.kind === "image").length,
    voice: entries.some((e) => e.kind === "voice" || (e.kind === "video" && e.speech === "yes")),
    music: entries.some((e) => e.kind === "music"),
    aspect: nearestAspect(project),
  };
}

function binLine(bin: BinSignals): string {
  const parts = [`${bin.videos} video(s)`, `${bin.images} image(s)`, bin.voice ? "a voice" : "", bin.music ? "music" : ""].filter(Boolean);
  return `The bin: ${parts.join(", ")}; the frame ${bin.aspect ?? "unknown"}.`;
}

/** The length to cut a recipe for: the call's, the brief's, the timeline's (3-600 s), else a 15 s reel. */
function askedSeconds(project: Project, given: number | undefined): number {
  if (given !== undefined) return given;
  const brief = readBrief(project);
  if (brief && !brief.auto) return brief.length_seconds;
  const end = timelineEnd(project);
  // Within what get_style_tool's length_seconds takes (a 1.5 s or a 20 min timeline): find_style_tool suggests the call.
  return end >= 1 ? Math.min(600, Math.max(3, Math.round(end * 10) / 10)) : brief?.length_seconds ?? DEFAULT_SECONDS;
}

function near(id: string, files: readonly StyleFile[], kinds: readonly StyleFile["kind"][]): string {
  const ids = nearestIds(id, files, kinds);
  return ids.length > 0 ? ` Near: ${ids.join(", ")};` : "";
}

const findInput = z.strictObject({
  request: z.string().max(2000).optional().describe("What the person asked for, in their words (default: the saved brief's goal)."),
});

const getInput = z.strictObject({
  style: z.string().min(1).max(80).optional().describe("Style id from find_style_tool (default: the saved brief's style)."),
  length_seconds: z.number().min(3).max(600).optional().describe("Length of the edit: the beats are timed for it (default: the brief's, else the timeline's, else 15)."),
});

const techniqueInput = z.strictObject({
  technique: z.string().min(1).max(80).describe("Technique id (a style's Borrow line, the brief's techniques), or a family (cinematic, kinetic) or method-motif."),
});

export const styleTools: CatalogTool[] = [
  directTool({
    name: FIND,
    title: "Find the style for a video",
    description:
      "The three styles of the Zenvi styles library that best fit a whole-video request and the media bin, each with its one-line summary and why it fits. Call it first for a reel, ad, promo, montage or remake, then get_style_tool on the pick. Read-only.",
    input: findInput,
    annotations: READ_ONLY,
    run: async (call, args: z.output<typeof findInput>) => {
      const files = STYLE_FILES;
      const project = call.doc.project;
      const brief = readBrief(project);
      const request = args.request ?? (brief && !brief.auto ? brief.goal : "");
      const bin = binSignals(project);
      const picks = rankStyles(`${request} ${project.files.map((f) => String(f.name ?? "")).join(" ")}`, files, bin);
      const lines = picks.map((p, i) => `${i + 1}. ${p.id}: ${p.summary}${p.reasons.length > 0 ? ` Fits: ${p.reasons.join("; ")}.` : ""}`);
      const seconds = askedSeconds(project, undefined);
      return applied(
        FIND,
        [binLine(bin), ...lines, `Next: get_style_tool {"style": "${picks[0]!.id}", "length_seconds": ${seconds}} for its beats, look, type, sound, tool calls and checklist.`].join("\n"),
        { data: { styles: picks } },
        0,
      );
    },
  }),
  directTool({
    name: GET,
    title: "Get a style's recipe",
    description:
      "One style's compact recipe for an edit of the asked length: the beats with their timings, look and grade, type, motion, sound, the exact tool sequence and the finish checklist (the zenvi-styles file, at most ~1.5 k tokens). Read it before the first edit of a whole video. Read-only.",
    input: getInput,
    annotations: READ_ONLY,
    run: async (call, args: z.output<typeof getInput>) => {
      const files = STYLE_FILES;
      const id = args.style ?? readBrief(call.doc.project)?.style;
      if (!id) return refused(GET, "Error: give style (find_style_tool lists the best three for the request).");
      const file = files.find((f) => f.id === id && f.kind === "style");
      if (!file) {
        const other = files.find((f) => f.id === id);
        if (other) return refused(GET, `Error: ${id} is a ${other.kind}, not a style: get_technique_tool {"technique": "${id}"}.`);
        return refused(GET, `Error: no style ${id}.${near(id, files, ["style"])} find_style_tool picks one for the request.`);
      }
      const seconds = askedSeconds(call.doc.project, args.length_seconds);
      return applied(GET, compactStyle(file, seconds), { data: { style: file.id, length_seconds: seconds, finish_calls: styleFinishCalls(file, isLookId), checklist: styleChecklist(file), uri: `zenvi://styles/${file.id}` } }, 0);
    },
  }),
  directTool({
    name: TECHNIQUE,
    title: "Get a technique's build steps",
    description:
      "One technique of the Zenvi styles library (a match cut, a flash frame, a type animation, a sound move…): what it is, how to build it with Zenvi tools step by step, its timing and taste rules, its sound and the common mistakes. Read-only.",
    input: techniqueInput,
    annotations: READ_ONLY,
    run: async (_call, args: z.output<typeof techniqueInput>) => {
      const files = STYLE_FILES;
      const file = files.find((f) => f.id === args.technique);
      if (!file) return refused(TECHNIQUE, `Error: no technique ${args.technique}.${near(args.technique, files, ["technique", "family", "method"])} A style's Borrow line names its techniques.`);
      if (file.kind === "style") return refused(TECHNIQUE, `Error: ${file.id} is a style: get_style_tool {"style": "${file.id}"}.`);
      return applied(TECHNIQUE, compactTechnique(file), { data: { technique: file.id, kind: file.kind, uri: `zenvi://styles/${file.id}` } }, 0);
    },
  }),
];
