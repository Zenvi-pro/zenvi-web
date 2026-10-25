/**
 * Effects-color editor tools, part 1: the effect catalog and editing the
 * effects on clips — list_effects_tool, get_clip_effects_tool,
 * update_effect_tool, remove_effect_tool, copy_effects_tool — and
 * process_clip_effect_tool, which the web surfaces refuse.
 *
 * Ports of zenvi-core develop (1f80cb3d0) src/classes/editor_tools/
 * effects_color.py and effects_color_process.py: same arguments, validation,
 * error wording and receipts (the summary line, with the desktop's receipt
 * object as `data`). Every change is one undo step; refusals record none.
 * list_effects_tool and remove_effect_tool replace the web's older direct
 * tools of the same names, whose arguments stay as aliases (category = kind,
 * effect_id = one of effect_ids).
 */

import type { Clip, Effect } from "../../model/types.js";
import { createEffect, getEffect } from "../../effects/registry.js";
import { assignNewEffectIds, mergeEffectsByClass, setClipEffects, updateEffectValues } from "../../ops/effects.js";
import { idFactory } from "../../model/ids.js";
import { sameJson } from "../../ops/internal.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { LutError, resolveCheckedLut } from "../luts.js";
import { pyReprString } from "../pyfmt.js";
import {
  COMMON_PROPERTIES,
  effectCatalog,
  effectKind,
  normName,
  resolveEffectName,
  type CatalogEffect,
  type CatalogProperty,
} from "./effect-catalog.js";
import { effectValueSummary, needsLuts, prepareProperties, type ValueContext } from "./effect-values.js";
import {
  clipEffects,
  clipLabel,
  compatibilityProblem,
  findEffect,
  isLocked,
  lockedMessage,
  resolveClipsList,
  resolveOneClip,
  targetClips,
  type EffectTargets,
  type SkippedClip,
} from "./effects-color-common.js";
import { editorRun, nothingChanged, ok, ToolError, uiTrack } from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A fresh effect of `className` with a new id (effect_ops.create_effect_json). */
export function newEffectFactory(call: ToolCall): (className: string) => Effect {
  const nextId = idFactory(call.doc.project);
  return (className) => createEffect(className, {}, { id: nextId() });
}

/**
 * The context property conversion needs, with a `lut_path` property resolved
 * and checked first: a LUT file outside the built-ins is read through the
 * host (effects_color.needs_luts / effect_ops.resolve_lut).
 */
export async function valueContext(call: ToolCall, properties: unknown): Promise<ValueContext> {
  const ctx: ValueContext = { project: call.doc.project };
  if (needsLuts(properties)) ctx.lutPath = await lutArgument(call, (properties as Record<string, unknown>).lut_path);
  return ctx;
}

/** A LUT argument resolved and checked (tools/luts.ts), its problems in the desktop's ToolError words. */
export async function lutArgument(call: ToolCall, value: unknown): Promise<string> {
  try {
    return await resolveCheckedLut(call, value);
  } catch (error) {
    if (error instanceof LutError) throw new ToolError(error.message);
    throw error;
  }
}

/** effects_color._common_properties: the EffectBase properties every effect has, described once. */
function commonProperties(): Record<string, unknown> {
  const cat = effectCatalog();
  const sample = cat.get("Blur") ?? [...cat.values()][0]!;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sample.properties)) {
    if ((COMMON_PROPERTIES as readonly string[]).includes(key)) out[key] = value;
  }
  out.mask_source_id = {
    type: "string",
    about:
      "effect id of a Tracker / Object Detector / Object Mask effect: limit this effect to the tracked region (mask_invert=1 for outside it)",
  };
  return out;
}

/** The web renderers cannot draw OpenCV effects (Outline and the processing effects): say so in the listing. */
function rendersHere(className: string): boolean {
  return getEffect(className)?.supported.web ?? true;
}

function withRenderNote<T extends Record<string, unknown>>(row: T, className: string): T {
  if (!rendersHere(className)) (row as Record<string, unknown>).renders_on_web = false;
  return row;
}

function effectSpec(spec: CatalogEffect): Record<string, unknown> {
  return withRenderNote({ ...spec, properties: { ...spec.properties } }, spec.effect);
}

/** The keys of `values` whose JSON differs from `before` (Python `before.get(k) != v`). */
function changedValues(before: Readonly<Record<string, unknown>>, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => !sameJson(before[key], value)));
}

/** effects_color._effects_to_edit: [(clip, effect)] by id, or by clip(s) + effect class (+ the Nth of that class). */
async function effectsToEdit(
  call: ToolCall,
  input: EffectTargets & { effect_id?: string; effect?: string; occurrence?: number },
): Promise<{ targets: [Clip, Effect][]; skipped: SkippedClip[] }> {
  const project = call.doc.project;
  if (input.effect_id) {
    const { clip, effect } = findEffect(project, input.effect_id);
    if (isLocked(project, clip.layer)) throw new ToolError(lockedMessage(project, clip));
    return { targets: [[clip, effect]], skipped: [] };
  }
  if (!input.effect) throw new ToolError("give effect_id (from get_clip_effects_tool), or a clip plus the effect name");
  const className = resolveEffectName(input.effect);
  const { clips, explicit } = await targetClips(call, {
    timeline_clip_id: input.timeline_clip_id,
    clip_query: input.clip_query,
    track: input.track,
    timeline_clip_ids: input.timeline_clip_ids,
    scope: input.scope,
  });
  const out: [Clip, Effect][] = [];
  const skipped: SkippedClip[] = [];
  const occurrence = input.occurrence ?? 0;
  for (const clip of clips) {
    if (isLocked(project, clip.layer)) {
      const msg = lockedMessage(project, clip);
      if (explicit) throw new ToolError(msg);
      skipped.push({ timeline_clip_id: clip.id, reason: msg });
      continue;
    }
    const matches = clipEffects(clip).filter((e) => e.class_name === className);
    if (matches.length === 0) {
      const msg = `clip ${clipLabel(project, clip)} has no ${className} effect (add it with add_effect_tool)`;
      if (explicit) throw new ToolError(msg);
      skipped.push({ timeline_clip_id: clip.id, reason: msg });
      continue;
    }
    if (occurrence && occurrence > matches.length) throw new ToolError(`clip ${clip.id} has only ${matches.length} ${className} effect(s)`);
    out.push([clip, matches[(occurrence || 1) - 1]!]);
  }
  if (out.length === 0) throw new ToolError(skipped[0]?.reason ?? "no effect to change");
  return { targets: out, skipped };
}

export const effectsColorTools: CatalogTool[] = [
  contractTool("list_effects_tool", {
    annotations: READ,
    run: (call, input) =>
      editorRun(() => {
        const cat = effectCatalog();
        // The web's older list_effects_tool took category (video | audio).
        const kind = (input.kind ?? "all") === "all" && input.category ? input.category : (input.kind ?? "all");
        const query = input.query ?? "";
        if (input.effect) {
          const cn = resolveEffectName(input.effect);
          const spec = cat.get(cn)!;
          return ok(call, `${spec.name} (${cn}): ${spec.description}`, { effect: effectSpec(spec), common_properties: commonProperties() });
        }
        const q = normName(query);
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const rows: Record<string, unknown>[] = [];
        const sorted = [...cat.entries()].sort(([a, sa], [b, sb]) => (sa.kind < sb.kind ? -1 : sa.kind > sb.kind ? 1 : a < b ? -1 : a > b ? 1 : 0));
        for (const [cn, spec] of sorted) {
          if (kind !== "all" && spec.kind !== kind) continue;
          const hay = `${cn} ${spec.name} ${spec.description}`.toLowerCase();
          if (q && !(normName(hay).includes(q) || words.every((w) => hay.includes(w)))) continue;
          const row: Record<string, unknown> = { effect: spec.effect, name: spec.name, description: spec.description, kind: spec.kind };
          if (spec.needs_processing) row.needs_processing = true;
          const own = Object.entries(spec.properties).filter(([k]) => !(COMMON_PROPERTIES as readonly string[]).includes(k));
          if (input.include_properties) row.properties = Object.fromEntries(own) as Record<string, CatalogProperty>;
          else row.property_names = own.map(([k]) => k);
          rows.push(withRenderNote(row, cn));
        }
        if (rows.length === 0) {
          throw new ToolError(`no ${kind !== "all" ? kind : ""} effect matches ${pyReprString(query)}`.replace("  ", " "));
        }
        return ok(call, `${rows.length} effect(s)${query ? ` matching ${pyReprString(query)}` : ""}`, {
          effects: rows,
          common_properties: input.include_properties ? commonProperties() : [...COMMON_PROPERTIES],
        });
      }),
  }),

  contractTool("get_clip_effects_tool", {
    annotations: READ,
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const { clips } = await targetClips(call, input);
        const detail = input.detail ?? "full";
        const rows: Record<string, unknown>[] = [];
        let total = 0;
        for (const clip of clips) {
          const effects: Record<string, unknown>[] = [];
          for (const e of clipEffects(clip)) {
            const cn = String(e.class_name || (e as Record<string, unknown>).type || "");
            const row: Record<string, unknown> = { effect_id: e.id ?? null, effect: cn, name: (e as Record<string, unknown>).name || cn, kind: effectKind(cn) };
            if (e["ui-menu"] === "look") row.look_preset = true;
            if (detail === "full" && effectCatalog().has(cn)) row.values = effectValueSummary(project, cn, e, clip);
            effects.push(row);
          }
          total += effects.length;
          rows.push({ timeline_clip_id: clip.id, title: clip.title ?? null, track: uiTrack(project, Number(clip.layer) || 0), effects });
        }
        let summary = `${total} effect(s) on ${rows.length} clip(s)`;
        if (rows.length === 1) {
          const names = (rows[0]!.effects as Record<string, unknown>[]).map((e) => String(e.effect)).join(", ") || "none";
          summary = `Clip ${String(rows[0]!.timeline_clip_id)} has ${total} effect(s): ${names}`;
        }
        return ok(call, summary, { clips: rows });
      }),
  }),

  contractTool("update_effect_tool", {
    annotations: EDIT,
    run: (call, input) =>
      editorRun(async () => {
        const properties = input.properties;
        if (!isRecord(properties) || Object.keys(properties).length === 0) throw new ToolError('properties is required, e.g. {"sigma": 6}');
        const { targets, skipped } = await effectsToEdit(call, input);
        const ctx = await valueContext(call, properties);
        const changes: [string, string, Record<string, unknown>][] = [];
        const rows: Record<string, unknown>[] = [];
        for (const [clip, eff] of targets) {
          const cn = String(eff.class_name || "");
          if (!effectCatalog().has(cn)) throw new ToolError(`effect ${String(eff.id)} (${cn}) is not in this libopenshot build`);
          const values = prepareProperties(ctx, cn, properties, eff, clip, input.interpolation ?? "bezier");
          const changed = changedValues(eff, values);
          rows.push({ timeline_clip_id: clip.id, effect_id: eff.id ?? null, effect: cn, changed: Object.keys(changed).sort() });
          if (Object.keys(changed).length > 0) changes.push([clip.id, String(eff.id), changed]);
        }
        if (changes.length === 0) return nothingChanged(call, "Those values are already set; nothing changed.", { effects: rows });
        call.commit((tx) => {
          for (const [, eid, values] of changes) updateEffectValues(tx, eid, values);
        });
        const names = [...new Set(changes.flatMap(([, , v]) => Object.keys(v)))].sort();
        return ok(call, `Updated ${names.join(", ")} on ${changes.length} effect(s).`, { changed: true, effects: rows, skipped });
      }),
  }),

  contractTool("remove_effect_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const perClip = new Map<string, Set<string>>();
        // effect_id is the web's older single-id argument.
        const idList = [...(input.effect_ids ?? []), ...(input.effect_id ? [input.effect_id] : [])]
          .map((i) => String(i).trim())
          .filter(Boolean);
        if (idList.length > 0) {
          for (const eid of idList) {
            const { clip } = findEffect(project, eid);
            if (isLocked(project, clip.layer)) throw new ToolError(lockedMessage(project, clip));
            if (!perClip.has(clip.id)) perClip.set(clip.id, new Set());
            perClip.get(clip.id)!.add(eid);
          }
        } else {
          if (!input.effect && !input.all_effects) throw new ToolError("give effect_ids, an effect name with the clip(s), or all_effects=true");
          const className = input.effect ? resolveEffectName(input.effect) : null;
          const { clips, explicit } = await targetClips(call, input);
          for (const clip of clips) {
            if (isLocked(project, clip.layer)) {
              if (explicit) throw new ToolError(lockedMessage(project, clip));
              continue;
            }
            const hits = new Set(clipEffects(clip).filter((e) => className === null || e.class_name === className).map((e) => String(e.id)));
            if (hits.size > 0) perClip.set(clip.id, hits);
          }
        }
        if (perClip.size === 0) {
          const what = input.effect ? `a ${input.effect} effect` : "effects";
          return nothingChanged(call, `No clip has ${what} to remove; nothing changed.`, { removed: [] });
        }
        const changes: [string, Effect[]][] = [];
        const removed: Record<string, unknown>[] = [];
        for (const [cid, hits] of perClip) {
          const clip = project.clips.find((c) => c.id === cid)!;
          const all = clipEffects(clip);
          removed.push(...all.filter((e) => hits.has(String(e.id))).map((e) => ({ timeline_clip_id: cid, effect_id: e.id ?? null, effect: e.class_name ?? null })));
          changes.push([cid, all.filter((e) => !hits.has(String(e.id)))]);
        }
        call.commit((tx) => {
          for (const [cid, effects] of changes) setClipEffects(tx, cid, effects);
        });
        return ok(call, `Removed ${removed.length} effect(s) from ${changes.length} clip(s).`, { changed: true, removed });
      }),
  }),

  contractTool("copy_effects_tool", {
    annotations: EDIT,
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const source = await resolveOneClip(call, { timeline_clip_id: input.source_clip_id ?? "", clip_query: input.source_clip_query ?? "", track: "" });
        const wanted = (input.effects ?? []).filter((e) => String(e).trim()).map((e) => resolveEffectName(e));
        const copied = clipEffects(source).filter((e) => wanted.length === 0 || wanted.includes(String(e.class_name)));
        if (copied.length === 0) {
          const what = wanted.length > 0 ? wanted.join(", ") : "any effects";
          throw new ToolError(`source clip ${clipLabel(project, source)} has no ${what} to copy`);
        }
        const targetIds = (input.timeline_clip_ids ?? []).map((i) => String(i).trim()).filter((i) => i && i !== source.id);
        let clips: Clip[];
        let explicit: boolean;
        if (targetIds.length > 0) {
          clips = resolveClipsList(call, targetIds);
          explicit = true;
        } else if (input.scope) {
          clips = resolveClipsList(call, undefined, input.scope, input.track ?? "").filter((c) => c.id !== source.id);
          explicit = false;
        } else if (input.clip_query) {
          clips = [await resolveOneClip(call, { clip_query: input.clip_query, track: input.track ?? "" })];
          explicit = true;
        } else {
          throw new ToolError("name the target clips (timeline_clip_ids, clip_query or scope)");
        }
        if (clips.length === 0) throw new ToolError("no target clips other than the source");
        const classes = [...new Set(copied.map((e) => String(e.class_name)))];
        const mode = input.mode ?? "merge";
        const nextId = idFactory(project);
        const changes: [string, Effect[]][] = [];
        const skipped: SkippedClip[] = [];
        const rows: Record<string, unknown>[] = [];
        for (const clip of clips) {
          const problem = classes.map((cn) => compatibilityProblem(project, clip, cn)).find((p) => p !== null) ?? null;
          if (problem) {
            if (explicit) throw new ToolError(problem);
            skipped.push({ timeline_clip_id: clip.id, reason: problem });
            continue;
          }
          const current = clipEffects(clip);
          let next: Effect[];
          if (mode === "merge") {
            next = mergeEffectsByClass(current, copied, nextId);
          } else {
            const fresh = copied.map((e) => structuredClone(e));
            assignNewEffectIds(fresh, nextId);
            next = mode === "replace" ? fresh : [...current.map((e) => structuredClone(e)), ...fresh];
          }
          changes.push([clip.id, next]);
          rows.push({ timeline_clip_id: clip.id, effects: next.map((e) => e.class_name ?? null) });
        }
        if (changes.length === 0) throw new ToolError(skipped[0]?.reason ?? "no target clips");
        call.commit((tx) => {
          for (const [cid, effects] of changes) setClipEffects(tx, cid, effects);
        });
        return ok(call, `Copied ${copied.length} effect(s) from clip ${source.id} onto ${changes.length} clip(s) (${mode}).`, {
          source_clip_id: source.id,
          copied: classes.filter(Boolean).sort(),
          clips: rows,
          skipped,
        });
      }),
  }),

  contractTool("process_clip_effect_tool", {
    annotations: EDIT,
    // effects_color_process.py runs libopenshot's OpenCV ClipProcessingJobs (stabilization, tracking,
    // YOLO detection, EfficientSAM/Cutie masks) on the clip; no web renderer has OpenCV.
    run: (call, input) =>
      unavailable(
        call.tool,
        `${input.effect} analysis (Stabilizer, Tracker, Object Detector, Object Mask) runs on OpenCV inside Zenvi desktop only. ` +
          "Open the project in Zenvi desktop to stabilize, track or detect objects; the effects it adds play back there.",
      ),
  }),
];
