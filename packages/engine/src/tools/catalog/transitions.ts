/**
 * Transition tools: list_transitions_tool, search_transitions_tool,
 * apply_transition_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * list_transitions, search_transitions, apply_transition (+
 * add_transition_between_clips, add_transition_to_clip). The catalog (412
 * masks, desktop names and search) is `src/transitions`; the placement rules
 * (clip B moves back by the duration to overlap clip A, the mask sits on the
 * higher track, desktop keyframes) are the ops' applyTransitionBetween /
 * applyTransitionToClip.
 *
 * Web additions, all named in the contract schema (TOOL_SCHEMAS declares
 * them; the desktop handler ignores them): `name` / `transition` alias
 * transition_name, `timeline_clip_id` aliases clip1_id, `clip_query` /
 * `position_seconds` / `track` find clip 1 (between: the two clips meeting at
 * position_seconds), clip 2 defaults to the next clip on clip 1's track,
 * `duration_seconds` aliases duration, and `brightness` / `contrast` set
 * constant mask values. With no name the transition is a fade (the desktop
 * matched the first file of its transitions folder).
 */

import type { Clip, Project } from "../../model/types.js";
import { applyTransitionBetween, applyTransitionToClip, resolveTransitionMask, setTransitionProperty } from "../../ops/transitions.js";
import { listTransitions, searchTransitions, type TransitionEntry } from "../../transitions/index.js";
import { parsePythonFloat } from "../coerce.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyRepr } from "../pyfmt.js";
import { normalizeTrackOrLayerArg } from "../tracks.js";
import { resolveClip, text } from "./common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** How far position_seconds may sit from a cut and still name it. */
const CUT_TOLERANCE_SEC = 0.5;

function toolRow(entry: TransitionEntry): Record<string, string> {
  return { name: entry.name, filename: entry.file, category: entry.category, path: entry.storedPath };
}

function clipEnd(clip: Clip): number {
  return (Number(clip.position) || 0) + (Number(clip.end) || 0) - (Number(clip.start) || 0);
}

/** The two clips on one track meeting nearest `t` (within CUT_TOLERANCE_SEC), top track first. */
function clipsMeetingAt(project: Project, t: number, layer: number | undefined): [Clip, Clip] | undefined {
  const layers = [...new Set((project.clips ?? []).map((c) => Number(c.layer)))]
    .filter((l) => layer === undefined || l === layer)
    .sort((a, b) => b - a);
  let best: { d: number; pair: [Clip, Clip] } | undefined;
  for (const l of layers) {
    const onLayer = (project.clips ?? []).filter((c) => Number(c.layer) === l).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
    for (let i = 1; i < onLayer.length; i += 1) {
      const a = onLayer[i - 1]!;
      const b = onLayer[i]!;
      const d = Math.min(Math.abs(t - (Number(b.position) || 0)), Math.abs(t - clipEnd(a)));
      if (d <= CUT_TOLERANCE_SEC && (!best || d < best.d)) best = { d, pair: [a, b] };
    }
  }
  return best?.pair;
}

/** The first clip on `clip`'s track that starts after it. */
function nextClipOnTrack(project: Project, clip: Clip): Clip | undefined {
  const pos = Number(clip.position) || 0;
  return (project.clips ?? [])
    .filter((c) => c.id !== clip.id && Number(c.layer) === Number(clip.layer) && (Number(c.position) || 0) > pos + 1e-6)
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))[0];
}

function findClip(project: Project, id: string): Clip | undefined {
  return (project.clips ?? []).find((c) => String(c.id) === id);
}

/** float(duration) with the desktop's ValueError → 1.0. */
function durationArg(value: unknown): number {
  if (typeof value === "number") return value;
  const n = parsePythonFloat(String(value ?? "").trim());
  return n === null ? 1.0 : n;
}

/** An optional constant mask value; an error string when it does not parse. */
function maskValue(value: unknown, field: string): number | null | string {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = typeof value === "number" ? value : parsePythonFloat(String(value).trim());
  if (n === null || !Number.isFinite(n)) return `Error: ${field} must be a number (got ${pyRepr(value)}).`;
  return n;
}

async function resolveFirstClip(
  call: ToolCall,
  input: Record<string, unknown>,
  placement: string,
): Promise<{ clip: Clip; pairNext?: Clip } | string> {
  const project = call.doc.project;
  const id = text(input.clip1_id) || text(input.timeline_clip_id);
  if (id) {
    const clip = findClip(project, id);
    return clip ? { clip } : `Error: Clip '${id}' not found.`;
  }
  const position = input.position_seconds;
  const hasPosition = position !== undefined && position !== null && String(position).trim() !== "";
  if (text(input.clip_query)) {
    const resolved = await resolveClip(call, { clip_query: input.clip_query, track: input.track, position_near: hasPosition ? position : undefined });
    return resolved.ok ? { clip: resolved.clip } : resolved.error || "Error: Could not resolve timeline clip.";
  }
  if (hasPosition) {
    const t = typeof position === "number" ? position : parsePythonFloat(String(position).trim());
    if (t === null || !Number.isFinite(t)) return `Error: position_seconds=${pyRepr(position)} is not a time in seconds`;
    let layer: number | undefined;
    if (text(input.track)) {
      const r = normalizeTrackOrLayerArg(text(input.track), project.layers);
      if (r.error) return r.error;
      layer = r.layer;
    }
    if (placement === "between") {
      const pair = clipsMeetingAt(project, t, layer);
      if (!pair) return `Error: No cut between two clips within ${pyFixed(CUT_TOLERANCE_SEC, 1)}s of ${pyFixed(t, 2)}s. Pass clip1_id and clip2_id.`;
      return { clip: pair[0], pairNext: pair[1] };
    }
    const resolved = await resolveClip(call, { track: input.track, position_near: t });
    return resolved.ok ? { clip: resolved.clip } : resolved.error || "Error: Could not resolve timeline clip.";
  }
  return "Error: apply_transition_tool needs clip1_id (or timeline_clip_id, clip_query or position_seconds).";
}

export const transitionTools: CatalogTool[] = [
  contractTool("list_transitions_tool", {
    annotations: READ,
    run: (_call, input) => {
      const category = (text(input.category) || "all").toLowerCase();
      const list = category === "all" || category === "common" || category === "extra" ? listTransitions(category) : [];
      if (list.length === 0) return "No transitions found.";
      const data: Record<string, unknown> = { total: list.length, transitions: list.slice(0, 50).map(toolRow) };
      if (list.length > 50) data.note = `Showing first 50 of ${list.length} transitions.`;
      return JSON.stringify(data, null, 2);
    },
  }),

  contractTool("search_transitions_tool", {
    annotations: READ,
    run: (_call, input) => {
      const query = String(input.query ?? "");
      const matches = searchTransitions(query);
      if (matches.length === 0) return `No transitions found matching '${query}'.`;
      return JSON.stringify({ query, matches: matches.length, transitions: matches.map(toolRow) }, null, 2);
    },
  }),

  contractTool("apply_transition_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, input) => {
      const place = (text(input.placement) || "between").toLowerCase();
      if (place !== "between" && place !== "start" && place !== "end") {
        return "Error: placement must be 'between', 'start', or 'end'.";
      }
      const name = text(input.transition_name) || text(input.name) || text(input.transition) || "fade";
      const durationRaw = input.duration !== undefined && String(input.duration).trim() !== "" ? input.duration : input.duration_seconds;
      const duration = durationArg(durationRaw);
      const brightness = maskValue(input.brightness, "brightness");
      if (typeof brightness === "string") return brightness;
      const contrast = maskValue(input.contrast, "contrast");
      if (typeof contrast === "string") return contrast;

      const first = await resolveFirstClip(call, input, place);
      if (typeof first === "string") return first;
      const project = call.doc.project;
      const clip1 = first.clip;
      let clip2: Clip | undefined;
      if (place === "between") {
        const id2 = text(input.clip2_id);
        if (id2) {
          clip2 = findClip(project, id2);
          if (!clip2) return `Error: Clip '${id2}' not found.`;
        } else {
          clip2 = first.pairNext ?? nextClipOnTrack(project, clip1);
          if (!clip2) return `Error: clip2_id is required when placement='between' (no clip follows ${String(clip1.id)} on its track).`;
        }
      }
      if (!resolveTransitionMask(name)) return `Error: Transition '${name}' not found. Use search_transitions_tool.`;

      const applyMask = (transitionId: string, tx: Parameters<typeof setTransitionProperty>[0]): void => {
        if (brightness !== null) setTransitionProperty(tx, transitionId, "brightness", brightness);
        if (contrast !== null) setTransitionProperty(tx, transitionId, "contrast", contrast);
      };
      if (clip2) {
        const id1 = String(clip1.id);
        const id2 = String(clip2.id);
        const result = call.commit((tx) => {
          const r = applyTransitionBetween(tx, id1, id2, name, duration);
          applyMask(r.transition.id, tx);
          return r;
        });
        const t = result.transition;
        return (
          `Added '${name}' transition between clips (overlap: ${pyFixed(t.end - t.start, 2)}s).\n` +
          `Clip2 moved to ${pyFixed(t.position, 2)}s. Transition ID: ${t.id}`
        );
      }
      const id1 = String(clip1.id);
      const t = call.commit((tx) => {
        const transition = applyTransitionToClip(tx, id1, name, place === "end" ? "end" : "start", duration);
        applyMask(transition.id, tx);
        return transition;
      });
      return `Added '${name}' transition at ${place} of clip.\nID: ${t.id}, Duration: ${pyFixed(t.end - t.start, 2)}s, Position: ${pyFixed(t.position, 2)}s`;
    },
  }),
];
