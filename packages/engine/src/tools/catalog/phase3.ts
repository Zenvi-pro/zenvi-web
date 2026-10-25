/**
 * Phase-3 contract tool set_keyframes_tool (add_effect_tool lives in
 * effects-color.ts, add_title_tool in titles.ts, set_project_setting_tool
 * in project-export-profiles.ts).
 *
 * Port of zenvi-core (ref b63c39be7) src/classes/agent_tools/keyframes.py,
 * with develop 1f80cb3d0's point times, interpolation, ease presets and
 * modes (editor_tools/clip_props.py `set_keyframes` / `_build_points` /
 * `_merge_curve`). It returns a structured contract-3 receipt.
 */

import { pyRound } from "../../model/rounding.js";
import { Interpolation, type Clip, type Fraction } from "../../model/types.js";
import { setClipKeyframes } from "../../ops/clips.js";
import type { KeyframePointInput } from "../../ops/types.js";
import { contractTool, type CatalogTool } from "../define.js";
import { projectFps } from "../frame-time.js";
import { EASE_PRESETS, INTERPOLATION_NAMES } from "../clip-props-model.js";
import { pyRepr, pyReprString } from "../pyfmt.js";
import { applied, failed, refused } from "../receipt.js";
import { resolveClip } from "./common.js";

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
  contractTool("set_keyframes_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    // zenvi-core develop editor_tools/clip_props.py set_keyframes / _build_points / _merge_curve,
    // for the seven properties below, with the 28 bezier ease presets (`ease` for points that
    // set none, or a point's own). Points without a value (pinning the curve's current value)
    // are not ported yet and are refused.
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
      const defaultEase = input.ease ?? "";
      const defaultInterp = input.interpolation ?? "";
      if (defaultEase && defaultInterp !== "" && defaultInterp !== "bezier") {
        return refused(tool, "Error: ease presets are bezier curves; drop interpolation or set it to 'bezier'.");
      }
      const time = clipTime(resolved.clip, projectFps(call.doc.project));
      const built: KeyframePointInput[] = [];
      const seen = new Map<number, number>();
      const easeAt = new Map<number, string>();
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
        const pointEase = raw.ease ?? "";
        const pointInterp = raw.interpolation ?? "";
        if (pointEase && pointInterp && pointInterp !== "bezier") {
          return refused(tool, `Error: points[${i}]: ease presets are bezier curves; drop interpolation or use 'bezier'.`);
        }
        const interpName = pointEase ? "bezier" : pointInterp || defaultInterp || "bezier";
        const easeName = pointEase || (interpName === "bezier" ? defaultEase : "");
        const ease = easeName ? EASE_PRESETS.get(easeName) : undefined;
        if (easeName && !ease) return refused(tool, `Error: points[${i}]: unknown ease ${pyReprString(easeName)}; choose one of ${[...EASE_PRESETS.keys()].join(", ")}.`);
        if (raw.value === undefined || raw.value === null) {
          return refused(tool, `Error: points[${i}] needs a value here (keeping the curve's current value is not ported to this Zenvi surface yet).`);
        }
        const value = typeof raw.value === "boolean" ? Number.NaN : Number(raw.value);
        if (!Number.isFinite(value)) return refused(tool, `Error: points[${i}].value must be a number.`);
        built.push({ frame: x, value, interpolation: INTERPOLATIONS[interpName], ...(ease ? { ease } : {}) });
        if (ease) easeAt.set(x, easeName);
      }
      built.sort((a, b) => a.frame! - b.frame!);
      const mode = input.mode ?? "replace";
      call.commit((tx) => setClipKeyframes(tx, clipId, prop, built, { mode }));
      return applied(tool, `Set ${built.length} keyframe(s) on ${prop} for timeline_clip_id=${clipId}.`, {
        clips: [{ id: clipId }],
        data: {
          timeline_clip_id: clipId,
          property: prop,
          mode,
          points: built.map((p) => ({
            frame: p.frame,
            value: p.value,
            interpolation: INTERPOLATION_NAMES[p.interpolation ?? Interpolation.BEZIER],
            ...(easeAt.has(p.frame!) ? { ease: easeAt.get(p.frame!) } : {}),
          })),
        },
      });
    },
  }),

];
