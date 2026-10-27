/**
 * swap_shot_tool: put another picture in a shot without touching the cut.
 * The clip keeps its place, length, keyframes, effects and transitions; it
 * plays another bin file (or another moment of its own) from `start_seconds`.
 * This is the fix review_render_tool and review_edit_tool hand back for a
 * repeated shot (review/swaps.ts picks the replacement).
 */

import { z } from "zod";
import { trimClip } from "../../ops/clips.js";
import { moveKeyframes, patchClip, rateOf } from "../../ops/internal.js";
import { pyRound } from "../../model/rounding.js";
import { useFileForClip } from "../../ops/overlays.js";
import { fileLabel, freeInPoint, isFootageFile, isStill } from "../../review/swaps.js";
import { directTool, type CatalogTool } from "../define.js";
import { applied, refused } from "../receipt.js";
import { isLocked } from "../titles-text.js";

const TOOL = "swap_shot_tool";

const input = z.strictObject({
  clip_id: z.string().min(1).describe("Timeline clip whose picture to change (from a review's swaps, get_timeline_state_tool or a receipt)."),
  file_id: z.string().min(1).optional().describe("Media-bin video or image to show instead (default: the clip's own file, at another moment)."),
  start_seconds: z
    .number()
    .min(0)
    .optional()
    .describe("Source in-point in the new file, seconds (default: a third of the way into the first stretch no clip shows yet)."),
});
type Input = z.output<typeof input>;

export const swapShotTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Swap a shot's picture",
    description:
      "Show another bin clip (or another moment of the same clip) in a timeline clip without changing the cut: position, length, keyframes, effects " +
      "and transitions stay. The fix for a repeated shot: review_render_tool and review_edit_tool list the swaps to make (clip_id, file_id, start_seconds). One undo step.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, args: Input) => {
      const project = call.doc.project;
      const clip = project.clips.find((c) => c.id === args.clip_id);
      if (!clip) return refused(TOOL, `Error: no timeline clip with id='${args.clip_id}'.`);
      if (isLocked(project, clip.layer)) return refused(TOOL, `Error: clip ${clip.id} is on a locked track; unlock it first.`);
      const fileId = args.file_id ?? String(clip.file_id);
      const file = project.files.find((f) => f.id === fileId);
      if (!file) return refused(TOOL, `Error: no media-bin file with id='${fileId}'.`);
      if (!isFootageFile(file)) return refused(TOOL, `Error: ${fileLabel(file)} is not a video or image to cut to.`);
      const length = Number(clip.end) - Number(clip.start);
      const still = isStill(file);
      const duration = Number(file.duration) || 0;
      let start = args.start_seconds;
      if (start === undefined) {
        if (still) start = 0;
        else {
          const used = project.clips.filter((c) => c.file_id === file.id && c.id !== clip.id).map((c): [number, number] => [Number(c.start), Number(c.end)]);
          start = freeInPoint(duration, used, length) ?? Math.max(0, (duration - length) * 0.3);
        }
      }
      if (!still && start + length > duration + 1e-3) {
        return refused(TOOL, `Error: ${fileLabel(file)} is ${duration.toFixed(2)} s long; a ${length.toFixed(2)} s shot from ${start.toFixed(2)} s runs past its end. Pass an earlier start_seconds or another file.`);
      }
      const before = { file_id: String(clip.file_id), start: Number(clip.start), end: Number(clip.end) };
      if (before.file_id === file.id && Math.abs(before.start - start) < 1e-3) return refused(TOOL, `Error: clip ${clip.id} already shows ${fileLabel(file)} from ${start.toFixed(2)} s.`);
      const oldFile = project.files.find((f) => f.id === clip.file_id);
      call.commit((tx) => {
        if (file.id !== clip.file_id) {
          useFileForClip(tx, clip.id, file.id);
          // A title that named the old file names the new one.
          if (oldFile && clip.title === oldFile.name) patchClip(tx, clip.id, { title: file.name ?? clip.title });
        }
        const trimmed = trimClip(tx, clip.id, { start, end: start + length });
        // Keyframe X counts reader frames from the source's first (ops/internal.ts moveKeyframes): a new in-point
        // moves every curve with it, so fades and punch-ins stay on the same timeline frames.
        const rate = rateOf(tx.project);
        const delta = pyRound(Number(trimmed.start) * rate) - pyRound(before.start * rate);
        if (delta !== 0) patchClip(tx, clip.id, moveKeyframes(trimmed, (x) => x + delta));
      }, `Swap shot ${clip.id}`);
      const after = call.doc.project.clips.find((c) => c.id === clip.id)!;
      const graded = (after.effects ?? []).some((e) => e.type === "ColorGrade");
      return applied(TOOL, `Clip ${clip.id} now shows ${fileLabel(file)} from ${Number(after.start).toFixed(2)} s (was ${oldFile ? fileLabel(oldFile) : before.file_id} from ${before.start.toFixed(2)} s).`, {
        data: { clip_id: clip.id, before, after: { file_id: String(after.file_id), start: Number(after.start), end: Number(after.end) } },
        clips: [{ id: clip.id }],
        warnings: graded && file.id !== before.file_id ? ["its colour correction was measured on the old footage: run unify_grade_tool again"] : [],
      });
    },
  }),
];
