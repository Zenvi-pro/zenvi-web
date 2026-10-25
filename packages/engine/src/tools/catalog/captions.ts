/**
 * Caption tracks: list_captions_tool, edit_captions_tool, remove_captions_tool.
 *
 * Ports of zenvi-core develop src/classes/editor_tools/titles_text_captions.py.
 * A caption track is a libopenshot Caption effect on the clip it captions;
 * its cues are in that clip's source time (tools/caption-cues.ts), so they
 * stay on the words when the clip moves or is trimmed. Captions not tied to
 * one clip sit on a transparent "Captions" overlay clip (`zenvi_role`
 * "captions"). Every renderer draws the Caption effect (render/kernels/caption.ts).
 *
 * The desktop also picks the Caption effect selected in its Properties panel
 * when no target is given; the web editor has no effect selection, so the
 * project's only caption track is used, else the call asks which one.
 */

import type { Clip, Effect, Project } from "../../model/types.js";
import { replaceClipEffects } from "../../ops/overlays.js";
import { contractTool, type ToolCall } from "../define.js";
import { pyFixed, pyFloat, pyReprString } from "../pyfmt.js";
import { applied } from "../receipt.js";
import { buildCaptionText, displayText, parseCaptionText, safeText, type Cue } from "../caption-cues.js";
import { CaptionStyle, restyleRequested, styleFromEffect, type CaptionStyleArgs } from "../caption-style.js";
import { clipExtent, guarded, isLocked, pyRoundTo, summaryLine, toolError, uiTrackNumber } from "../titles-text.js";
import { resolveClip } from "./common.js";

/** `zenvi_role` of the transparent clip that carries captions not tied to one clip. */
export const CAPTION_ROLE = "captions";

/** `caption_effects`: the Caption effects of a clip, in stack order. */
export function captionEffects(clip: Pick<Clip, "effects">): Effect[] {
  return (clip.effects ?? []).filter((e) => typeof e === "object" && e !== null && (e.class_name === "Caption" || e.type === "Caption"));
}

/** (position, source start, source end) of a clip. */
function clipWindow(clip: Clip): [number, number, number] {
  return [Number(clip.position) || 0, Number(clip.start) || 0, Number(clip.end) || 0];
}

function timelineToCaption(clip: Clip, t: number): number {
  const [position, start] = clipWindow(clip);
  return t - position + start;
}

function captionToTimeline(clip: Clip, t: number): number {
  const [position, start] = clipWindow(clip);
  return position + t - start;
}

function clipLabel(clip: Clip): string {
  return String(clip.title || clip.id);
}

export interface CueRow {
  index: number;
  start: number;
  end: number;
  source_start: number;
  source_end: number;
  text: string;
  visible: boolean;
}

/** `_cue_rows`: numbered cues in timeline and source seconds, and whether the trimmed clip shows them. */
function cueRows(clip: Clip, cues: readonly Cue[]): CueRow[] {
  const [, start, end] = clipWindow(clip);
  return [...cues]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((cue, i) => ({
      index: i + 1,
      start: pyRoundTo(captionToTimeline(clip, cue.start), 3),
      end: pyRoundTo(captionToTimeline(clip, cue.end), 3),
      source_start: pyRoundTo(cue.start, 3),
      source_end: pyRoundTo(cue.end, 3),
      text: displayText(cue.text),
      visible: cue.end > start && cue.start < end,
    }));
}

/** `_given_cues`: {start, end, text} objects, validated. */
function givenCues(cues: readonly unknown[] | undefined, what = "cues"): Cue[] {
  const out: Cue[] = [];
  (cues ?? []).forEach((c, i) => {
    const n = i + 1;
    if (typeof c !== "object" || c === null || Array.isArray(c)) toolError(`${what}[${n}] must be an object with start, end and text`);
    const item = c as Record<string, unknown>;
    const text = String(item.text ?? "").trim();
    const start = Number(item.start);
    const end = Number(item.end);
    if (item.start === null || item.end === null || !Number.isFinite(start) || !Number.isFinite(end)) {
      toolError(`${what}[${n}] needs numeric start and end seconds`);
    }
    if (!text) toolError(`${what}[${n}] has no text`);
    if (start < 0 || end <= start) toolError(`${what}[${n}] must have 0 <= start < end (got ${pyFloat(start)}-${pyFloat(end)})`);
    out.push({ start, end, text });
  });
  return out;
}

/** `_prepare`: cue text made drawable (blank cues dropped). */
function prepareCues(cues: readonly Cue[], uppercase: boolean): [Cue[], number] {
  const out: Cue[] = [];
  let changed = 0;
  for (const cue of cues) {
    const [safe, wasChanged] = safeText(uppercase ? cue.text.toUpperCase() : cue.text);
    if (!safe) continue;
    if (wasChanged) changed += 1;
    out.push({ start: cue.start, end: cue.end, text: safe });
  }
  return [out, changed];
}

async function clipByQuery(call: ToolCall, clipQuery: string): Promise<Clip> {
  const res = await resolveClip(call, { clip_query: clipQuery });
  if (!res.ok) return toolError(res.error || "could not resolve the timeline clip");
  return res.clip;
}

function clipById(project: Project, id: string): Clip | undefined {
  return project.clips.find((c) => c.id === id);
}

/** `_find_effect`: the clip and Caption effect to change. */
async function findCaptionEffect(call: ToolCall, effectId: string, clipId: string, clipQuery: string): Promise<[Clip, Effect]> {
  const project = call.doc.project;
  const candidates: [Clip, Effect][] = [];
  for (const clip of project.clips) for (const effect of captionEffects(clip)) candidates.push([clip, effect]);
  if (effectId) {
    const hit = candidates.find(([, e]) => e.id === effectId);
    if (hit) return hit;
    return toolError(`no Caption effect with id=${pyReprString(effectId)}`);
  }
  if (clipId || clipQuery) {
    const clip = clipId ? clipById(project, clipId) : await clipByQuery(call, clipQuery);
    if (!clip) return toolError(`no timeline clip with id=${pyReprString(clipId)}`);
    const effects = captionEffects(clip);
    if (effects.length === 0) toolError(`clip ${clip.id} (${clipLabel(clip)}) has no captions; add them with add_captions_tool`);
    if (effects.length > 1) toolError(`clip ${clip.id} has ${effects.length} Caption effects; pass effect_id (${effects.map((e) => e.id).join(", ")})`);
    return [clip, effects[0]!];
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) return toolError("there are no captions in the project; add them with add_captions_tool");
  return toolError(
    "which captions? pass effect_id or timeline_clip_id: " +
      candidates
        .slice(0, 6)
        .map(([c, e]) => `${e.id} on ${c.id} (${clipLabel(c)})`)
        .join(", "),
  );
}

const LOOK_KEYS = ["text_size", "font", "text_color", "stroke_color", "stroke_width", "background_color", "background_opacity", "position", "fade"] as const;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Python `str.count` / `str.replace` for a non-empty literal. */
function countOf(text: string, find: string): number {
  return text.split(find).length - 1;
}

export const captionTools = [
  contractTool("list_captions_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      guarded("list_captions_tool", () => {
        const project = call.doc.project;
        const wanted = String(input.timeline_clip_id ?? "").trim();
        const tracks: Record<string, unknown>[] = [];
        for (const clip of project.clips) {
          if (wanted && clip.id !== wanted) continue;
          for (const effect of captionEffects(clip)) {
            const look = styleFromEffect(effect, project) as unknown as Record<string, unknown>;
            const [start, end] = clipExtent(clip);
            tracks.push({
              timeline_clip_id: clip.id,
              clip_title: clipLabel(clip),
              effect_id: effect.id,
              overlay: clip.zenvi_role === CAPTION_ROLE,
              track: uiTrackNumber(project, clip.layer),
              clip_start: pyRoundTo(start, 3),
              clip_end: pyRoundTo(end, 3),
              cues: cueRows(clip, parseCaptionText(String(effect.caption_text ?? ""))),
              look: Object.fromEntries(LOOK_KEYS.map((k) => [k, look[k]])),
            });
          }
        }
        if (wanted && tracks.length === 0 && !clipById(project, wanted)) toolError(`no timeline clip with id=${pyReprString(wanted)}`);
        const total = tracks.reduce((n, t) => n + (t.cues as unknown[]).length, 0);
        return applied("list_captions_tool", `${tracks.length} caption track(s), ${total} cue(s).`, { data: { caption_tracks: tracks } }, 0);
      }),
  }),

  contractTool("edit_captions_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      guarded("edit_captions_tool", async () => {
        const tool = "edit_captions_tool";
        const edits = input.cue_edits ?? [];
        const extra = givenCues(input.add_cues, "cues");
        const find = input.find ?? "";
        const replace = input.replace ?? "";
        const shift = input.shift_seconds ?? 0;
        const uppercase = input.uppercase ?? false;
        const styleArgs: CaptionStyleArgs = {
          style: input.style ?? "",
          font: input.font ?? "",
          text_size: input.text_size ?? 0,
          text_color: input.text_color ?? "",
          stroke_color: input.stroke_color ?? "",
          stroke_width: input.stroke_width ?? -1,
          background_color: input.background_color ?? "",
          background_opacity: input.background_opacity ?? -1,
          position: input.position ?? "",
          fade_seconds: input.fade_seconds ?? -1,
        };
        const restyle = restyleRequested(styleArgs);
        if (replace && !find) toolError("replace needs find (the text to replace)");
        if (!(edits.length > 0 || extra.length > 0 || find || shift || restyle || uppercase)) {
          toolError("nothing to change: pass cue_edits, add_cues, find/replace, shift_seconds, uppercase or style fields");
        }
        const [clip, effect] = await findCaptionEffect(call, String(input.effect_id ?? "").trim(), String(input.timeline_clip_id ?? "").trim(), String(input.clip_query ?? "").trim());
        if (isLocked(call.doc.project, clip.layer)) toolError(`clip ${clip.id} is on a locked track; unlock it first`);
        let cues = parseCaptionText(String(effect.caption_text ?? "")).sort((a, b) => a.start - b.start || a.end - b.end);
        const count = cues.length;
        const changes: string[] = [];

        const deleted = new Set<number>();
        edits.forEach((ed, i) => {
          const n = i + 1;
          const idx = Math.trunc(Number(ed.index) || 0);
          if (idx < 1 || idx > count) toolError(`cue_edits[${n}]: there is no cue ${idx} (the captions have ${count})`);
          const cue = cues[idx - 1]!;
          if (ed.delete) {
            deleted.add(idx - 1);
            changes.push(`deleted cue ${idx}`);
            return;
          }
          if (ed.text !== undefined) {
            const newText = String(ed.text ?? "").trim();
            if (!newText) toolError(`cue_edits[${n}]: empty text (use delete=true to remove the cue)`);
            cue.text = newText;
            changes.push(`cue ${idx} text`);
          }
          const start = ed.start !== undefined && ed.start !== null ? timelineToCaption(clip, Number(ed.start)) : cue.start;
          const end = ed.end !== undefined && ed.end !== null ? timelineToCaption(clip, Number(ed.end)) : cue.end;
          if (end <= start) toolError(`cue_edits[${n}]: end must be after start`);
          if (start !== cue.start || end !== cue.end) {
            cue.start = start;
            cue.end = end;
            changes.push(`cue ${idx} timing`);
          }
        });
        cues = cues.filter((_, i) => !deleted.has(i));

        const [, srcStart, srcEnd] = clipWindow(clip);
        for (const q of extra) {
          const s = timelineToCaption(clip, q.start);
          const e = timelineToCaption(clip, q.end);
          if (e <= srcStart || s >= srcEnd) {
            toolError(
              `the new cue at ${pyFixed(q.start, 2)}-${pyFixed(q.end, 2)}s is outside clip ${clip.id} ` +
                `(${pyFixed(captionToTimeline(clip, srcStart), 2)}-${pyFixed(captionToTimeline(clip, srcEnd), 2)}s)`,
            );
          }
          cues.push({ start: Math.max(s, srcStart), end: Math.min(e, srcEnd), text: q.text });
          changes.push("added a cue");
        }

        if (find) {
          let hits = 0;
          for (const q of cues) {
            const shown = displayText(q.text);
            if (shown.includes(find)) {
              hits += countOf(shown, find);
              q.text = shown.split(find).join(replace);
            }
          }
          if (!hits) toolError(`no caption contains ${pyReprString(find)}`);
          changes.push(`replaced ${hits} x ${pyReprString(find)}`);
        }
        if (shift) {
          for (const q of cues) {
            q.start += shift;
            q.end += shift;
          }
          cues = cues.filter((q) => q.end > 0);
          for (const q of cues) q.start = Math.max(0, q.start);
          changes.push(`shifted ${shift >= 0 ? "+" : ""}${pyFixed(shift, 2)}s`);
        }
        if (uppercase) {
          for (const q of cues) q.text = displayText(q.text).toUpperCase();
          changes.push("uppercase");
        }

        const [ready] = prepareCues(
          cues.map((q) => ({ start: q.start, end: q.end, text: displayText(q.text) })),
          false,
        );
        if (ready.length === 0) toolError("that would leave no captions; use remove_captions_tool to remove them");

        const newEffect: Effect = { ...structuredClone(effect), caption_text: buildCaptionText(ready) };
        let look: Record<string, unknown> | undefined;
        if (restyle) {
          const style = new CaptionStyle(styleArgs, styleFromEffect(effect, call.doc.project));
          style.resolveFont();
          Object.assign(newEffect, structuredClone(style.properties(call.doc.project, 2)));
          look = style.summary();
          changes.push("restyled");
        }
        if (sameJson(newEffect, effect)) toolError("the captions already look like that; nothing changed");

        const effects = (clip.effects ?? []).map((e) => (e.id === effect.id ? newEffect : e));
        const after = call.commit((tx) => replaceClipEffects(tx, clip.id, effects));
        const rows = cueRows(after, parseCaptionText(String(newEffect.caption_text)));
        const data: Record<string, unknown> = { timeline_clip_id: clip.id, effect_id: effect.id, changes, cues: rows };
        if (look) data.look = look;
        return applied(tool, summaryLine(`Updated captions on ${clip.id}: ${changes.join(", ")} (${rows.length} cue(s)).`), { data });
      }),
  }),

  contractTool("remove_captions_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) =>
      guarded("remove_captions_tool", async () => {
        const project = call.doc.project;
        const targets = new Map<string, [Clip, Set<string>]>();
        const effectId = String(input.effect_id ?? "").trim();
        const clipId = String(input.timeline_clip_id ?? "").trim();
        const clipQuery = String(input.clip_query ?? "").trim();
        if (input.all_captions) {
          for (const clip of project.clips) {
            const effects = captionEffects(clip);
            if (effects.length > 0) targets.set(clip.id, [clip, new Set(effects.map((e) => e.id))]);
          }
          if (targets.size === 0) toolError("there are no captions in the project");
        } else if (effectId) {
          const [clip, effect] = await findCaptionEffect(call, effectId, "", "");
          targets.set(clip.id, [clip, new Set([effect.id])]);
        } else if (clipId || clipQuery) {
          const clip = clipId ? clipById(project, clipId) : await clipByQuery(call, clipQuery);
          if (!clip) return toolError(`no timeline clip with id=${pyReprString(clipId)}`);
          const effects = captionEffects(clip);
          if (effects.length === 0) toolError(`clip ${clip.id} has no captions`);
          targets.set(clip.id, [clip, new Set(effects.map((e) => e.id))]);
        } else {
          const [clip, effect] = await findCaptionEffect(call, "", "", "");
          targets.set(clip.id, [clip, new Set([effect.id])]);
        }
        const locked = [...targets.values()].filter(([c]) => isLocked(project, c.layer)).map(([c]) => c.id);
        if (locked.length > 0) toolError(`clip(s) on locked tracks: ${locked.join(", ")}; unlock first`);

        const removed: string[] = [];
        const overlays: string[] = [];
        call.commit((tx) => {
          for (const [id, [clip, ids]] of targets) {
            replaceClipEffects(
              tx,
              id,
              (clip.effects ?? []).filter((e) => !ids.has(e.id)),
            );
            removed.push(...ids);
            if (clip.zenvi_role === CAPTION_ROLE) overlays.push(id);
          }
        });
        const data: Record<string, unknown> = { removed_effect_ids: [...removed].sort(), timeline_clip_ids: [...targets.keys()].sort() };
        let summary = `Removed ${removed.length} caption track(s) from ${targets.size} clip(s).`;
        if (overlays.length > 0) {
          data.empty_overlay_clip_ids = overlays;
          summary += " The transparent Captions overlay clip(s) remain; delete them with delete_from_timeline_tool.";
        }
        return applied("remove_captions_tool", summary, { data });
      }),
  }),
];
