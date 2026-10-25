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
    "A marker's name is stored as `label`; zenvi-core develop stores `name` (track_ops.add_marker). list_markers_tool, the marker tools and the web editor's ruler read either.",
  ],
  [
    "add_title_tool",
    "Templates are the bundled catalog, read by basename only (the desktop joined a bare template name into its titles folder unchecked, agent_tools/titles.py:81); an absolute .svg path is read through the host's storage.",
  ],
  [
    "add_animated_title_tool / list_title_templates_tool kind=animated",
    "The Blender templates are drawn as 2D titles: an SVG title animated with clip keyframes (scale, position, rotation, opacity) and the engine's Glow, Blur and LensFlare effects, so they render the same in the browser, the CLI and the cloud and stay editable. Extrusion, bevel, lighting, particles and 3D camera moves are approximated or dropped. Template names, parameters, defaults, validation and the length (template frames × length_multiplier, remapped for the project frame rate like Blender) are the desktop's; earth, magic_wand, snow and picture_frames_4 are 3D scenes and are refused as desktop-only; spacemovie_intro and colors place three clips in a row; timeout_seconds is accepted and unused. kind=animated lists `renders_here` and `look` per template and a `renderer` block where the desktop reports its Blender setup.",
  ],
  [
    "edit_title_tool",
    "The edited title is a new Project Files entry that takes the old one's place in every clip and in the bin (scope=all_clips), in the same undo step; the desktop points the same entry at the new SVG and keeps its file_id. Web hosts store media by content and never change the bytes behind a file id. The receipt's file_id is the new entry's.",
  ],
  [
    "titles, captions and timers: fonts",
    "Fonts are taken as given: the hosts cannot list installed fonts (the browser and resvg each fall back on their own). The desktop checks names against Qt's font database, suggests close matches for an unknown font, replaces a template font that is not installed with the Title Editor's fallback, and drops a caption preset's font (thinning its outline) when that font is missing.",
  ],
  [
    "list_title_templates_tool",
    "kind=static lists the 50 bundled templates; the web has no user template folder. kind=project reads each title through the host's storage (bundled emoji through the assets).",
  ],
  [
    "add_emoji_tool / search_emojis_tool",
    "The desktop's 1,239 OpenMoji SVGs ship with the engine (assets/emojis, minified without changing what they draw; scripts/gen-emojis.mjs) and are stored as `@emojis/<file>` like the desktop stores them. There is no user emoji folder (group 'user' finds nothing). duration_seconds 0 is 10 s, the desktop's Default Image Length preference default.",
  ],
  [
    "list_captions_tool / edit_captions_tool / remove_captions_tool",
    "They work on Caption effects, as on desktop develop (made by add_captions_tool, Zenvi desktop or the Caption effect). With no target the project's only caption track is used: the web has no effect selection to pick from.",
  ],
  [
    "speech: get_transcript_tool, transcribe_media_tool, remove_words_tool, export_captions_tool, add_captions_tool, duck_under_speech_tool",
    "Speech recognition runs on the Zenvi server (`POST /api/v1/transcription`, zenvi-backend #67: OpenAI whisper-1, 2 credits per started minute, a Zenvi sign-in), not on device. The host sends mono 16 kHz speech audio (MP3 from ffmpeg on the CLI and in Zenvi Cloud, WAV from Web Audio in the editor), long media in pieces split at pauses. A file's words come from, in order: a transcription kept on the file, the media index's transcript cues (word timings estimated by character count: `transcriptionSource: \"index_cues\"`, `wordTiming: \"estimated\"`), then a new transcription (`transcriptionSource: \"server\"`, `wordTiming: \"exact\"`). The words are kept in the project on the file (`ai_metadata.asr`: the desktop transcript cache record's fields plus the segments and the media's content hash), outside the undo history, so the next call, another surface or an exported .zvn reuses them and undoing an edit keeps them; the desktop caches on disk and ignores the key. Whisper leaves out \"um\" and \"uh\" unless prompted, so English and auto-detected requests carry OpenAI's filler prompt; words take the punctuation of the server's segments, like faster-whisper's. Without a target only clips with a picture and sound are transcribed (audio-only clips such as music beds only when the timeline has no such footage, or when named). modelId and engine are accepted and unused (one server model). A server without the route answers in words: `speech recognition is not available yet on this Zenvi server`.",
  ],
  [
    "add_captions_tool",
    "Transcript captions: the desktop reads only the index's transcript cues (shared out by character count); here a clip's words come as for get_transcript_tool, and recognized words keep their own timings: captions break at sentence ends, at pauses over 0.8 s and where the desktop's line-breaking costs put them (maxWords, maxChars), each runs from its first word to its last and stays up across a short pause. Subtitle files are read through the host: from disk on the CLI, from the project's files in Zenvi Cloud and the editor.",
  ],
  [
    "remove_words_tool",
    "Cuts on real word timings only (a kept or new transcription, never the index's estimates). wordIndices must come from the words they cut: indices for a transcription made by the same call are refused (call get_transcript_tool first), and a transcription made after the index's words gets the next transcriptGeneration, so indices read from the index are refused as stale. Refusals that need no words (an unknown fillerPreset, a retimed clip, an ambiguous clipId) come before any transcription is paid for.",
  ],
  [
    "duck_under_speech_tool / analyze_timeline_audio_tool",
    "With speech_clip_ids=auto and no indexed speech, talking footage (picture and sound) without a transcript is transcribed and its words become the speech windows (`transcript`); the desktop falls back to its local VAD. A kept transcription also marks a clip the index does not know as speech in analyze_timeline_audio_tool.",
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
    "save_project_tool and export_video_tool replace an existing file (the CLI's) where the desktop refuses unless overwrite=true; add_title_tool never shrinks long lines (desktop fit_text=true); new_project_tool / open_project_tool have no unsaved-changes guard (every web surface autosaves, so discard_unsaved is accepted as is); generate_tts_and_add_to_timeline_tool defaults to the track below the picture, where the desktop picks or creates a free narration track.",
  ],
  [
    "tools zenvi-core develop rewrote as editor tools",
    "get_project_info_tool, list_markers_tool, get_export_settings_tool, set_export_setting_tool, new/open/save_project_tool, play_tool, add_track_tool, add_marker_tool, export_video_tool, generate_tts_and_add_to_timeline_tool, add_effect_tool, add_title_tool, set_keyframes_tool and set_project_setting_tool take develop's schemas; their results keep the earlier text and receipts (develop answers with structured receipts), set_export_setting_tool stores any key (develop checks keys and aliases), and set_keyframes_tool animates the seven earlier properties (develop: any keyframable clip property).",
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
    "apply_clip_preset_tool",
    "Runs the engine's port of the clip menu's handlers (ops/presets.ts, also behind the web editor's clip menu) as of develop: fade lengths, the combined in-and-out fade, motion zone lengths and the wipe-out masks. crop / crop_resize add the Crop effect with a new effect id and do not select it (the desktop also selects it and shows its transform handles). An Emphasis preset without at_seconds starts at the host's playhead: the saved playhead on the CLI and in Zenvi Cloud.",
  ],
  [
    "seek_playhead_tool",
    "In the web editor it moves the editor's playhead and reports where it is. The web editor's playhead stops at the end of the last clip, so a time past it is reported there with a note (the desktop goes there and shows black). Without a preview (CLI, Zenvi Cloud) it moves the playhead saved with the project (`playhead_position`, where the web and desktop editors open), with no undo step, and play=true is refused; previous/next marker then has no selection to follow. Playback is checked before the playhead moves (the desktop moves, then refuses to play from the end).",
  ],
  [
    "get_playhead_and_selection_tool",
    "Without an editor (CLI, Zenvi Cloud) it reports the saved playhead, playback stopped, and `selection` and `view` as null (`saved: true`). In the web editor the zoom is the editor's pixels per second as `seconds_per_100px`, and `timing` is null: the web timeline has no timing mode.",
  ],
  [
    "set_timeline_view_tool / select_timeline_items_tool",
    "They need the web editor. Zoom steps are the editor's own (×1.5); a range or visible_seconds zooms and scrolls the editor's timeline within its zoom limits, and the receipt reads the view back. The web timeline has no timing (retime-by-drag) mode: timing=true is refused, timing=false is already so. The Properties panel shows one effect: selecting effects selects the last one named together with its clip, and the receipt says so.",
  ],
  [
    "update_marker_tool / remove_marker_tool",
    "A marker's name is read from `name` (desktop) or `label` (the web's add_marker_tool); a rename writes it where the marker keeps it, and a marker without a name gets `label`. The web editor's ruler shows either. Times past the end of the timeline are checked against the length the desktop keeps (at least 300 s and 10 s past the last item).",
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
    "generate_image_and_add_to_timeline_tool",
    "Where the image would go (position_seconds, the track, a locked track) is checked before the backend is asked, so a typo spends no credits; the desktop generates first and then reports a placement it cannot make. When the placement fails after generating (the track was locked meanwhile in the editor), the image stays in Project Files and the answer is an applied receipt with its file_id and the desktop's \"Do NOT regenerate\" line, which the desktop sends as an error. The host stores the image as generated_<12 random characters>.<ext>: in the project's assets folder on the CLI, as content-addressed `@assets/generated/` media in Zenvi Cloud, in browser storage in the editor.",
  ],
  [
    "ingest_web_video_tool (decision: web pages are fetched only on the person's own computer)",
    "The zenvi CLI and `zenvi mcp` fetch a web page's video with the yt-dlp program the person installed (the desktop ships yt-dlp as a Python module; `zenvi doctor` checks for it, ZENVI_YT_DLP sets its path); without it a page link is refused in words, and direct media links (.mp4, .mov, .webm, .mkv, .avi) still work. Zenvi Cloud and the web editor refuse in words: a hosted server or a browser fetching third-party pages is a different legal and terms-of-service position from a person's own computer, and it gets server addresses blocked. Their refusal points to a direct link to the media file (import_media_from_url in Zenvi Cloud, import_video_url_and_add_to_timeline_tool) or an upload. On the CLI the intents, the job budgets (about 25 s, then status=running with a job_id; a job_id call waits up to about 45 s; a second call for the same link joins the download) and the JSON answers are the desktop's, as `data`; the import and placement happen in the call that finds the download finished, as that call's one undo step (the desktop's download thread imports when it lands), and `zenvi call` follows a running job to the end. Failures are error receipts (`Error: <reason>`) carrying the desktop's ok=false object, which the desktop sends as an applied JSON answer. A placement that cannot work (a bad position, an unknown or locked track) is refused before anything is downloaded. A link that ends like a video file but answers with a web page (a Wikimedia Commons `File:….webm` page) is read as a page; the desktop downloads the page itself as the video and fails to import it. Videos are cached for seven days under the Zenvi cache folder, named after the page, and copied into the project's assets folder when imported (the desktop re-encodes them to generated_<id>.mp4).",
  ],
  [
    "list_comfyui_templates_tool, list_comfyui_jobs_tool, create_media_with_comfyui_tool, enhance_file_with_comfyui_tool, cancel_comfyui_job_tool, prepare_recording_tool",
    "Refused on every web surface. The ComfyUI tools drive the ComfyUI server on the person's own computer that Zenvi desktop connects to (Preferences > AI > ComfyUI URL, blank = off) through its template registry, generation queue and workflow graphs; no web surface has that integration, and Zenvi Cloud and the browser cannot reach a local server. prepare_recording_tool sets up the desktop's Recording dock (microphone, screen and webcam capture). The refusals name what works here: generate_image_and_add_to_timeline_tool, generate_video_and_add_to_timeline_tool and generate_tts_and_add_to_timeline_tool.",
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
