/**
 * watch_render_tool: an editor watches the rendered file, picture and sound,
 * and says what holds it back. review_render_tool measures the file (black,
 * loudness, repeats); this one judges it (hook, rhythm, sound on the cuts,
 * the ending), which frames and meters cannot. The host does the watching
 * (`WatchHost`); this tool places every issue on the open timeline and names
 * the tools that fix it.
 */

import { z } from "zod";
import { reviewTimeline } from "../../review/timeline.js";
import type { TimelineReview } from "../../review/types.js";
import {
  fixToolsFor,
  isWatchError,
  shotsAt,
  WATCH_DIMENSION_NAMES,
  WATCH_MAX_SECONDS,
  watchTimelineNotes,
  type WatchCritique,
  type WatchDimension,
} from "../../review/watch.js";
import { directTool, type CatalogTool } from "../define.js";
import { applied, failed, refused } from "../receipt.js";

const TOOL = "watch_render_tool";
/** A render this much longer or shorter than the open timeline is not of it: issues are not placed on it. */
const SAME_EDIT_SECONDS = 0.5;

const input = z.strictObject({
  path: z.string().min(1).describe("The rendered video to watch, as render/export wrote it (a path relative to the project's folder, or absolute)."),
  brief: z.string().max(2000).optional().describe("What the edit was asked to be, in a sentence or two; the critic judges against it."),
  focus: z
    .array(z.enum(WATCH_DIMENSION_NAMES as [WatchDimension, ...WatchDimension[]]))
    .max(4)
    .optional()
    .describe("Dimensions to weigh most, e.g. [\"sound_design\", \"mix\"] after sound design."),
});
type Input = z.output<typeof input>;

const fmt = (value: number): string => `${value.toFixed(2)}s`;

function scoreLine(critique: WatchCritique): string {
  return WATCH_DIMENSION_NAMES.filter((d) => critique.scores[d] !== null)
    .map((d) => `${d} ${critique.scores[d]}`)
    .join(" · ");
}

/** Each issue with the timeline under it (when the render is of the open timeline) and its tools. */
function placedIssues(critique: WatchCritique, review: TimelineReview | null) {
  return critique.issues.map((issue) => ({
    ...issue,
    shots: review ? shotsAt(review, issue).map((s) => ({ clip_id: s.clipId, name: s.name, start: s.start, end: s.end })) : [],
    tools: fixToolsFor(issue),
  }));
}

export const watchRenderTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Watch the render with sound",
    description:
      "Have a senior editor watch the rendered file with its sound (Gemini, through your Zenvi sign-in; a few credits for up to 90 s) and critique it: " +
      "a 1-10 score for hook, pacing, structure, motion, transitions, typography, look, sound design, mix and ending, " +
      "and 3-6 timestamped issues, worst first, each with a concrete fix, the shots on the timeline it falls on, and the tools that make it. " +
      "Call it once before finishing, after review_render_tool has no PROBLEM lines; fix the high issues, render, and watch again at most once. Changes nothing.",
    input,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    requires: ["watch"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const review = (project.clips ?? []).length > 0 ? reviewTimeline(project) : null;
      // Read the length first when the host can: a render of another edit gets no timeline notes, and a long one is refused before uploading.
      // The watch host's own reading comes first: it opens the path as `watch` will (the CLI's start at the project's folder).
      const watcher = call.host.watch!;
      const media = call.host.media;
      const readLength = watcher.length
        ? (p: string) => watcher.length!(p, call.signal)
        : media
          ? async (p: string) => Number((await media.probe(p)).duration)
          : null;
      let length: number | null = null;
      if (readLength) {
        try {
          length = (await readLength(args.path)) || null;
        } catch (error) {
          return refused(TOOL, `Error: could not read ${args.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (length !== null && length > WATCH_MAX_SECONDS + 0.5) {
        return refused(TOOL, `Error: ${args.path} is ${fmt(length)} long; watching takes at most ${WATCH_MAX_SECONDS} s. Render the part to judge (export_video_tool start/end) and watch that.`);
      }
      const sameEdit = (duration: number): boolean => review !== null && review.shots.length > 0 && Math.abs(review.range.end - duration) <= SAME_EDIT_SECONDS;
      const notes = review && (length === null || sameEdit(length)) ? watchTimelineNotes(review) : "";

      let critique: WatchCritique;
      try {
        critique = await watcher.watch(args.path, {
          brief: args.brief,
          focus: args.focus,
          timelineNotes: notes || undefined,
          signal: call.signal,
        });
      } catch (error) {
        if (call.signal?.aborted) return refused(TOOL, "Error: cancelled");
        if (isWatchError(error)) return (error.code === "failed" ? failed : refused)(TOOL, `Error: ${error.message}`);
        return failed(TOOL, `Error: watching ${args.path} failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      const onTimeline = sameEdit(critique.duration) ? review : null;
      const issues = placedIssues(critique, onTimeline);
      const by = critique.via === "backend" ? "the Zenvi backend" : "Gemini (developer key)";
      const lines = issues.map((issue, i) => {
        const where = issue.shots.length > 0 ? ` On the timeline: ${issue.shots.map((s) => `"${s.name}" (${s.clip_id}, ${fmt(s.start)}-${fmt(s.end)})`).join(", ")}.` : "";
        return `${i + 1}. ${issue.severity.toUpperCase()} ${issue.dimension} ${fmt(issue.start)}-${fmt(issue.end)}: ${issue.problem} Fix: ${issue.fix}${where} Tools: ${issue.tools.join(", ")}`;
      });
      const summary =
        `Watched ${args.path} (${fmt(critique.duration)}, ${critique.hasAudio ? "with sound" : "no audio track"}) via ${by}: ` +
        `overall ${critique.overall ?? "?"}/10, ${critique.wouldPost ? "would post" : "would not post yet"}. ${critique.verdict}` +
        `\nScores: ${scoreLine(critique)}` +
        (lines.length > 0 ? `\nIssues, worst first (fix the high ones, render, then watch once more):\n${lines.join("\n")}` : "\nNo issues named.") +
        (critique.strengths.length > 0 ? `\nKeep: ${critique.strengths.join(" ")}` : "") +
        (review && !onTimeline ? "\nThe render is not the length of the open timeline, so the issues are not placed on it." : "");
      const data = {
        path: args.path,
        via: critique.via,
        model: critique.model,
        duration: critique.duration,
        has_audio: critique.hasAudio,
        overall: critique.overall,
        would_post: critique.wouldPost,
        verdict: critique.verdict,
        scores: critique.scores,
        issues,
        strengths: critique.strengths,
        on_timeline: onTimeline !== null,
        usage: critique.usage,
      };
      return applied(TOOL, summary, { data }, 0);
    },
  }),
];
