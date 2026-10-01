/**
 * Phase-3 contract tools: add_effect_tool, set_keyframes_tool,
 * set_project_setting_tool (add_title_tool lives in titles.ts).
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/agent_tools/effects.py,
 * keyframes.py and project_settings.py. They return structured contract-3
 * receipts like the desktop.
 */

import { Interpolation, type Fraction } from "../../model/types.js";
import { EFFECTS, getEffect } from "../../effects/registry.js";
import { addEffect } from "../../ops/effects.js";
import { setClipKeyframes } from "../../ops/clips.js";
import { setProjectSettings, type ProjectSettingsPatch } from "../../ops/project.js";
import { fpsFromRate } from "../../timeline/time.js";
import { contractTool, type CatalogTool } from "../define.js";
import { keyframeX, projectFps } from "../frame-time.js";
import { pyRepr, pyReprString } from "../pyfmt.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import { resolveClip, text } from "./common.js";

/** agent_tools/keyframes.py ALLOWED_PROPERTIES. */
export const KEYFRAME_PROPERTIES = ["volume", "alpha", "location_x", "location_y", "scale_x", "scale_y", "rotation"] as const;

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
    run: async (call, input) => {
      const tool = "set_keyframes_tool";
      const prop = String(input.property ?? "").trim();
      if (!(KEYFRAME_PROPERTIES as readonly string[]).includes(prop)) {
        return refused(tool, `Error: property must be one of ${pyRepr([...KEYFRAME_PROPERTIES].sort())} (got ${pyRepr(input.property)}).`);
      }
      const points = input.points;
      if (!Array.isArray(points) || points.length === 0) {
        return refused(tool, "Error: points must be a non-empty array of {frame|seconds, value} objects.");
      }
      const resolved = await resolveClip(call, input);
      if (!resolved.ok) return failed(tool, resolved.error || "Error: could not resolve a timeline clip.");
      const fps = projectFps(call.doc.project);
      const built: { frame: number; value: number }[] = [];
      for (const [i, raw] of points.entries()) {
        const value = Number(raw.value);
        if (!Number.isFinite(value)) return refused(tool, `Error: points[${i}].value must be a number.`);
        let x: number;
        if (raw.frame !== undefined && raw.frame !== null) {
          x = Math.trunc(Number(raw.frame));
          if (x < 1) return refused(tool, `Error: points[${i}].frame must be >= 1.`);
        } else if (raw.seconds !== undefined && raw.seconds !== null) {
          x = keyframeX(Number(raw.seconds), fps);
        } else {
          return refused(tool, `Error: points[${i}] needs frame or seconds.`);
        }
        built.push({ frame: x, value });
      }
      built.sort((a, b) => a.frame - b.frame);
      const clipId = String(resolved.clip.id);
      call.commit((tx) =>
        setClipKeyframes(
          tx,
          clipId,
          prop,
          built.map((p) => ({ frame: p.frame, value: p.value, interpolation: Interpolation.CONSTANT })),
          { mode: "replace" },
        ),
      );
      return applied(tool, `Set ${built.length} keyframe(s) on ${prop} for timeline_clip_id=${clipId}.`, {
        clips: [{ id: clipId }],
        data: { timeline_clip_id: clipId, property: prop, points: built },
      });
    },
  }),

  contractTool("set_project_setting_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    run: (call, input) => {
      const tool = "set_project_setting_tool";
      const project = call.doc.project;
      const patch: ProjectSettingsPatch = {};
      let fps: Fraction | null = null;
      if (input.fps_num !== undefined || input.fps_den !== undefined) {
        const num = Math.trunc(Number(input.fps_num ?? 30));
        const den = Math.trunc(Number(input.fps_den ?? 1));
        if (!Number.isFinite(num) || !Number.isFinite(den)) return refused(tool, "Error: fps_num/fps_den must be integers.");
        fps = { num, den };
      } else if (input.fps !== undefined && String(input.fps).trim() !== "") {
        const rate = Number(String(input.fps).trim());
        if (!Number.isFinite(rate)) return refused(tool, `Error: fps must be a number (got ${pyRepr(input.fps)}).`);
        if (rate <= 0) return refused(tool, "Error: fps must be positive.");
        fps = fpsFromRate(rate);
      }
      if (fps) {
        if (fps.num <= 0 || fps.den <= 0) return refused(tool, "Error: fps_num and fps_den must be positive.");
        patch.fps = fps;
      }
      if (input.width !== undefined) patch.width = input.width;
      if (input.height !== undefined) patch.height = input.height;
      if (input.sample_rate !== undefined) patch.sampleRate = input.sample_rate;
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
