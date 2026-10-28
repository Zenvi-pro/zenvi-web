/**
 * place_on_word_tool: land a title, a sound effect, a clip, a motion block or
 * a cut on a spoken word. The word (or phrase, and which time it is said)
 * is found in the timeline's speech (timeline-words.ts); the placing tool
 * runs with its time argument set to the word's frame, on a scratch copy of
 * the project, and the result is committed as one undo step. The receipt
 * reports, per placement, the word's time, where the item landed and the
 * miss in frames.
 */

import { z } from "zod";
import { ProjectDocument } from "../../history/document.js";
import type { Project } from "../../model/types.js";
import { getCloseMatches } from "../difflib.js";
import { directTool, type CatalogTool } from "../define.js";
import { projectFps, toFrame, toSeconds } from "../frame-time.js";
import { applied, failed, refused, type ToolReceipt } from "../receipt.js";
// A cycle (the registry lists this tool), safe because runTool is only called while a tool runs.
import { runTool } from "../registry.js";
import { findPhrase, speakingClips, timelineWords, type PhraseHit } from "../timeline-words.js";
import { applyProjectState } from "./master-loop.js";

const TOOL = "place_on_word_tool";
const MAX_PLACEMENTS = 24;

/** What can land on a word: the tool that places it and its time argument. */
const PLACERS = {
  title: { tool: "add_kinetic_title_tool", time: "position_seconds" },
  sfx: { tool: "add_sfx_tool", time: "at_seconds" },
  clip: { tool: "add_clip_to_timeline_tool", time: "position_seconds" },
  motion_block: { tool: "add_motion_block_tool", time: "position_seconds" },
  cut: { tool: "split_clip_tool", time: "at_seconds" },
} as const;
type What = keyof typeof PLACERS;
const WHATS = Object.keys(PLACERS) as [What, ...What[]];

const input = z.strictObject({
  word: z.string().min(1).max(80).describe("The spoken word, or a phrase of up to 6 words said one after another (case and punctuation ignored)."),
  occurrence: z.number().int().min(1).optional().describe("Which time it is said, 1 = first (default 1)."),
  every: z.boolean().optional().describe(`Every time it is said (at most ${MAX_PLACEMENTS}) instead of one occurrence.`),
  anchor: z.enum(["start", "end"]).optional().describe("Land on the word's first frame (start, default) or right after the phrase's last word (end)."),
  offset_frames: z.number().int().min(-60).max(60).optional().describe("Frames before (negative) or after the anchor, e.g. -2 so a hit leads the word slightly (default 0)."),
  what: z.enum(WHATS).describe(
    "What lands on the word: title (add_kinetic_title_tool; text defaults to the word), sfx (add_sfx_tool), clip (add_clip_to_timeline_tool: a cutaway, needs file_id), motion_block (add_motion_block_tool, needs block), cut (split_clip_tool: splits the speaking clip there).",
  ),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments of that tool, without its time (position_seconds / at_seconds is set to the word), e.g. {recipe:'whoosh'} for sfx, {file_id, duration_seconds:1.2, track:'V2'} for clip, {style:'creator', duration_seconds:1.5} for title."),
  timeline_clip_ids: z.array(z.string().min(1)).min(1).max(20).optional().describe("Clips whose speech to search (default: footage with sound, and clips with a transcript such as TTS voices or aligned lyrics)."),
  language: z.string().max(16).optional().describe("Speech language when a clip has to be transcribed (auto by default)."),
});
type Input = z.output<typeof input>;

interface Placement {
  word: string;
  occurrence: number;
  wordStart: number;
  wordEnd: number;
  target: number;
  landed: number | null;
  missFrames: number | null;
  clipId: string;
  status: string;
  summary: string;
}

/** Start of what a step added or cut: its new clips' earliest position. */
function landedAt(before: Project, after: Project): number | null {
  const had = new Set(before.clips.map((c) => String(c.id)));
  const added = after.clips.filter((c) => !had.has(String(c.id))).map((c) => Number(c.position) || 0);
  return added.length > 0 ? Math.min(...added) : null;
}

export const placeOnWordTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Place on a spoken word",
    description:
      "Land a title, sound effect, cutaway clip, motion block or cut exactly on a word of the speech (a pop-in on a keyword, a whoosh on 'boom', a cutaway when the product is named, a cut after a phrase): " +
      "finds the word (or phrase, and which time it is said) in the timeline's transcripts, transcribing footage that has none, and runs the placing tool with its time set to the word's frame. " +
      "Reports each placement's word time, where it landed and the miss in frames. One undo step for all of them.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, args: Input): Promise<ToolReceipt> => {
      const project = call.doc.project;
      const keys = args.word.trim().split(/\s+/);
      if (keys.length > 6) return refused(TOOL, "Error: word is a word or a phrase of at most 6 words.");
      const placer = PLACERS[args.what];
      const extra = { ...(args.args ?? {}) };
      if (placer.time in extra) return refused(TOOL, `Error: args must not set ${placer.time}; the word sets it.`);
      if (args.what === "clip" && !extra.file_id) return refused(TOOL, "Error: what=clip needs args.file_id (the media-bin file to cut to).");
      if (args.what === "motion_block" && !extra.block) return refused(TOOL, "Error: what=motion_block needs args.block (list_motion_blocks_tool).");
      let clips = speakingClips(project);
      if (args.timeline_clip_ids) {
        const unknown = args.timeline_clip_ids.find((id) => !project.clips.some((c) => c.id === id));
        if (unknown) return refused(TOOL, `Error: unknown timeline clip ${unknown}.`);
        clips = project.clips.filter((c) => args.timeline_clip_ids!.includes(c.id));
      }
      if (clips.length === 0) return refused(TOOL, "Error: no clip on the timeline has speech to search; pass timeline_clip_ids.");

      const heard = await timelineWords(call, clips, args.language);
      if (heard.words.length === 0) {
        const why = heard.failures[0]?.message;
        return refused(TOOL, `Error: no spoken words found${why ? ` (${why})` : ""}; transcribe the speech first (transcribe_media_tool) or pass timeline_clip_ids.`);
      }
      const hits = findPhrase(heard.words, args.word);
      const wanted: PhraseHit[] = args.every ? hits.slice(0, MAX_PLACEMENTS) : hits.slice((args.occurrence ?? 1) - 1, args.occurrence ?? 1);
      if (wanted.length === 0) {
        if (hits.length > 0) return refused(TOOL, `Error: "${args.word}" is said ${hits.length} time(s); occurrence ${args.occurrence} does not exist.`);
        const close = getCloseMatches(keys.join(" ").toLowerCase(), new Set(heard.words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ""))), 5, 0.6);
        return refused(TOOL, `Error: "${args.word}" is not said in the speech searched.${close.length ? ` Close words: ${close.join(", ")}.` : ""}`);
      }

      const fps = projectFps(project);
      const scratch = new ProjectDocument(structuredClone(project));
      const placements: Placement[] = [];
      const warnings = [...new Set(heard.warnings)];
      for (const [n, hit] of wanted.entries()) {
        const anchorSec = args.anchor === "end" ? hit.end : hit.start;
        const target = Math.max(0, toSeconds(toFrame(anchorSec, fps) + (args.offset_frames ?? 0), fps));
        const step: Record<string, unknown> = { ...extra, [placer.time]: target };
        if (args.what === "title" && step.text === undefined) step.text = hit.text.replace(/[^\p{L}\p{N}'’ -]/gu, "");
        if (args.what === "cut" && step.clip_id === undefined) step.clip_id = hit.clipId;
        const before = structuredClone(scratch.project);
        const result = await runTool({ doc: scratch, host: call.host, signal: call.signal }, placer.tool, step);
        const receipt = result.data;
        const ok = receipt?.status === "applied";
        const landed = ok ? (args.what === "cut" ? target : landedAt(before, scratch.project)) : null;
        placements.push({
          word: hit.text,
          occurrence: hits.indexOf(hit) + 1,
          wordStart: hit.start,
          wordEnd: hit.end,
          target: Math.round(target * 1000) / 1000,
          landed: landed === null ? null : Math.round(landed * 1000) / 1000,
          missFrames: landed === null ? null : toFrame(landed, fps) - toFrame(target, fps),
          clipId: hit.clipId,
          status: receipt?.status ?? "failed",
          summary: receipt?.summary ?? result.text ?? "",
        });
        if (!ok) warnings.push(`occurrence ${n + 1} at ${target.toFixed(2)}s: ${receipt?.summary ?? "the placing tool failed"}`);
        if (!hit.exact) warnings.push(`"${hit.text}" at ${hit.start.toFixed(2)}s has an estimated time, not a heard one`);
      }
      const placed = placements.filter((p) => p.status === "applied");
      if (placed.length === 0) {
        return failed(TOOL, `Error: nothing was placed: ${placements[0]?.summary.replace(/^Error:\s*/, "") ?? "the placing tool failed"}`, { data: { placements } });
      }
      call.commit((tx) => applyProjectState(tx, scratch.project), `Place ${args.what} on "${args.word}"`);
      const missed = placed.filter((p) => p.missFrames !== null && p.missFrames !== 0);
      const times = placed.map((p) => `${p.landed?.toFixed(2)}s`).join(", ");
      return applied(
        TOOL,
        `Placed ${placed.length} ${args.what}(s) on "${args.word}" at ${times}${missed.length ? `; ${missed.length} landed off the word (see placements)` : ", each on its word's frame"}.`,
        { warnings, data: { what: args.what, tool: placer.tool, placements, created: scratch.project.clips.filter((c) => !project.clips.some((o) => o.id === c.id)).map((c) => c.id) } },
      );
    },
  }),
];
