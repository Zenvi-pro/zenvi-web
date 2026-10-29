/**
 * Zenvi FX tools: footage effects libopenshot lacks (fx/catalog.ts),
 * rendered by the host with ffmpeg and swapped in as linked media.
 *
 * - list_fx_tool: the effects, their params (JSON Schema) and defaults.
 * - apply_fx_tool: add effects to a clip's stack; the clip's source range
 *   renders through the whole stack and the clip plays the render.
 * - update_fx_tool: change one effect of the stack (or replace the stack).
 * - remove_fx_tool: drop one effect (re-render) or all of them (the clip
 *   goes back to the original file at its original times; no render).
 * - datamosh_cut_tool: carry the motion of the clip before a cut into the
 *   first frames of the clip after it (the datamosh_carry effect, which
 *   needs the footage before the cut and so cannot go through apply_fx_tool).
 *
 * Each call is one undo step. Rendering runs before the transaction: a
 * failed or cancelled render leaves history untouched.
 */

import { z } from "zod";
import { FX_IDS, FX_INFO, FX_PARAMS, MAX_FX_STACK, fxEffectInput, fxStretch, parseFxStack, type FxEffect, type FxEffectInput } from "../../fx/catalog.js";
import { FX_RENDERER_VERSION } from "../../fx/graph.js";
import { fxLink, readFxLink, type FxRender } from "../../fx/link.js";
import { isSingleImageMedia } from "../../model/media.js";
import { clipsUsingFile, findLayer } from "../../model/query.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { sameJson } from "../../ops/internal.js";
import { linkFxRender, relinkFxRender, unlinkFxRender } from "../../ops/fx.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged, type ToolReceipt } from "../receipt.js";
import { isRetimed } from "../speech.js";
import type { ImportedMedia } from "../types.js";

const LIST = "list_fx_tool";
const APPLY = "apply_fx_tool";
const UPDATE = "update_fx_tool";
const REMOVE = "remove_fx_tool";
const DATAMOSH = "datamosh_cut_tool";

/** Longest source range one render takes (minutes of ProRes per call would stall the agent). */
const MAX_RANGE_SECONDS = 120;

const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const FX_LINES = FX_IDS.map((id) => `${id}: ${FX_INFO[id].summary}`).join(" ");

const clipId = z.string().min(1).describe("Timeline clip id (from describe_project_tool, list_clips_tool or a receipt).");

const applyInput = z.strictObject({
  clip_id: clipId,
  effects: z.array(fxEffectInput).min(1).max(MAX_FX_STACK).describe("Effects to add after the clip's current FX, in order."),
});
type ApplyInput = z.output<typeof applyInput>;

const updateInput = z.strictObject({
  clip_id: clipId,
  index: z.int().min(0).optional().describe("Which effect of the stack, 0-based (default 0; required when the stack has several)."),
  amount: z.number().min(0).max(1).optional(),
  params: z.record(z.string(), z.unknown()).optional().describe("Params to change; the others stay."),
  start: z.number().min(0).optional().describe("New window start, seconds from the clip's start."),
  end: z.number().min(0).optional().describe("New window end, seconds from the clip's start."),
  whole_clip: z.boolean().optional().describe("Drop the window: the effect covers the whole clip."),
  effects: z.array(fxEffectInput).min(1).max(MAX_FX_STACK).optional().describe("Replace the whole stack instead."),
});
type UpdateInput = z.output<typeof updateInput>;

const removeInput = z.strictObject({
  clip_id: clipId,
  index: z.int().min(0).optional().describe("Remove only this effect, 0-based (default: all of them, restoring the original clip)."),
});
type RemoveInput = z.output<typeof removeInput>;

const datamoshInput = z.strictObject({
  clip_id: clipId.describe("The clip AFTER the cut: its first frames get moshed."),
  previous_clip_id: z.string().min(1).optional().describe("The clip before the cut (default: the clip on the same track that ends where this one starts)."),
  length: z.number().min(0.1).max(2).optional().describe("Seconds of the clip's start that are moshed (default 0.6)."),
  amount: z.number().min(0).max(1).optional().describe("How hard the previous clip's motion pushes (default 0.6)."),
  ghost: z.number().min(0).max(1).optional().describe("How much of the previous clip's last frame lingers and fades (default 0.5; 0 = none)."),
  block: z.int().min(8).max(96).optional().describe("Macroblock size in pixels at 1080p (default 32): bigger tears in chunkier pieces."),
});
type DatamoshInput = z.output<typeof datamoshInput>;

/** A clip with what its FX state is: the original file, the source range and the current stack. */
interface FxTarget {
  clip: Clip;
  /** The file the clip plays now (the render, or the original when it has no FX). */
  file: ProjectFile;
  original: ProjectFile;
  range: { start: number; end: number };
  /** The current stack (empty without FX). */
  effects: FxEffect[];
  /** True when the clip already plays a render. */
  linked: boolean;
}

function target(project: Project, tool: string, id: string): FxTarget | ToolReceipt {
  const clip = project.clips.find((c) => String(c.id) === id);
  if (!clip) return refused(tool, `Error: unknown timeline clip ${id}.`);
  const file = project.files.find((f) => String(f.id) === String(clip.file_id));
  if (!file) return refused(tool, `Error: clip ${id} plays file ${String(clip.file_id)}, which is not in the project.`);
  const link = readFxLink(file);
  // Refused before the render: a locked track would only refuse the swap after it.
  const locked = (link ? clipsUsingFile(project, String(file.id)) : [clip]).find((c) => findLayer(project, c.layer)?.lock);
  if (locked) return refused(tool, `Error: clip ${locked.id} is on a locked track; unlock the track first.`);
  if (link) {
    const original = project.files.find((f) => String(f.id) === link.source.file_id);
    if (!original) return refused(tool, `Error: clip ${id} plays an FX render of file ${link.source.file_id}, which is no longer in the project.`);
    const parsed = parseFxStack(link.effects, link.source.end - link.source.start);
    if (!parsed.ok) return refused(tool, `Error: the stored FX of clip ${id} are not valid (${parsed.error}); remove_fx_tool restores the original.`);
    return { clip, file, original, range: { start: link.source.start, end: link.source.end }, effects: parsed.effects, linked: true };
  }
  if (!file.has_video || isSingleImageMedia(file)) return refused(tool, `Error: clip ${id} is not video footage; FX render video clips.`);
  if (isRetimed(clip)) return refused(tool, `Error: clip ${id} plays at another speed or through a time curve; apply FX before retiming it.`);
  const start = Number(clip.start);
  const end = Number(clip.end);
  if (!(end > start)) return refused(tool, `Error: clip ${id} has an empty source range.`);
  if (end - start > MAX_RANGE_SECONDS) return refused(tool, `Error: clip ${id} is ${round(end - start)}s long; FX render at most ${MAX_RANGE_SECONDS}s at a time (split it first).`);
  return { clip, file, original: file, range: { start, end }, effects: [], linked: false };
}

/** Clip-relative windows read against the source range's length. */
function parse(tool: string, raw: readonly unknown[], t: FxTarget): FxEffect[] | ToolReceipt {
  const parsed = parseFxStack(raw, t.range.end - t.range.start);
  if (!parsed.ok) return refused(tool, `Error: ${parsed.error}`);
  const mosh = parsed.effects.find((e): e is FxEffect<"datamosh_carry"> => e.effect === "datamosh_carry");
  if (mosh && !mosh.params.carry) return refused(tool, `Error: datamosh_carry needs the footage before the cut; use ${DATAMOSH} (it finds the previous clip).`);
  return parsed.effects;
}

/** The footage a datamosh_carry in the stack carries the motion of: its file's path and end second. */
function carryOf(tool: string, project: Project, effects: readonly FxEffect[]): { path: string; at: number } | undefined | ToolReceipt {
  const mosh = effects.find((e): e is FxEffect<"datamosh_carry"> => e.effect === "datamosh_carry");
  const carry = mosh?.params.carry;
  if (!carry) return undefined;
  const file = project.files.find((f) => String(f.id) === carry.file_id);
  if (!file) return refused(tool, `Error: the footage before the cut (file ${carry.file_id}) is no longer in the project; run ${DATAMOSH} again.`);
  return { path: String(file.path), at: carry.at };
}

/** The clip a datamosh follows: the one given, else the clip on the same track that ends at (or just before) this one's start. */
function previousClip(project: Project, clip: Clip, given: string | undefined): { clip: Clip } | ToolReceipt {
  const endOf = (c: Clip) => Number(c.position) + (Number(c.end) - Number(c.start));
  if (given !== undefined) {
    const found = project.clips.find((c) => String(c.id) === given);
    if (!found) return refused(DATAMOSH, `Error: unknown timeline clip ${given}.`);
    if (found.id === clip.id) return refused(DATAMOSH, "Error: previous_clip_id is the clip itself.");
    return { clip: found };
  }
  const near = project.clips
    .filter((c) => c.layer === clip.layer && c.id !== clip.id && Number(c.position) < Number(clip.position) && Math.abs(endOf(c) - Number(clip.position)) <= 0.5)
    .sort((a, b) => endOf(b) - endOf(a));
  return near[0] ? { clip: near[0] } : refused(DATAMOSH, `Error: no clip ends at the start of ${clip.id} on its track; give previous_clip_id.`);
}

async function render(call: ToolCall, tool: string, t: FxTarget, effects: FxEffect[]): Promise<{ render: FxRender; imported: ImportedMedia } | ToolReceipt> {
  let result: FxRender;
  const carry = carryOf(tool, call.doc.project, effects);
  if (carry && "status" in carry) return carry;
  try {
    result = await call.host.fx!.render({ path: String(t.original.path), start: t.range.start, end: t.range.end, effects, ...(carry ? { carry } : {}), signal: call.signal });
  } catch (error) {
    return failed(tool, `Error: the FX render failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { render: result, imported: await call.host.media!.importPath!(result.path) };
  } catch (error) {
    return failed(tool, `Error: ${tool} could not import the render ${result.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Render `effects` for the target and put its clip (or every clip of its render) on the result. */
async function renderAndSwap(call: ToolCall, tool: string, t: FxTarget, effects: FxEffect[], label: string, extra: Record<string, unknown> = {}): Promise<ToolReceipt> {
  if (t.linked && sameJson(effects, t.effects)) return unchanged(tool, `Clip ${t.clip.id} already has these FX.`, { data: summaryData(t, t.effects) });
  const done = await render(call, tool, t, effects);
  if ("status" in done) return done;
  const { render: r, imported } = done;
  const stretch = fxStretch(effects);
  const link = fxLink({ file_id: String(t.original.id), start: t.range.start, end: t.range.end }, effects, r, FX_RENDERER_VERSION);
  const base = String(t.original.name ?? t.original.path ?? "clip").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const result = call.commit((tx) => {
    if (!t.linked) {
      const { file } = linkFxRender(tx, { clipId: String(t.clip.id), media: imported, link, name: `${base}-fx-${r.fingerprint.slice(0, 8)}.mov`, stretch });
      return { fileId: String(file.id), clipIds: [String(t.clip.id)] };
    }
    const clips = relinkFxRender(tx, String(t.file.id), imported, link, fxStretch(t.effects), stretch);
    return { fileId: String(t.file.id), clipIds: clips.map((c) => String(c.id)) };
  }, label);
  const clip = call.doc.project.clips.find((c) => String(c.id) === String(t.clip.id));
  const names = effects.map((e) => e.effect).join(" + ");
  const notes: string[] = [];
  if (stretch !== fxStretch(t.effects)) notes.push(`The clip is now ${round(Number(clip?.end) - Number(clip?.start))}s long on the timeline (slow motion); move or trim the clips after it if they should not overlap.`);
  return applied(tool, `Clip ${t.clip.id} now plays ${names} (${r.cached ? "from the render cache" : `rendered in ${r.seconds.toFixed(1)}s`}).`, {
    notes,
    data: {
      ...summaryData({ ...t, file: call.doc.project.files.find((f) => String(f.id) === result.fileId) ?? t.file }, effects),
      timeline_clip_ids: result.clipIds,
      ...extra,
      render: { codec: r.codec, alpha: r.codec === "prores4444", width: r.width, height: r.height, frames: r.frames, duration: round(r.duration), fingerprint: r.fingerprint, cached: r.cached, render_seconds: round(r.seconds) },
    },
  });
}

function summaryData(t: FxTarget, effects: readonly FxEffect[]): Record<string, unknown> {
  return {
    timeline_clip_id: t.clip.id,
    file_id: t.file.id,
    original_file_id: t.original.id,
    source_range: [round(t.range.start), round(t.range.end)],
    effects: effects.map((e, index) => ({ index, ...e })),
  };
}

function needsImport(call: ToolCall, tool: string): ToolReceipt | null {
  return call.host.media?.importPath ? null : unavailable(tool, "it cannot import rendered movies from this computer.");
}

function paramsSchema(id: (typeof FX_IDS)[number]): Record<string, unknown> {
  const { $schema: _schema, ...json } = z.toJSONSchema(FX_PARAMS[id], { io: "input" }) as Record<string, unknown>;
  return json;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export const fxTools: CatalogTool[] = [
  directTool({
    name: LIST,
    title: "List FX",
    description:
      "The Zenvi FX apply_fx_tool renders onto footage with ffmpeg: what each does, its default amount and its params as JSON Schema, and whether this Zenvi surface can render them.",
    input: z.strictObject({ effect: z.enum(FX_IDS).optional().describe("Only this effect.") }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (call, args: { effect?: (typeof FX_IDS)[number] }) => {
      const ids = args.effect ? [args.effect] : [...FX_IDS];
      const effects = ids.map((id) => ({ ...FX_INFO[id], params: paramsSchema(id) }));
      const here = call.host.fx !== undefined;
      return applied(LIST, `${ids.length} FX${here ? "" : "; this surface cannot render them (ffmpeg runs with the zenvi CLI / local MCP server)"}.`, { data: { available: here, effects } }, 0);
    },
  }),
  directTool({
    name: APPLY,
    title: "Apply FX",
    description:
      "Render footage effects libopenshot lacks onto a video clip with ffmpeg, in one undo step. " +
      FX_LINES +
      " Each effect takes amount 0-1 (default per effect), params (list_fx_tool) and an optional start/end window in seconds of the clip. " +
      "The clip's source range renders through its whole stack (ProRes; 4444 keeps alpha, cached by fingerprint) and the clip plays the render; remove_fx_tool restores the original. " +
      "Use short windows on cuts for punch (zoom blur 0.2-0.4 s, glitch 0.3 s); check with preview_frame.",
    input: applyInput,
    annotations: EDIT,
    requires: ["fx", "media"],
    run: async (call, args: ApplyInput) => {
      const missing = needsImport(call, APPLY);
      if (missing) return missing;
      const t = target(call.doc.project, APPLY, args.clip_id);
      if ("status" in t) return t;
      const effects = parse(APPLY, [...t.effects, ...args.effects], t);
      if ("status" in effects) return effects;
      return renderAndSwap(call, APPLY, t, effects, `Apply FX ${args.effects.map((e) => e.effect).join(" + ")}`);
    },
  }),
  directTool({
    name: UPDATE,
    title: "Update FX",
    description:
      "Change one effect of a clip's FX stack (amount, params merged over the current ones, window, or whole_clip) or replace the whole stack with effects, and re-render. One undo step.",
    input: updateInput,
    annotations: EDIT,
    requires: ["fx", "media"],
    run: async (call, args: UpdateInput) => {
      const missing = needsImport(call, UPDATE);
      if (missing) return missing;
      const t = target(call.doc.project, UPDATE, args.clip_id);
      if ("status" in t) return t;
      if (!t.linked) return refused(UPDATE, `Error: clip ${args.clip_id} has no FX; add some with apply_fx_tool.`);
      let raw: FxEffectInput[];
      if (args.effects) {
        raw = args.effects;
      } else {
        if (args.index === undefined && t.effects.length > 1) return refused(UPDATE, `Error: clip ${args.clip_id} has ${t.effects.length} FX; give index (0-${t.effects.length - 1}).`);
        const index = args.index ?? 0;
        const current = t.effects[index];
        if (!current) return refused(UPDATE, `Error: clip ${args.clip_id} has ${t.effects.length} FX; index ${index} is out of range.`);
        const next: FxEffectInput = { effect: current.effect, amount: args.amount ?? current.amount, params: { ...current.params, ...(args.params ?? {}) } };
        const start = args.start ?? (args.whole_clip ? undefined : current.start);
        const end = args.end ?? (args.whole_clip ? undefined : current.end);
        if (start !== undefined) next.start = start;
        if (end !== undefined) next.end = end;
        raw = t.effects.map((e, i) => (i === index ? next : e));
      }
      const effects = parse(UPDATE, raw, t);
      if ("status" in effects) return effects;
      return renderAndSwap(call, UPDATE, t, effects, "Update FX");
    },
  }),
  directTool({
    name: REMOVE,
    title: "Remove FX",
    description:
      "Remove one effect from a clip's FX stack (the rest re-render), or all of them: the clip plays the original file again at its original source times and the render leaves the bin. One undo step.",
    input: removeInput,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (call, args: RemoveInput) => {
      const t = target(call.doc.project, REMOVE, args.clip_id);
      if ("status" in t) return t;
      if (!t.linked) return unchanged(REMOVE, `Clip ${args.clip_id} has no FX.`);
      if (args.index !== undefined && !t.effects[args.index]) return refused(REMOVE, `Error: clip ${args.clip_id} has ${t.effects.length} FX; index ${args.index} is out of range.`);
      const rest = args.index === undefined ? [] : t.effects.filter((_, i) => i !== args.index);
      if (rest.length > 0) {
        if (!call.host.fx) return unavailable(REMOVE, "removing one of several FX re-renders the rest, which needs Zenvi FX (ffmpeg with the zenvi CLI / local MCP server); remove all of them to restore the original clip.");
        const missing = needsImport(call, REMOVE);
        if (missing) return missing;
        return renderAndSwap(call, REMOVE, t, rest, `Remove FX ${t.effects[args.index!]!.effect}`);
      }
      const clips = call.commit((tx) => unlinkFxRender(tx, String(t.file.id), fxStretch(t.effects)), "Remove FX");
      return applied(REMOVE, `Clip ${args.clip_id} plays the original ${String(t.original.name ?? t.original.id)} again (${clips.length} clip(s) restored).`, {
        data: { timeline_clip_ids: clips.map((c) => c.id), file_id: t.original.id, removed_file_id: t.file.id },
      });
    },
  }),
  directTool({
    name: DATAMOSH,
    title: "Datamosh a cut",
    description:
      "Datamosh the cut into a clip: the previous clip's motion keeps going into the first frames of this one (blocky tearing and smear, the old last frame lingering and fading), then it lands clean. " +
      "Measures the motion of the last frames before the cut, renders the clip's first `length` seconds pushed along it (ProRes via ffmpeg, one undo step), and stacks like any apply_fx_tool effect (update_fx_tool / remove_fx_tool work on it). " +
      "Strongest where the previous clip is moving fast (a whip, a pan, a push-in); a still clip before the cut gives only the fading ghost. Land it on a beat and put a hit under the cut; check with preview_frame. " +
      "It follows the previous clip as trimmed now: if you retrim or move that clip, run this again.",
    input: datamoshInput,
    annotations: EDIT,
    requires: ["fx", "media"],
    run: async (call, args: DatamoshInput) => {
      const missing = needsImport(call, DATAMOSH);
      if (missing) return missing;
      const t = target(call.doc.project, DATAMOSH, args.clip_id);
      if ("status" in t) return t;
      const prev = previousClip(call.doc.project, t.clip, args.previous_clip_id);
      if ("status" in prev) return prev;
      const before = prev.clip;
      const beforeFile = call.doc.project.files.find((f) => String(f.id) === String(before.file_id));
      if (!beforeFile?.has_video || isSingleImageMedia(beforeFile)) return refused(DATAMOSH, `Error: clip ${before.id} is not video footage; there is no motion to carry.`);
      const carry = { file_id: String(before.file_id), at: Number(before.end) };
      const params: Record<string, unknown> = { carry };
      if (args.length !== undefined) params.length = args.length;
      if (args.ghost !== undefined) params.ghost = args.ghost;
      if (args.block !== undefined) params.block = args.block;
      const mosh: FxEffectInput = { effect: "datamosh_carry", params, ...(args.amount !== undefined ? { amount: args.amount } : {}) };
      // Last in the stack so the other looks are pushed around with the picture; a second run replaces the first.
      const kept = t.effects.filter((e) => e.effect !== "datamosh_carry");
      const effects = parse(DATAMOSH, [...kept, mosh], t);
      if ("status" in effects) return effects;
      return renderAndSwap(call, DATAMOSH, t, effects, "Datamosh cut", { previous_clip_id: String(before.id), carry });
    },
  }),
];
