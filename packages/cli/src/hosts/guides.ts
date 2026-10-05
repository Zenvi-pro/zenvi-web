/**
 * What `zenvi mcp` serves besides tools: resources (`zenvi://hosts`,
 * `zenvi://taste`, `zenvi://handoff`) and prompts (`taste_motion_design`,
 * `edit_review`) that carry the taste guide (docs/TASTE.md) and its review
 * checklist, with the tool names of the host the work happens in.
 */

import type { HostsReport } from "./registry.js";
import { TASTE_MARKDOWN } from "./taste.gen.js";

export { TASTE_MARKDOWN };

export interface ResourceInfo {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

export const RESOURCES: readonly ResourceInfo[] = [
  {
    uri: "zenvi://hosts",
    name: "hosts",
    title: "Hosts",
    description: "The apps this server drives (Zenvi desktop, portable engine, After Effects, Premiere Pro), which are connected and which is active. Same as list_hosts.",
    mimeType: "application/json",
  },
  {
    uri: "zenvi://taste",
    name: "taste",
    title: "Zenvi taste guide",
    description: "Motion design and editing defaults (timing, easing, layout, type, colour, rhythm) and the review checklist. Omitted tool arguments use these values.",
    mimeType: "text/markdown",
  },
  {
    uri: "zenvi://handoff",
    name: "handoff",
    title: "Handoffs and linked clips",
    description: "How an edit moves between Zenvi, After Effects, Premiere Pro, Remotion and HyperFrames, what survives each direction, and how linked clips work.",
    mimeType: "text/markdown",
  },
];

export const HANDOFF_GUIDE = `# Zenvi handoffs and linked clips

An edit can move between Zenvi, After Effects, Premiere Pro, Remotion and
HyperFrames. Every conversion of the Zenvi project format runs in the Zenvi
desktop app; \`zenvi mcp\` opens the app on this session's project when a
handoff needs it (the project must be saved: open_project_file).

| Direction | Tools | What survives |
| --- | --- | --- |
| Zenvi → After Effects | send_to_after_effects_tool (After Effects connected), export_to_after_effects_tool (.jsx file) | footage, layers, timing, transforms with eased keyframes, opacity, audio levels, titles as text layers, mapped effects, transitions, markers; unmapped effects are listed as warnings |
| After Effects → Zenvi | bring_from_after_effects | the comp as a linked clip, rendered by After Effects and re-renderable |
| Zenvi → Premiere Pro | send_to_premiere_tool (Premiere connected), export_to_premiere_tool (FCP7 XML) | clips, trims, tracks, Basic Motion and Opacity keyframes, audio levels, cross dissolves, markers; titles as PNG stills |
| Premiere Pro → Zenvi | bring_from_premiere (premiere_export_xml + import_timeline_xml_tool) | the sequence as native, editable clips |
| Zenvi → Remotion | export_to_remotion_tool | the timeline as a Remotion project (src/zenvi/timeline.json + a renderer); it comes back as native clips |
| Remotion → Zenvi | list_remotion_compositions_tool, import_remotion_project_tool | compositions as linked clips; a Zenvi-generated project as native clips |
| Zenvi → HyperFrames | export_to_hyperframes_tool | primitives, a GSAP timeline and an embedded zenvi-timeline JSON (lossless on re-import) |
| HyperFrames → Zenvi | import_hyperframes_project_tool | <video>/<img>/<audio> primitives as native clips; scripted compositions as linked clips |

## Linked clips

A linked clip is rendered media that keeps a live link to its source: a
Remotion or HyperFrames composition with its props, or an After Effects comp
in its .aep ("Dynamic Link, but for code").

- get_linked_clip_tool: state fresh | stale | rendering | error | missing_source, and the editable props.
- update_linked_clip_tool {props}: change props and re-render; the media swap is one undo step.
- rerender_linked_clip_tool: after the code or the comp changed.
- open_linked_source_tool {target: code | studio}: the source file at its line in the user's editor, or Remotion Studio / HyperFrames preview / After Effects.
- unlink_clip_tool: keep the rendered media, drop the link.

Linked renders are ProRes 4444 when any pixel is transparent, else H.264;
never WebM (Zenvi drops VP9 alpha).

## Rules of thumb

- After Effects and Premiere Pro steps need the app running with Zenvi Link (list_hosts; \`zenvi adobe install\` installs it).
- Prefer the native tools of the app the user is working in: ae_* inside After Effects, premiere_* inside Premiere Pro, Zenvi tools on the .zvn project. Hand off when the user wants to continue in another app.
- After every handoff, look at the result in the destination (ae_capture_frame, premiere_capture_frame, preview_frame) and read the warnings to the user: round trips through other apps are not lossless for everything.
`;

type PromptHost = "zenvi" | "aftereffects" | "premiere";

interface HostTools {
  label: string;
  state: string;
  build: string;
  capture: string;
  notes: string;
}

const HOST_TOOLS: { readonly [H in PromptHost]: HostTools } = {
  zenvi: {
    label: "the Zenvi project (.zvn)",
    state: "get_timeline_state_tool, list_clips_tool",
    build:
      "add_clip_to_timeline_tool, add_title_tool, set_keyframes_tool (keyframes with easing), apply_transition_tool, fade_clip_tool, set_clip_property_tool, add_effect_tool, set_clip_volume_tool",
    capture: "preview_frame (grid=true adds the 0-1 coordinate grid for placement)",
    notes:
      "Each call is one undo step (undo_tool reverts). Times are timeline seconds. Render with render_video; launch_editor shows the cut in the Zenvi desktop app.",
  },
  aftereffects: {
    label: "After Effects",
    state: "ae_get_state, ae_get_comp, ae_get_layer",
    build:
      "ae_create_comp (presets 1080p, 4k, vertical, square, 720p), ae_add_text (placement, animation preset), ae_apply_motion_preset (fade-in, slide-in, scale-pop, blur-in, typewriter, word-cascade, line-rise, ken-burns, push-in, drift, whip-in), ae_animate (keyframes with named easing), ae_set_property, ae_add_layer (solid, shape, null, adjustment), ae_apply_look, ae_add_mask",
    capture: "ae_capture_frame",
    notes:
      "Each mutating ae_* call is one undo step (ae_undo reverts). Keep text editable: text animators, not pre-rendered text. Render with ae_render, or bring the comp into the Zenvi project with bring_from_after_effects.",
  },
  premiere: {
    label: "Premiere Pro",
    state: "premiere_get_state, premiere_get_sequence",
    build:
      "premiere_place_clip, premiere_edit_clip (move, trim, speed, delete), premiere_razor, premiere_add_transition (Cross Dissolve), premiere_set_clip_properties, premiere_animate (bezier ease on Motion), premiere_add_text, premiere_apply_look, premiere_add_marker",
    capture: "premiere_capture_frame",
    notes:
      "Premiere has no undo grouping: every DOM change is its own undo step, so plan before you change things. Export with premiere_export, or bring the sequence into the Zenvi project with bring_from_premiere.",
  },
};

/** A prompt's `host` argument (or the active host when it is empty). */
export function promptHost(value: string | undefined, report?: HostsReport): PromptHost {
  const v = (value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["ae", "aftereffects", "after-effects", "aeft"].includes(v)) return "aftereffects";
  if (["premiere", "premiere-pro", "premierepro", "ppro", "pr"].includes(v)) return "premiere";
  if (v) return "zenvi";
  if (report?.active === "after-effects") return "aftereffects";
  if (report?.active === "premiere-pro") return "premiere";
  return "zenvi";
}

export interface PromptArgumentInfo {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptInfo {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgumentInfo[];
}

const HOST_ARGUMENT: PromptArgumentInfo = {
  name: "host",
  description: "Where the work happens: zenvi, aftereffects or premiere. Default: the active host (list_hosts).",
  required: false,
};

export const PROMPTS: readonly PromptInfo[] = [
  {
    name: "taste_motion_design",
    title: "Motion design with Zenvi taste",
    description:
      "Plan and build motion (titles, lower thirds, logo reveals, kinetic type, transitions) in Zenvi, After Effects or Premiere Pro with the Zenvi taste defaults, then check frames against the review checklist.",
    arguments: [{ name: "brief", description: 'What to make, e.g. "a 5 s lower third for Ana Ruiz, Head of Design".', required: true }, HOST_ARGUMENT],
  },
  {
    name: "edit_review",
    title: "Review an edit against the taste guide",
    description:
      "Look at the current edit in Zenvi, After Effects or Premiere Pro frame by frame and report what breaks the taste guide (safe areas, easing, timing, alignment, focal point, audio), with fixes.",
    arguments: [
      HOST_ARGUMENT,
      { name: "focus", description: "What to look at most: typography, motion, timing, layout, colour, audio (default: everything).", required: false },
    ],
  },
];

function guide(): string {
  return `--- Zenvi taste guide (zenvi://taste) ---\n\n${TASTE_MARKDOWN}`;
}

function connectStep(host: PromptHost, tools: HostTools): string {
  return host === "zenvi"
    ? "1. Call list_hosts to see where Zenvi edits go (the desktop app when it has the project open, else this server's portable engine)."
    : `1. Call list_hosts and make sure ${tools.label} is connected. If it is not, stop and tell the user how to connect it (the host entry says how).`;
}

/** The prompt text for prompts/get. Throws for unknown prompts or a missing brief (the server answers InvalidParams). */
export function promptText(name: string, args: Record<string, string | undefined>, report?: HostsReport): { description: string; text: string } {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) throw new Error(`Unknown prompt: ${name}. Prompts: ${PROMPTS.map((p) => p.name).join(", ")}.`);
  const host = promptHost(args.host, report);
  const tools = HOST_TOOLS[host];
  if (name === "taste_motion_design") {
    const brief = args.brief?.trim();
    if (!brief) throw new Error("taste_motion_design needs a brief: what to make.");
    const text = [
      `Design and build this in ${tools.label}: ${brief}`,
      "",
      "Work like a senior motion designer who follows the Zenvi taste guide below. Its numbers are the defaults the tools use when you leave an argument out; override one only with a reason you state.",
      "",
      connectStep(host, tools),
      `2. Read the current state: ${tools.state}.`,
      "3. Plan before you build. For each moment write: what the viewer should notice next, the element, entrance / hold / exit times from the Timing table, the easing name, and where it sits (title-safe, the 12-column grid). One easing family, one type family, one accent colour.",
      `4. Build it with ${tools.build}. Use the named easings (smooth, out/entrance, in/exit, in-out, snap); nothing that moves on screen uses linear.`,
      `5. Look before you say done: capture frames with ${tools.capture} at the first frame, every entrance end, the middle of each hold and the last frame. Check each against the review checklist (§7), fix, and capture again.`,
      "6. Report what you built (elements and timings), the frames you checked, and any deliberate exceptions to the guide.",
      "",
      tools.notes,
      "",
      guide(),
    ].join("\n");
    return { description: `Motion design in ${tools.label} with Zenvi taste`, text };
  }
  const focus = args.focus?.trim();
  const text = [
    `Review the current edit in ${tools.label}${focus ? `, focusing on ${focus}` : ""}. Do not change anything before you have reported.`,
    "",
    connectStep(host, tools),
    `2. Read the state (${tools.state}) and list the moments to check: the first frame, every entrance end, the middle of each hold, every transition and the last frame.`,
    `3. Capture each moment with ${tools.capture} and look at it.`,
    "4. Run the review checklist (§7) on every frame: text inside title-safe and readable at phone size; no linear easing on moving things and nothing ending abruptly; durations within the Timing table and holds long enough to read (1.5 s + 0.3 s per word); alignment to the grid and to sibling elements; exactly one focal point per moment; audio without clipping, music ducked under speech, fades at the end.",
    "5. Report a table: time, what you see, the rule it breaks (cite the guide's section), and the fix (tool and arguments). Then list what is already right.",
    "6. Ask before fixing unless the user asked for fixes. After fixing, capture the same moments again and confirm.",
    "",
    tools.notes,
    "",
    guide(),
  ].join("\n");
  return { description: `Review of the edit in ${tools.label}${focus ? ` (${focus})` : ""}`, text };
}
