/**
 * The Assistant's arguments for tools whose contract here is the desktop's
 * MCP schema. zenvi-backend holds the Assistant to the desktop handlers' own
 * schemas, which name some arguments and values differently:
 * inspect_timeline_tool's snake_case names (zenvi-backend
 * core/tools/openshot/playback_tools.py), and add_captions_tool's HyperFrames
 * looks and whole_project (zenvi-core src/classes/hyperframes_captions.py,
 * shipped to the backend in editor_tools_manifest.json). Without this every
 * such call is refused and the Assistant spends its turns guessing the
 * engine's names.
 *
 * A rename is silent (both names are this tool's); a look this surface does
 * not have is named in the receipt's warnings with the one used instead.
 */

import type { AliasedArguments } from "./aliases.js";

/** Assistant name → contract name, per tool. */
const RENAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  inspect_timeline_tool: { start_frame: "startFrame", end_frame: "endFrame", max_frames: "maxFrames", timeline_clip_id: "clipId" },
};

/**
 * The desktop's HyperFrames caption looks, read as the closest preset here:
 * a bar or block behind the words is `boxed`, the light serif lines
 * `minimal`, the rest big bold outlined words (`reels`).
 */
const CAPTION_LOOKS: Readonly<Record<string, string>> = {
  "pill-karaoke": "boxed",
  highlight: "boxed",
  "weight-shift": "minimal",
  "clip-wipe": "reels",
  "gradient-fill": "reels",
  "kinetic-slam": "reels",
  "emoji-pop": "reels",
  "neon-glow": "reels",
  "neon-accent": "reels",
  "glitch-rgb": "reels",
  "matrix-decode": "reels",
  "particle-burst": "reels",
  texture: "reels",
};

/** add_captions_tool's arguments that name the clips to caption. */
const CAPTION_TARGETS = ["clipId", "timeline_clip_id", "clip_query", "trackIndex"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captionArguments(args: Record<string, unknown>, notes: string[]): Record<string, unknown> {
  const out = { ...args };
  const look = typeof out.style === "string" ? CAPTION_LOOKS[out.style.trim().toLowerCase()] : undefined;
  if (look) {
    notes.push(`style '${String(out.style)}' is a desktop caption look this surface does not have; used '${look}', the closest.`);
    out.style = look;
  }
  if (Object.hasOwn(out, "whole_project")) {
    // No clip named is already "every clip with speech" here.
    const whole = out.whole_project === true || String(out.whole_project).toLowerCase() === "true";
    delete out.whole_project;
    if (whole && CAPTION_TARGETS.some((key) => out[key] !== undefined && out[key] !== "" && out[key] !== 0)) {
      notes.push("whole_project was ignored: the clip named was captioned.");
    }
  }
  return out;
}

/** The call with the Assistant's names read as the contract's; `args` itself is not changed. */
export function assistantArguments(tool: string, args: unknown): AliasedArguments {
  const renames = RENAMES[tool];
  if (!isRecord(args) || (!renames && tool !== "add_captions_tool")) return { args, notes: [] };
  const notes: string[] = [];
  let out: Record<string, unknown> = args;
  if (renames) {
    out = { ...args };
    for (const [from, to] of Object.entries(renames)) {
      if (!Object.hasOwn(out, from) || Object.hasOwn(out, to)) continue;
      out[to] = out[from];
      delete out[from];
    }
  }
  if (tool === "add_captions_tool") out = captionArguments(out, notes);
  return { args: out, notes };
}
