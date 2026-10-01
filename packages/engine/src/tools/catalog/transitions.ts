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
 * One web difference: clip2 defaults to the next clip on clip1's track
 * (the desktop answers "Error: clip2_id is required"), and no name means a
 * fade (the desktop matched the first file of its transitions folder).
 */

import type { Clip, Project } from "../../model/types.js";
import { applyTransitionBetween, applyTransitionToClip, resolveTransitionMask } from "../../ops/transitions.js";
import { listTransitions, searchTransitions, type TransitionEntry } from "../../transitions/index.js";
import { parsePythonFloat } from "../coerce.js";
import { contractTool, type CatalogTool } from "../define.js";
import { pyFixed } from "../pyfmt.js";
import { text } from "./common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function toolRow(entry: TransitionEntry): Record<string, string> {
  return { name: entry.name, filename: entry.file, category: entry.category, path: entry.storedPath };
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
    run: (call, input) => {
      const place = (text(input.placement) || "between").toLowerCase();
      if (place !== "between" && place !== "start" && place !== "end") {
        return "Error: placement must be 'between', 'start', or 'end'.";
      }
      const name = text(input.transition_name) || "fade";
      const duration = durationArg(input.duration);
      const project = call.doc.project;
      const id1 = text(input.clip1_id);
      const clip1 = findClip(project, id1);
      if (!clip1) return `Error: Clip '${id1}' not found.`;
      let clip2: Clip | undefined;
      if (place === "between") {
        const id2 = text(input.clip2_id);
        if (id2) {
          clip2 = findClip(project, id2);
          if (!clip2) return `Error: Clip '${id2}' not found.`;
        } else {
          clip2 = nextClipOnTrack(project, clip1);
          if (!clip2) return `Error: clip2_id is required when placement='between' (no clip follows ${id1} on its track).`;
        }
      }
      if (!resolveTransitionMask(name)) return `Error: Transition '${name}' not found. Use search_transitions_tool.`;
      if (clip2) {
        const id2 = String(clip2.id);
        const t = call.commit((tx) => applyTransitionBetween(tx, id1, id2, name, duration).transition);
        return (
          `Added '${name}' transition between clips (overlap: ${pyFixed(t.end - t.start, 2)}s).\n` +
          `Clip2 moved to ${pyFixed(t.position, 2)}s. Transition ID: ${t.id}`
        );
      }
      const t = call.commit((tx) => applyTransitionToClip(tx, id1, name, place === "end" ? "end" : "start", duration));
      return `Added '${name}' transition at ${place} of clip.\nID: ${t.id}, Duration: ${pyFixed(t.end - t.start, 2)}s, Position: ${pyFixed(t.position, 2)}s`;
    },
  }),
];
