/**
 * Phase-3 contract tools: add_effect_tool, set_keyframes_tool,
 * set_project_setting_tool (add_title_tool lives in titles.ts).
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/agent_tools/effects.py,
 * keyframes.py and project_settings.py, with develop 1f80cb3d0's
 * add_effect if_exists and set_keyframes point times, interpolation and
 * modes (editor_tools/effects_color.py, clip_props.py). They return
 * structured contract-3 receipts like the desktop.
 */

import { pyRound } from "../../model/rounding.js";
import { Interpolation, type Clip, type Fraction } from "../../model/types.js";
import { EFFECTS, getEffect } from "../../effects/registry.js";
import { addEffect } from "../../ops/effects.js";
import { setClipKeyframes } from "../../ops/clips.js";
import type { KeyframePointInput } from "../../ops/types.js";
import { setProjectSettings, type ProjectSettingsPatch } from "../../ops/project.js";
import { fpsFromRate } from "../../timeline/time.js";
import { contractTool, type CatalogTool } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pendingArgumentMessage } from "../pending.js";
import { pyRepr, pyReprString } from "../pyfmt.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import { resolveClip, text } from "./common.js";

/** agent_tools/keyframes.py ALLOWED_PROPERTIES. */
export const KEYFRAME_PROPERTIES = ["volume", "alpha", "location_x", "location_y", "scale_x", "scale_y", "rotation"] as const;

const TIME_UNITS = ["frame", "seconds", "timeline_seconds", "source_seconds"] as const;

const INTERPOLATIONS: Record<"bezier" | "linear" | "constant", Interpolation> = {
  bezier: Interpolation.BEZIER,
  linear: Interpolation.LINEAR,
  constant: Interpolation.CONSTANT,
};

/**
 * Keyframe X arithmetic for one clip (zenvi-core develop
 * editor_tools/clip_props_model.py ClipTime): X is a 1-based frame that
 * counts the trimmed-off source frames, so the first visible frame is
 * round(start * fps) + 1; `seconds` count from that frame.
 */
function clipTime(clip: Clip, fps: Fraction) {
  const rate = fps.num / fps.den;
  const start = Number(clip.start) || 0;
  const end = Number(clip.end) || 0;
  const position = Number(clip.position) || 0;
  const first = pyRound(start * rate) + 1;
  const last = Math.max(first, pyRound(end * rate) + 1);
  const duration = Math.max(0, end - start);
  return {
    first,
    last,
    frameOf(unit: (typeof TIME_UNITS)[number], amount: number): number {
      if (unit === "frame") return amount;
      if (unit === "seconds") return pyRound((start + amount) * rate) + 1;
      if (unit === "timeline_seconds") return pyRound((start + amount - position) * rate) + 1;
      return pyRound(amount * rate) + 1;
    },
    ranges:
      `frames ${first}-${last}, seconds 0-${duration.toFixed(3)} from the clip's start, ` +
      `timeline_seconds ${position.toFixed(3)}-${(position + duration).toFixed(3)}, source_seconds ${start.toFixed(3)}-${end.toFixed(3)}`,
  };
}

export const phase3Tools: CatalogTool[] = [
  contractTool("add_effect_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, input) => {
      const tool = "add_effect_tool";
      const name = text(input.effect) || text(input.effect_name);
      if (!name) return refused(tool, "Error: add_effect_tool needs effect (EffectInfo class_name).");
      const def = getEffect(name);
      if (def?.needsDialog) {
        return refused(
          tool,
          `Error: effect ${pyReprString(name)} requires the ProcessEffect dialog and cannot be applied by the agent. Choose a different effect.`,
        );
      }
      const resolved = await resolveClip(call, input);
      if (!resolved.ok) return failed(tool, resolved.error || "Error: could not resolve a timeline clip.");
      if (!def) {
        const sample = EFFECTS.map((e) => e.className).sort().slice(0, 12).join(", ");
        return refused(tool, `Error: unknown effect ${pyReprString(name)}. Examples: ${sample}.`);
      }
      const clipId = String(resolved.clip.id);
      // zenvi-core develop editor_tools/effects_color.py add_effect: if_exists='update' (the default)
      // changes the effect the clip already has instead of stacking a copy. Without properties
      // (not ported yet) there is nothing to change.
      const existing = (resolved.clip.effects ?? []).find((e) => e.class_name === def.className);
      if (existing && (input.if_exists ?? "update") === "update") {
        return unchanged(tool, `${def.name} is already on 1 clip(s) with these settings; nothing changed.`, {
          data: { effect: def.className, effectId: existing.id, timeline_clip_id: clipId, changed: false },
        });
      }
      const effect = call.commit((tx) => addEffect(tx, clipId, def.className));
      return applied(
        tool,
        `Added effect ${pyReprString(def.className)} to timeline_clip_id=${clipId} (effect_id=${effect.id}).`,
        {
          clips: [{ id: clipId, effect: def.className, effectId: effect.id }],
          data: { effect: def.className, effectId: effect.id, timeline_clip_id: clipId },
        },
      );
    },
  }),

  contractTool("set_keyframes_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    // zenvi-core develop editor_tools/clip_props.py set_keyframes / _build_points, for the
    // seven properties below. Ease presets and points without a value (pinning the curve's
    // current value) are not ported yet and are refused.
    run: async (call, input) => {
      const tool = "set_keyframes_tool";
      const prop = String(input.property ?? "").trim();
      if (!(KEYFRAME_PROPERTIES as readonly string[]).includes(prop)) {
        return refused(tool, `Error: property must be one of ${pyRepr([...KEYFRAME_PROPERTIES].sort())} (got ${pyRepr(input.property)}).`);
      }
      const points = input.points;
      if (!Array.isArray(points) || points.length === 0) {
        return refused(tool, 'Error: points must list at least one keyframe, e.g. [{"seconds": 0, "value": 1}].');
      }
      const resolved = await resolveClip(call, input);
      if (!resolved.ok) return failed(tool, resolved.error || "Error: could not resolve a timeline clip.");
      const clipId = String(resolved.clip.id);
      const time = clipTime(resolved.clip, projectFps(call.doc.project));
      const built: KeyframePointInput[] = [];
      const seen = new Map<number, number>();
      for (const [i, raw] of points.entries()) {
        const units = TIME_UNITS.filter((unit) => raw[unit] !== undefined && raw[unit] !== null);
        if (units.length !== 1) return refused(tool, `Error: points[${i}] needs exactly one of frame, seconds, timeline_seconds or source_seconds.`);
        const unit = units[0]!;
        const x = time.frameOf(unit, Number(raw[unit]));
        if (x < time.first || x > time.last) {
          return refused(tool, `Error: points[${i}] (${unit}=${pyRepr(raw[unit])}) lands on frame ${x}, outside clip ${clipId}; valid: ${time.ranges}.`);
        }
        if (seen.has(x)) return refused(tool, `Error: points[${seen.get(x)}] and points[${i}] land on the same frame ${x}.`);
        seen.set(x, i);
        if (raw.ease) return refused(tool, pendingArgumentMessage(tool, `points[${i}].ease`));
        if (raw.value === undefined || raw.value === null) {
          return refused(tool, `Error: points[${i}] needs a value here (keeping the curve's current value is not ported to this Zenvi surface yet).`);
        }
        const value = typeof raw.value === "boolean" ? Number.NaN : Number(raw.value);
        if (!Number.isFinite(value)) return refused(tool, `Error: points[${i}].value must be a number.`);
        built.push({ frame: x, value, interpolation: INTERPOLATIONS[raw.interpolation || input.interpolation || "bezier"] });
      }
      built.sort((a, b) => a.frame! - b.frame!);
      const mode = input.mode ?? "replace";
      call.commit((tx) => setClipKeyframes(tx, clipId, prop, built, { mode }));
      return applied(tool, `Set ${built.length} keyframe(s) on ${prop} for timeline_clip_id=${clipId}.`, {
        clips: [{ id: clipId }],
        data: { timeline_clip_id: clipId, property: prop, mode, points: built.map((p) => ({ frame: p.frame, value: p.value })) },
      });
    },
  }),

  contractTool("set_project_setting_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    run: (call, input) => {
      const tool = "set_project_setting_tool";
      const project = call.doc.project;
      const patch: ProjectSettingsPatch = {};
      // develop's schema: numbers (fps 1-240, fps_num/fps_den >= 1) or null for "unchanged".
      let fps: Fraction | null = null;
      if (input.fps_num != null || input.fps_den != null) {
        fps = { num: input.fps_num ?? 30, den: input.fps_den ?? 1 };
      } else if (input.fps != null) {
        fps = fpsFromRate(input.fps);
      }
      if (fps) patch.fps = fps;
      if (input.width != null) patch.width = input.width;
      if (input.height != null) patch.height = input.height;
      if (input.sample_rate != null) patch.sampleRate = input.sample_rate;
      const current = projectFps(project);
      const same =
        (!patch.fps || (typeof patch.fps === "object" && patch.fps.num === current.num && patch.fps.den === current.den)) &&
        (patch.width === undefined || patch.width === project.width) &&
        (patch.height === undefined || patch.height === project.height) &&
        (patch.sampleRate === undefined || patch.sampleRate === project.sample_rate);
      if (same) return unchanged(tool, "Settings already matched.", { data: { changed: false } });
      const result = call.commit((tx) => setProjectSettings(tx, patch));
      if (!result.changed) return unchanged(tool, "Settings already matched.", { data: { changed: false } });
      return applied(tool, `Updated project settings: ${result.notes.join(", ")}.`, {
        data: { changed: true, updates: result.updates },
        notes: result.notes,
      });
    },
  }),
];
