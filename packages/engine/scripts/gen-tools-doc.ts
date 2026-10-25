/**
 * Generate docs/TOOLS.md from the engine's tool catalog: every tool with its
 * description, arguments, surfaces and where it works (web editor, CLI / local
 * MCP, Zenvi Cloud remote MCP, Zenvi desktop).
 *
 *   npx tsx packages/engine/scripts/gen-tools-doc.ts          # write
 *   npx tsx packages/engine/scripts/gen-tools-doc.ts --check  # fail when stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_PROFILES, availabilityMatrix, type Availability } from "../src/tools/availability.js";
import type { CatalogTool } from "../src/tools/define.js";
import type { JsonSchema } from "../src/tools/json-schema.js";
import { DESKTOP_NAMES_ON_DIRECT_TOOLS, PENDING_DESKTOP_ARGS, PENDING_DESKTOP_TOOLS } from "../src/tools/pending.js";
import { allTools } from "../src/tools/registry.js";
import { CONTRACT_REF, CONTRACT_TOOL_NAMES, contractMeta, type ContractToolName } from "../src/tools/schemas.gen.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(ROOT, "docs", "TOOLS.md");

/**
 * Deliberate differences from the desktop handlers (zenvi-core develop
 * 1f80cb3d0; src/classes/tool_handlers.py unless noted).
 */
const DIVERGENCES: [string, string][] = [
  [
    "add_title_tool",
    "The text also replaces every line whose placeholder matches the first line's. Reflection templates (Bar_1, the default) draw a mirrored copy first; the desktop's `_set_svg_text` (agent_tools/titles.py:32) fills only that copy and blanks the real line, so its titles render upside down.",
  ],
  [
    "add_clip_to_timeline_tool",
    "Appending (no position_seconds) butts the clip against the last clip on the track. The desktop places it at `last_end + _one_frame` (tool_handlers.py:2726), leaving a one-frame black/silent gap.",
  ],
  [
    "add_clip_to_timeline_tool and the tools that place through it",
    "A host that cannot watch frames (no frame rendering or no Zenvi backend) counts as \"not watched\": a duration-only trim of a full video is refused instead of placing the first N seconds, and the result never says \"(watched)\". The desktop's watch falls back softly and places the window.",
  ],
  [
    "watch (add_clip_to_timeline_tool, slice_clip_at_best_match_tool, search_clip_scenes_tool, watch_clip_window_tool)",
    "Up to 12 frames rendered by the host; no ffmpeg scene-cut detection (shot cuts are always reported as none) and no near-duplicate frame dedupe (watch_window.py extract_watch_window).",
  ],
  [
    "apply_transition_tool",
    "clip2 defaults to the next clip on clip1's track instead of `Error: clip2_id is required` (tool_handlers.py:6645); no transition_name means fade (the desktop took the first file in its transitions folder).",
  ],
  [
    "reindex_project_file_tool",
    "\"Already indexed\" reads the current `ai_metadata.index` block (legacy `twelvelabs` as fallback); the desktop reads only `twelvelabs` (tool_handlers.py:7344). Re-uploading for indexing is not available on the web.",
  ],
  [
    "add_marker_tool / list_markers_tool",
    "A marker's name is stored as `label`, the key the web editor shows; zenvi-core develop stores `name` (track_ops.add_marker). list_markers_tool reads either.",
  ],
  [
    "add_title_tool / add_captions_tool",
    "Templates are the bundled catalog, read by basename only (the desktop joined a bare template name into its titles folder unchecked, agent_tools/titles.py:81); an absolute .svg path is read through the host's storage.",
  ],
  [
    "get_transcript_tool, export_captions_tool, add_captions_tool",
    "Transcripts come from the indexed `ai_metadata.transcript_cues`; word timings inside a cue are estimated by character count (`transcriptionSource: \"index_cues\"`, `wordTiming: \"estimated\"`). The desktop runs on-device ASR.",
  ],
  [
    "remove_silence_tool",
    "Speech windows come from the desktop's energy VAD run on the host's RMS envelope (AudioHost.analyzeAudio), not from on-device VAD models.",
  ],
  [
    "web-only arguments",
    "Hosts without a playhead or local file paths, and the CLI, need a few arguments the desktop's schemas do not have (scripts/tool-schema-overlay.json `web_extra_props`): add_marker_tool label/text and add_track_tool label (older names for `name`), save_project_tool path, set_clip_volume_tool volume/gain/db, set_clip_speed_tool clip_id/factor/direction (the web's older speed tool: one clip id, speed, backward = reverse), list_effects_tool category (older name for kind), remove_effect_tool effect_id (the older tool's one id, added to effect_ids), watch_clip_tool file_id/timeline_clip_id, import_stock_media_tool position_seconds/track/duration_seconds/start_seconds (place the import). Every argument the desktop accepts is accepted; the ones only the desktop handles so far are refused (see Not ported yet).",
  ],
  [
    "desktop defaults the web does not follow yet",
    "save_project_tool and export_video_tool replace an existing file (the CLI's) where the desktop refuses unless overwrite=true; add_title_tool never shrinks long lines (desktop fit_text=true); add_captions_tool adds a new caption group where the desktop replaces the clip's captions (replace_existing=true); new_project_tool / open_project_tool have no unsaved-changes guard (every web surface autosaves, so discard_unsaved is accepted as is); generate_tts_and_add_to_timeline_tool defaults to the track below the picture, where the desktop picks or creates a free narration track.",
  ],
  [
    "tools zenvi-core develop rewrote as editor tools",
    "get_project_info_tool, list_markers_tool, get_export_settings_tool, set_export_setting_tool, new/open/save_project_tool, play_tool, add_track_tool, add_marker_tool, export_video_tool, generate_tts_and_add_to_timeline_tool, add_effect_tool, add_title_tool, set_keyframes_tool, set_project_setting_tool and add_captions_tool take develop's schemas; their results keep the earlier text and receipts (develop answers with structured receipts), set_export_setting_tool stores any key (develop checks keys and aliases), and set_keyframes_tool animates the seven earlier properties (develop: any keyframable clip property).",
  ],
  [
    "split_file_add_clip_tool",
    "require_visual_match reads true/false; the desktop's `bool(...)` treats the string \"false\" as true (tool_handlers.py:2370).",
  ],
  [
    "wait_for_editor_job_tool (desktop MCP extra, #237)",
    "Pending, and likely to stay so: tool calls here run to completion inside the call, so there is never a detached editor job; the name gets the standard not-available refusal.",
  ],
  [
    "argument coercion",
    "As zenvi-core normalize_args, plus numbers/booleans become strings for string-only properties (MCP clients send typed JSON). Tools that are editor tools on the desktop coerce like its @editor_tool registry (`_registry.coerce_args`): case-insensitive enums, \"1.5s\", comma-separated or JSON lists, \"y\"/\"n\"; an empty string or null for an argument that cannot hold it means its default where the desktop refuses it, and a value that cannot be coerced is refused in the web's words (`Invalid arguments for …`) rather than the registry's.",
  ],
  [
    "add_clips_to_timeline_tool",
    "image_seconds=0 and transition_seconds=0 mean the desktop's default Default Image Length (10 s) and Default Transition Length (1 s): the web has no preferences.",
  ],
  [
    "separate_clip_audio_tool",
    "With to_track the audio clip goes straight there. The desktop first splits it onto the track below (creating a track when the clip is on the bottom one) and then moves it, which can leave that new track empty.",
  ],
  [
    "set_clip_audio_video_tool",
    "The web timeline draws the waveform of every clip with sound and has no per-clip switch: waveform=show changes nothing and waveform=hide is refused (in words the Assistant retries without it). The desktop stores waveform samples in the clip (`ui.audio_data`).",
  ],
  [
    "reverse_clip_tool",
    "A clip on a locked track is refused; the desktop's handler reverses it anyway (its Time menu skips the lock check).",
  ],
  [
    "colour frames (analyze_frame_colors_tool, chroma_key_clip_tool, inspect_color_tool, match_color_to_reference_tool, the after previews of apply_color_tool / apply_look_tool)",
    "Frames come from the host's renderer (the one the person sees) and are measured with a port of libopenshot's FrameScope; the desktop renders on a private libopenshot timeline. A clip alone is rendered twice (as is, and with a Negate after its transform) to recover the transparency the host's opaque frames do not carry. analyze_frame_colors_tool measures frames at most 960 px wide (the desktop: the project size). The web editor stays editable while frames render (the desktop renders on its GUI thread), so chroma_key_clip_tool and match_color_to_reference_tool write nothing, and say so, when the clip was edited meanwhile.",
  ],
  [
    "analyze_frame_colors_tool",
    "save_frame_path is not written (web surfaces write no files): the analyzed frame is attached to the result (`frame_attached: true`, with a warning).",
  ],
  [
    "chroma_key_clip_tool",
    "Without frame rendering, key_color='auto' is refused, 'green' / 'blue' key the stock shade (the desktop's fallback when sampling fails) and keyed_pct is null.",
  ],
  [
    "LUTs (list_luts_tool, color_grade_clip_tool, update_effect_tool lut_path, apply_color_tool, apply_look_tool)",
    "The 50 built-in LUTs are bundled with every renderer and stored as `@colors/<category>/<name>.cube`, the alias the desktop writes on save, so they render the same everywhere. A .cube file outside them is accepted where the host reads local files (the CLI) once it parses the way libopenshot loads it, and refused elsewhere. list_luts_tool lists the built-ins (the desktop also lists the user's LUT folder).",
  ],
  [
    "apply_color_tool, apply_look_tool, inspect_color_tool, list_looks_tool, match_color_to_reference_tool",
    "The result is the desktop's JSON object, as the summary and as `data`. Preview frames are attached as images (MCP image content, the Assistant's image sidecar) and their `*_preview_jpeg` fields name the attachment (`attached image 1`) instead of carrying base64. Scopes give clipped shadows/highlights as shares of the frame (0-1), which the nuke-risk, outdoor and match-loop thresholds expect; the desktop passes FrameScope's pixel counts to them.",
  ],
  [
    "match_color_to_reference_tool",
    "The grading passes run on a working copy and the final grade is one undo step; a pass the desktop would abort halfway (a merged saturation below 0.5) refuses before anything changes. referenceImagePath needs local file access (the CLI).",
  ],
  [
    "process_clip_effect_tool",
    "Refused on every web surface: Stabilizer, Tracker, Object Detector and Object Mask run OpenCV analysis (libopenshot ClipProcessingJobs) inside Zenvi desktop. The effects it adds play back there; the web renderers pass them through, and list_effects_tool marks them `renders_on_web: false`.",
  ],
  [
    "summary previews",
    "`…` is written as U+2026; the desktop's file had the mojibake `ΓÇª` (ai_metadata_utils.build_summary_preview).",
  ],
];

const LEVEL: Record<Availability, string> = { yes: "yes", partial: "partial", no: "—" };

function typeOf(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" \\| ");
  const branches = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])];
  if (branches.length > 0) return [...new Set(branches.map(typeOf))].join(" \\| ");
  if (Array.isArray(schema.type)) return schema.type.join(" \\| ");
  if (schema.type === "array" && schema.items) return `${typeOf(schema.items)}[]`;
  return String(schema.type ?? "any");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function oneLine(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  const end = flat.search(/(?<=[.!?])\s/);
  return end > 0 ? flat.slice(0, end) : flat;
}

function argsTable(tool: CatalogTool): string[] {
  const props = Object.entries(tool.inputSchema.properties);
  if (props.length === 0) return ["No arguments."];
  const required = new Set(tool.inputSchema.required ?? []);
  const desktopOnly = new Set<string>(tool.contract ? (PENDING_DESKTOP_ARGS[tool.name as ContractToolName] ?? []) : []);
  const rows = ["| Argument | Type | Required | Description |", "| --- | --- | --- | --- |"];
  for (const [name, schema] of props) {
    const extras: string[] = [];
    if (schema.default !== undefined) extras.push(`default ${JSON.stringify(schema.default)}`);
    if (schema.minimum !== undefined) extras.push(`min ${schema.minimum}`);
    if (schema.maximum !== undefined) extras.push(`max ${schema.maximum}`);
    const desc = [desktopOnly.has(name) ? "**Zenvi desktop only so far.**" : "", schema.description ?? "", extras.length ? `(${extras.join(", ")})` : ""]
      .filter(Boolean)
      .join(" ");
    rows.push(`| \`${name}\` | ${typeOf(schema)} | ${required.has(name) ? "yes" : ""} | ${cell(desc)} |`);
  }
  return rows;
}

/** zenvi-core editor_tools workstreams (editor_tools/__init__.py WORKSTREAM_OF_MODULE). */
const WORKSTREAMS = ["project_export", "timeline_edit", "clip_props", "effects_color", "titles_text", "tracks_nav", "media_files", "ai_generation"];

/** The desktop area a tool's handler lives in: its editor_tools workstream, or its module. */
function desktopArea(name: ContractToolName): string {
  const file = contractMeta[name].handler.split(":")[0]!;
  const module = /editor_tools\/(\w+)\.py$/.exec(file)?.[1];
  if (module) {
    const workstream = WORKSTREAMS.find((w) => module === w || module.startsWith(`${w}_`)) ?? module;
    return `${workstream.replace("_", "-")} (editor_tools)`;
  }
  if (file.endsWith("agent_api_proxy.py")) return "MCP extras (desktop app plumbing)";
  return file.split("/").pop()!;
}

function notPorted(): string[] {
  const byArea = new Map<string, string[]>();
  for (const name of PENDING_DESKTOP_TOOLS) {
    const area = desktopArea(name);
    byArea.set(area, [...(byArea.get(area) ?? []), name]);
  }
  const out = [
    "## Not ported yet",
    "",
    `Zenvi desktop lists ${CONTRACT_TOOL_NAMES.length} tools. ${PENDING_DESKTOP_TOOLS.size} are not ported yet (\`packages/engine/src/tools/pending.ts\`): ` +
      "no web surface lists them, and a call answers `Error: <tool> is not available in this Zenvi surface`. Their desktop schemas are in `schemas.gen.ts`. By desktop area:",
    "",
  ];
  for (const [area, names] of [...byArea].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`- **${area}** (${names.length}): ${names.map((n) => `\`${n}\``).join(", ")}`);
  }
  if (DESKTOP_NAMES_ON_DIRECT_TOOLS.size > 0) {
    out.push(
      "",
      `Desktop tools whose names the web uses for older direct tools with other arguments (the desktop versions are not ported): ${[...DESKTOP_NAMES_ON_DIRECT_TOOLS].map((n) => `\`${n}\``).join(", ")}.`,
    );
  }
  out.push(
    "",
    "Arguments of ported tools that only Zenvi desktop takes so far. A call that sets one to anything but its default is refused before anything changes " +
      "(`Error: <tool> cannot use <argument> in this Zenvi surface yet …`, so the Assistant retries without it):",
    "",
  );
  for (const [name, args] of Object.entries(PENDING_DESKTOP_ARGS)) out.push(`- \`${name}\`: ${args.join(", ")}`);
  out.push("");
  return out;
}

function render(): string {
  const matrix = availabilityMatrix(allTools);
  const contract = allTools.filter((t) => t.contract).length;
  const direct = allTools.length - contract;
  const count = (surface: "editor" | "cli" | "cloud", level: Availability): number => matrix.filter((m) => m.availability[surface] === level).length;
  const out: string[] = [
    "# Zenvi tools",
    "",
    "<!-- Generated by packages/engine/scripts/gen-tools-doc.ts from @zenvi/engine/tools. Do not edit by hand. -->",
    "",
    `One tool catalog for every Zenvi surface: the Zenvi Assistant in the web editor, the local MCP server (\`zenvi mcp\`), the Zenvi Cloud remote MCP server, and the CLI. ` +
      `${allTools.length} tools: ${contract} of the ${CONTRACT_TOOL_NAMES.length} tools Zenvi desktop lists (zenvi-core develop \`${CONTRACT_REF}\`; same names, arguments and receipts) and ${direct} direct tools for coding agents. ` +
      `The other desktop tools are not ported yet (see [Not ported yet](#not-ported-yet)).`,
    "",
    "Every call returns a contract-3 receipt (`{contract: 3, status, tool, summary, clips, …, undoSteps}`); a failure's summary starts with `Error:`, " +
      "and a surface limitation says `Error: <tool> is not available in this Zenvi surface: …` (do not retry). One call is at most one undo step.",
    "",
    "## Where tools work",
    "",
    "| Surface | Host | Works | Partial | Not available |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const surface of ["editor", "cli", "cloud"] as const) {
    const p = SURFACE_PROFILES[surface];
    out.push(`| ${p.title} | \`${p.host}\` | ${count(surface, "yes")} | ${count(surface, "partial")} | ${count(surface, "no")} |`);
  }
  out.push(`| Zenvi desktop | zenvi-core | ${contract} | 0 | ${direct} (direct tools are web-only) |`, "");
  out.push(
    "Availability follows each tool's required host capabilities and the host methods it calls at run time; the hosts are described in `SURFACE_PROFILES` (packages/engine/src/tools/availability.ts). " +
      "Capabilities a session may lack (signed out of Zenvi, no WebCodecs export) are noted per tool.",
    "",
  );
  for (const surface of ["editor", "cli", "cloud"] as const) {
    const p = SURFACE_PROFILES[surface];
    const conditional = Object.entries(p.conditional ?? {}).map(([cap, why]) => `${cap} (${why})`);
    out.push(
      `- **${p.title}**: ${p.capabilities.join(", ")}; methods ${p.methods.join(", ") || "none"}` +
        `${conditional.length ? `; only sometimes: ${conditional.join(", ")}` : ""}${p.hidden?.length ? `; hides ${p.hidden.length} local-app tools` : ""}.`,
    );
  }
  out.push("", "## Matrix", "", "| Tool | Surfaces | Editor | CLI / local MCP | Cloud MCP | Desktop |", "| --- | --- | --- | --- | --- | --- |");
  for (const { tool, availability: a } of matrix) {
    const name = tool.deprecated ? `\`${tool.name}\` (deprecated)` : `[\`${tool.name}\`](#${tool.name})`;
    out.push(`| ${name} | ${tool.surfaces.join(", ")} | ${LEVEL[a.editor]} | ${LEVEL[a.cli]} | ${LEVEL[a.cloud]} | ${LEVEL[a.desktop]} |`);
  }
  out.push("", "## Tools", "");
  for (const { tool, availability: a } of matrix) {
    out.push(`### ${tool.name}`, "");
    out.push(`**${tool.title}**${tool.contract ? "" : " (direct tool)"}${tool.deprecated ? " — deprecated, kept for stored plans" : ""}. ${oneLine(tool.description)}`, "");
    const hints = [
      tool.annotations?.readOnlyHint ? "read-only" : "edits",
      tool.annotations?.destructiveHint ? "destructive" : "",
      tool.annotations?.openWorldHint ? "open world" : "",
    ].filter(Boolean);
    out.push(`Surfaces: ${tool.surfaces.join(", ")}. ${hints.join(", ")}.${tool.requires?.length ? ` Needs: ${tool.requires.join(", ")}.` : ""}`, "");
    const notes = (["editor", "cli", "cloud", "desktop"] as const).map((s) => `${s} ${LEVEL[a[s]]}${a.notes[s] ? ` (${a.notes[s]})` : ""}`);
    out.push(`Availability: ${notes.join("; ")}.`, "");
    out.push(...argsTable(tool), "");
  }
  out.push(...notPorted());
  out.push("## Divergences from the desktop", "", "Deliberate differences from the zenvi-core handlers:", "");
  for (const [what, why] of DIVERGENCES) out.push(`- **${what}**: ${why}`);
  out.push("");
  return out.join("\n");
}

const text = render();
if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(OUT, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== text) {
    console.error("docs/TOOLS.md is stale: run npx tsx packages/engine/scripts/gen-tools-doc.ts");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${allTools.length} tools`);
}
