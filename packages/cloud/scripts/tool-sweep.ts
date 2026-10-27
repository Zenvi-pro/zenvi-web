/**
 * Every tool of a Zenvi Cloud, called once the way a connector would, on a
 * scratch project with real media: two videos with sound, a
 * talking clip with pauses and a filler word, a beat track and a still.
 * Each call starts from the same baseline (restored over REST between
 * calls), and the project is parsed after every change, so a call that
 * breaks the project is caught even when it reports success.
 *
 *   ZENVI_CLOUD_URL=https://… ZENVI_TOKEN=zvn_pat_… npx tsx packages/cloud/scripts/tool-sweep.ts <out dir> [--only a,b] [--list] [--paid]
 *
 * Without ZENVI_CLOUD_URL it sweeps a Zenvi Cloud in this process (this
 * checkout's code) with the real backend: see live-client.ts.
 *
 * Writes <out dir>/sweep.json and sweep.md: per tool the arguments, how it
 * ended and the start of the answer. Outcomes:
 *   ok        answered without an error
 *   refused   a clean refusal ("Error: …" in words): read it, the arguments may be the problem
 *   crash     an exception, a protocol error, a timeout or an internal error message
 *   broken    the call left a project that no longer parses
 *   dirty     refused or unchanged, but the project was edited anyway (history must stay untouched;
 *             a speech recognition result kept on a file, `ai_metadata.asr`, is not an edit)
 *   noop      a tool that adds or imports answered without an error but the project did not change
 * --list only writes tools.json (names and input schemas). Paid generation
 * (video, images) is skipped unless --paid. Needs ffmpeg, and macOS `say`
 * for the spoken words.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseProject } from "@zenvi/engine";
import { connectCloud, type LiveCloud } from "./live-client.js";

type Json = Record<string, unknown>;
type CallResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Json };
type Outcome = "ok" | "refused" | "crash" | "broken" | "dirty" | "noop";
interface ToolInfo {
  name: string;
  inputSchema: { properties?: Record<string, JsonSchema>; required?: string[] };
}
interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}
interface Row {
  tool: string;
  args: Json;
  outcome: Outcome;
  ms: number;
  changed: boolean;
  answer: string;
}

/** Tools that cost money per call (generated video and images). */
const PAID = new Set(["generate_video", "get_generation_status", "generate_video_and_add_to_timeline_tool", "generate_image_and_add_to_timeline_tool", "generate_transition_clip_tool"]);
/** Tools the setup already ran, and create_reel (reel-live.ts covers it: it downloads stock and music into a new project). */
const NOT_SWEPT = new Set(["create_project", "import_media_from_url", "create_reel"]);
const SLOW_MS = 30_000;
/** Tools whose job is to add to the project: an answer without a change is suspicious. */
const ADDS = /^(add_|import_|generate_.*_and_add|fetch_motion|place_|split_file_add)/;
const CRASH =
  /TypeError|ReferenceError|RangeError|SyntaxError|Cannot read|Cannot set|undefined is not|is not a function|is not iterable|Internal (server )?error|Maximum call stack|\[object Object\]|\bNaN\b|unexpected error|ECONNRESET|timed? ?out/i;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outDir = args.find((a) => !a.startsWith("--"));
  if (!outDir) throw new Error("usage: [ZENVI_CLOUD_URL=… ZENVI_TOKEN=zvn_pat_…] tool-sweep.ts <out dir> [--only a,b] [--list] [--paid]");
  const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? (args.includes("--only") ? args[args.indexOf("--only") + 1]?.split(",") : undefined);
  mkdirSync(outDir, { recursive: true });

  const cloud = await connectCloud("tool-sweep");
  const { client } = cloud;
  const tools = (await client.listTools()).tools as ToolInfo[];
  writeFileSync(path.join(outDir, "tools.json"), JSON.stringify(tools, null, 2));
  console.log(`${tools.length} tools (${cloud.where})`);
  if (args.includes("--list")) return;

  const rest = restClient(cloud);
  const call = async (name: string, toolArgs: Json): Promise<CallResult> => (await client.callTool({ name, arguments: toolArgs }, undefined, { timeout: 180_000 })) as CallResult;
  const ctx = await setUp(call, rest);
  const baseline = await rest("GET", `/v1/projects/${ctx.projectId}`);
  console.log(`baseline: ${ctx.projectId}, ${JSON.stringify((baseline as { stats?: unknown }).stats)}`);

  const rows: Row[] = [];
  let revision = String((baseline as Json).revision);
  for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
    if (NOT_SWEPT.has(tool.name) || (only && !only.includes(tool.name))) continue;
    if (PAID.has(tool.name) && !args.includes("--paid")) continue;
    const toolArgs = argsFor(tool, ctx);
    // Other clients on the same token share its current project (create_reel switches it), so name ours.
    if (tool.inputSchema.properties?.project_id && toolArgs.project_id === undefined) toolArgs.project_id = ctx.projectId;
    const started = Date.now();
    let result: CallResult | undefined;
    let thrown = "";
    try {
      result = await call(tool.name, toolArgs);
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    const ms = Date.now() - started;
    const after = (await rest("GET", `/v1/projects/${ctx.projectId}`)) as Json;
    const changed = String(after.revision) !== revision;
    const answer = thrown || textOf(result);
    let outcome = classify(result, thrown);
    if (changed) {
      try {
        parseProject(after.project);
      } catch (error) {
        outcome = "broken";
        thrown = `${answer}\n  parse: ${error instanceof Error ? error.message : String(error)}`;
      }
      const edited = JSON.stringify(withoutTranscripts(after.project)) !== JSON.stringify(withoutTranscripts(baseline.project));
      if (edited && outcome !== "broken" && (outcome === "refused" || /"status":\s*"(unchanged|refused)"/.test(answer))) outcome = "dirty";
      const restored = (await rest("PUT", `/v1/projects/${ctx.projectId}`, baseline.project, { "if-match": "*" })) as Json;
      revision = String(restored.revision);
    }
    if (outcome === "ok" && !changed && ADDS.test(tool.name) && !/already in (the )?project/i.test(answer)) outcome = "noop";
    rows.push({ tool: tool.name, args: toolArgs, outcome, ms, changed, answer: (thrown || answer).slice(0, 600) });
    console.log(`${outcome.padEnd(7)} ${String(ms).padStart(6)} ms ${changed ? "*" : " "} ${tool.name} — ${oneLine(thrown || answer).slice(0, 160)}`);
  }
  writeFileSync(path.join(outDir, "sweep.json"), JSON.stringify({ cloud: cloud.where, projectId: ctx.projectId, at: new Date().toISOString(), rows }, null, 2));
  writeFileSync(path.join(outDir, "sweep.md"), report(rows));
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  console.log(`\n${rows.length} tools: ${JSON.stringify(counts)}; slow (>${SLOW_MS / 1000} s): ${rows.filter((r) => r.ms > SLOW_MS).length}`);
}

type Rest = (method: string, route: string, body?: unknown, headers?: Record<string, string>) => Promise<Json>;

function restClient(cloud: LiveCloud): Rest {
  return async (method, route, body, headers = {}) => {
    const res = await cloud.fetch(route, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Json) : {};
  };
}

type MediaKey = "a" | "b" | "talk" | "beat" | "still";
interface Context {
  projectId: string;
  files: Record<MediaKey, string>;
  urls: Record<MediaKey, string>;
  /** Timeline clip ids by what they show: the media keys, plus the title. */
  clips: Record<MediaKey | "title", string>;
  /** The Blur effect on clip A. */
  effectId: string;
  /** The fade-in and fade-out transitions on the still (track 2). */
  transitions: string[];
  /** A Pexels result from search_pexels_videos_tool, when the surface has it. */
  stock?: { video_id: number; link: string };
}

/** Media, project and a baseline timeline: what most tools need to act on. */
async function setUp(call: (name: string, args: Json) => Promise<CallResult>, rest: Rest): Promise<Context> {
  const dir = mkdtempSync(path.join(tmpdir(), "zenvi-sweep-"));
  const media = makeMedia(dir);
  const urls: Record<string, string> = {};
  for (const [key, file] of Object.entries(media)) urls[key] = await upload(rest, file);

  const made = await call("create_project", { name: `Tool sweep ${new Date().toISOString().slice(0, 16)}`, format: "vertical_1080p" });
  const projectId = String(made.structuredContent?.project_id ?? "");
  if (!projectId) throw new Error(`create_project: ${textOf(made)}`);
  const files: Record<string, string> = {};
  for (const [key, url] of Object.entries(urls)) {
    const imported = await call("import_media_from_url", { url, name: path.basename(media[key as keyof typeof media]), project_id: projectId });
    files[key] = String(imported.structuredContent?.file_id ?? "");
    if (!files[key]) throw new Error(`import ${key}: ${textOf(imported)}`);
  }

  // The baseline: A, B and the talking clip in a row; the still above; music below; a title, a marker, an effect.
  const steps: [string, Json][] = [
    ["add_clip_to_timeline_tool", { file_id: files.a, position_seconds: "0" }],
    ["add_clip_to_timeline_tool", { file_id: files.b, position_seconds: "6" }],
    ["add_clip_to_timeline_tool", { file_id: files.talk, position_seconds: "11" }],
    ["add_clip_to_timeline_tool", { file_id: files.still, position_seconds: "2", track: "2" }],
    // Music on its own track (without track= the desktop's rule puts it on the bottom layer, under the video);
    // audio needs the range to use, as on the desktop.
    ["add_track_tool", { label: "Music" }],
    ["add_clip_to_timeline_tool", { file_id: files.beat, position_seconds: "0", start_seconds: "0", duration_seconds: "12", track: "Music" }],
    ["add_title_tool", { text: "Sweep", position_seconds: "1", duration_seconds: "3" }],
    ["add_marker_tool", { position_seconds: "3", label: "Sweep marker" }],
  ];
  for (const [name, args] of steps) {
    const result = await call(name, { ...args, project_id: projectId });
    console.log(`setup ${name}: ${oneLine(textOf(result)).slice(0, 140)}`);
  }
  const roles = async () => {
    const loaded = await rest("GET", `/v1/projects/${projectId}`);
    const project = loaded.project as { clips: { id: string; file_id: string; effects?: { id: string }[] }[] };
    const byFile = Object.fromEntries(Object.entries(files).map(([key, id]) => [id, key]));
    const clips: Record<string, string> = {};
    for (const clip of project.clips) clips[byFile[clip.file_id] ?? "title"] = clip.id;
    return { project, clips: clips as Context["clips"] };
  };
  const { clips } = await roles();
  const effect = await call("add_effect_tool", { timeline_clip_id: clips.a, effect: "Blur", project_id: projectId });
  console.log(`setup add_effect_tool: ${oneLine(textOf(effect)).slice(0, 140)}`);
  // Alpha keyframes on clip A for the keyframe tools to copy and remove.
  const faded = await call("fade_clip_tool", { clip_id: clips.a, fade_in_seconds: "0.5", project_id: projectId });
  console.log(`setup fade_clip_tool: ${oneLine(textOf(faded)).slice(0, 140)}`);
  // Captions for the caption tools to list, edit and remove: given cues (timeline seconds; the talking clip starts at 11 s).
  const captioned = await call("add_captions_tool", { timeline_clip_id: clips.talk, cues: [{ start: 11.2, end: 13.4, text: "Welcome to the Zenvi tool sweep" }], project_id: projectId }).catch(() => undefined);
  if (captioned) console.log(`setup add_captions_tool: ${oneLine(textOf(captioned)).slice(0, 140)}`);
  // Transitions for the transition tools to list, change, reverse, copy and remove: a fade in and out on the still.
  for (const placement of ["start", "end"]) {
    const faded = await call("apply_transition_tool", { clip1_id: clips.still, placement, transition_name: "fade", duration: "1", project_id: projectId });
    console.log(`setup apply_transition_tool ${placement}: ${oneLine(textOf(faded)).slice(0, 140)}`);
  }
  const { project } = await roles();
  const effectId = project.clips.find((c) => c.id === clips.a)?.effects?.[0]?.id ?? "";
  const transitions = ((project as { effects?: { id: string; position: number }[] }).effects ?? []).sort((x, y) => x.position - y.position).map((t) => t.id);
  if (transitions.length !== 2) throw new Error(`setup: expected 2 transitions on the still, found ${transitions.length}`);
  for (const key of ["a", "b", "talk", "beat", "still", "title"] as const) if (!clips[key]) throw new Error(`setup: no ${key} clip on the timeline`);
  // Stock the way a chat finds it, when the surface has the search.
  const found = await call("search_pexels_videos_tool", { query: "ocean waves", count: 1, project_id: projectId }).catch(() => undefined);
  // Zenvi Cloud answers an engine tool with { ok, project_id, data: <receipt> }; the results are the receipt's data.
  const receipt = found?.structuredContent?.data as { data?: { results?: { video_id: number; link: string }[] } } | undefined;
  const hit = receipt?.data?.results?.[0];
  return { projectId, files: files as Context["files"], urls: urls as Context["urls"], clips, effectId, transitions, stock: hit };
}

function makeMedia(dir: string): Record<"a" | "b" | "talk" | "beat" | "still", string> {
  const ffmpeg = (...args: string[]) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${r.stderr}`);
  };
  const out = (name: string) => path.join(dir, name);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out("sweep-a.mp4"));
  ffmpeg("-f", "lavfi", "-i", "smptehdbars=size=640x360:rate=30:duration=5", "-f", "lavfi", "-i", "sine=frequency=660:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out("sweep-b.mp4"));
  // 120 BPM: a decaying 60 Hz thump on every beat.
  ffmpeg("-f", "lavfi", "-i", "aevalsrc=0.9*sin(2*PI*60*t)*exp(-18*mod(t\\,0.5)):s=44100:d=12", "-c:a", "aac", "-b:a", "128k", out("sweep-beat.m4a"));
  // Spoken words with pauses and a filler word, over a moving picture.
  const said = spawnSync("say", ["-o", out("speech.aiff"), "Welcome to the Zenvi tool sweep. [[slnc 1200]] Um, this clip has a pause and a filler word. [[slnc 900]] Thanks for watching."]);
  if (said.status !== 0) throw new Error(`say: ${said.stderr}`);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-i", out("speech.aiff"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out("sweep-talk.mp4"));
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=800x800", "-frames:v", "1", out("sweep-still.png"));
  return { a: out("sweep-a.mp4"), b: out("sweep-b.mp4"), talk: out("sweep-talk.mp4"), beat: out("sweep-beat.m4a"), still: out("sweep-still.png") };
}

const CONTENT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".m4a": "audio/mp4", ".png": "image/png" };

/** Upload through the media API (deduplicated by hash) and return a signed read URL. */
async function upload(rest: Rest, file: string): Promise<string> {
  const bytes = readFileSync(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const contentType = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
  const ticket = (await rest("POST", "/v1/media", { sha256, size: bytes.length, name: path.basename(file), contentType })) as Json & { exists?: boolean; uploadUrl?: string; uploadHeaders?: Record<string, string> };
  if (!ticket.exists) {
    const put = await fetch(String(ticket.uploadUrl), { method: "PUT", headers: ticket.uploadHeaders, body: bytes });
    if (put.status !== 201) throw new Error(`upload ${file}: HTTP ${put.status}`);
    await rest("POST", `/v1/media/${sha256}/complete`);
  }
  return String((await rest("GET", `/v1/media/${sha256}/url`)).url);
}

/** Arguments a person would give: the tool's own fixture, else filled from the schema and the baseline. */
function argsFor(tool: ToolInfo, ctx: Context): Json {
  const fixture = FIXTURES[tool.name];
  if (fixture) return fixture(ctx);
  const props = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  const args: Json = {};
  for (const [key, schema] of Object.entries(props)) {
    const value = byName(key, ctx);
    if (value !== undefined && (required.has(key) || TARGETS.has(key))) args[key] = value;
    else if (required.has(key)) args[key] = byType(schema);
  }
  if ("clip_id" in args && "clip_ids" in args) delete args.clip_ids;
  if ("clip_id" in args && "timeline_clip_id" in args) delete args.timeline_clip_id;
  if ("timeline_clip_id" in args && "timeline_clip_ids" in args) delete args.timeline_clip_ids;
  if ("file_id" in args && "file_ids" in args) delete args.file_ids;
  return args;
}

/**
 * Optional arguments worth filling anyway: without them a tool has nothing to act on (no selection in the cloud).
 * project_id stays out unless required, as from ChatGPT: calls use the session's current project.
 */
const TARGETS = new Set(["clip_id", "clip_ids", "file_id", "file_ids", "timeline_clip_id", "timeline_clip_ids"]);

function byName(key: string, ctx: Context): unknown {
  if (/^(clip_id|clipId|clip|timeline_clip_id|target_clip_id|source_clip_id|item_id)$/.test(key)) return ctx.clips.a;
  if (/^(clip_ids|timeline_clip_ids)$/.test(key)) return [ctx.clips.a, ctx.clips.b];
  if (/^(file_id|fileId)$/.test(key)) return ctx.files.a;
  if (/^file_ids$/.test(key)) return [ctx.files.a, ctx.files.b];
  if (/^project_id$/.test(key)) return ctx.projectId;
  if (/url/.test(key)) return ctx.urls.a;
  if (/track|layer/.test(key)) return "1";
  if (/duration/.test(key)) return "2";
  if (/end/.test(key)) return "3";
  if (/position|start|time|seconds|frame/.test(key)) return "1";
  if (/colou?r/.test(key)) return "#ff3366";
  if (/query|search|prompt|description/.test(key)) return "ocean waves";
  if (/text|title|caption|label|name/.test(key)) return "Sweep";
  return undefined;
}

function byType(schema: JsonSchema): unknown {
  const branch = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (branch) return byType(branch);
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "boolean") return false;
  if (type === "number" || type === "integer") return schema.minimum ?? 1;
  if (type === "array") return [];
  if (type === "object") return {};
  return "1";
}

/** Hand-written arguments where the schema alone does not say what a person would ask. */
const FIXTURES: Record<string, (ctx: Context) => Json> = {
  add_animated_title_tool: () => ({ template: "glare", text: "Sweep glare", position_seconds: "1" }),
  add_emoji_tool: () => ({ emoji: "🔥", position_seconds: "2", duration_seconds: "2" }),
  add_captions_tool: (c) => ({ timeline_clip_id: c.clips.talk }),
  add_clip_to_timeline_tool: (c) => ({ file_id: c.files.b, position_seconds: "20" }),
  // Every clip that can take it (the music bed is skipped and listed), with a property set on add.
  add_effect_tool: () => ({ scope: "all", effect: "Saturation", properties: { saturation: 1.4 } }),
  add_marker_tool: () => ({ position_seconds: "4", label: "Second marker" }),
  // A lower third over a dark veil, lifted clear of the platform UI on the vertical baseline. Lato is bundled with
  // render-node, so every surface that lists its fonts has it.
  add_title_tool: () => ({
    text: "Hello sweep",
    subtitle: "Zenvi Cloud",
    template: "Standard_1",
    text_color: "white",
    background_color: "#00000099",
    font: "Lato",
    font_weight: "bold",
    screen_position: "bottom",
    fade_in_seconds: "0.5",
    fade_out_seconds: "0.5",
    position_seconds: "6",
    duration_seconds: "2",
  }),
  add_track_tool: () => ({ label: "Sweep track" }),
  // The title and the still sit on different tracks, so lining up their starts overlaps nothing.
  align_clips_tool: (c) => ({ timeline_clip_ids: [c.clips.title, c.clips.still] }),
  add_transition_tool: () => ({ track: "1", position_seconds: "5.5", duration_seconds: "1", transition: "common/fade" }),
  add_transitions_between_clips_tool: () => ({ track: "1", duration_seconds: 0.5 }),
  analyze_timeline_audio_tool: (c) => ({ timeline_clip_id: c.clips.talk }),
  // One clip by id: clip_ids is a comma-separated string on these older colour tools, as on the desktop.
  apply_color_tool: (c) => ({ timeline_clip_id: c.clips.a, contrast: "0.2", saturation: "1.2" }),
  apply_look_tool: (c) => ({ timeline_clip_id: c.clips.a, look_id: "gloomy" }),
  apply_transition_tool: (c) => ({ clip1_id: c.clips.a, clip2_id: c.clips.b, transition_name: "fade", duration: "1" }),
  build_reel_tool: (c) => ({ style: "hype", duration_seconds: 8, file_ids: [c.files.a, c.files.b, c.files.still], music_file_id: c.files.beat, hook: "Sweep reel", replace: true }),
  color_grade_clip_tool: (c) => ({ timeline_clip_id: c.clips.a, lut: "bold red cinema" }),
  // Media in Zenvi Cloud is stored with the project: collecting into a project folder is refused.
  consolidate_project_media_tool: () => ({ action: "collect" }),
  // Clip A has the Blur effect (setup).
  copy_effects_tool: (c) => ({ source_clip_id: c.clips.a, timeline_clip_ids: [c.clips.b] }),
  // Clip A fades in (setup): keyframes to copy and remove.
  copy_clip_keyframes_tool: (c) => ({ source_clip_id: c.clips.a, timeline_clip_ids: [c.clips.b] }),
  // The still's fade-in becomes its fade-out's settings.
  copy_transition_tool: (c) => ({ source_transition_id: c.transitions[0], transition_ids: [c.transitions[1]] }),
  create_subclips_tool: (c) => ({ file_id: c.files.a, subclips: [{ source_start_seconds: 1, source_end_seconds: 3, name: "Sweep hook" }] }),
  delete_from_timeline_tool: (c) => ({ timeline_clip_id: c.clips.b }),
  detect_beats_tool: (c) => ({ file_id: c.files.beat }),
  diarize_media_tool: (c) => ({ file_id: c.files.talk }),
  // The last clip on its track: the copy goes after it without covering anything.
  duplicate_clips_tool: (c) => ({ timeline_clip_ids: [c.clips.talk] }),
  // Comma-separated ids, as the schema says; the speech is found from the words (auto).
  duck_under_speech_tool: (c) => ({ bed_clip_ids: c.clips.beat, speech_clip_ids: "auto" }),
  export_captions_tool: (c) => ({ path: "sweep.srt", timeline_clip_id: c.clips.talk }),
  edit_captions_tool: (c) => ({ timeline_clip_id: c.clips.talk, uppercase: true }),
  edit_title_tool: (c) => ({ timeline_clip_id: c.clips.title, text: "Edited sweep" }),
  // Download links for a video and the still.
  export_files_to_folder_tool: (c) => ({ file_ids: [c.files.a, c.files.still] }),
  // EDL / Final Cut Pro XML are Zenvi desktop's conversions: refused here.
  export_project_file_tool: () => ({ format: "fcpxml" }),
  // A short range at 720p (the baseline is vertical 1080p): a render job; get_render_status gives the file.
  export_video_tool: () => ({ preset: "MP4 (h.264)", quality: "low", start: "1", end: "3", width: "720", height: "1280", file_name: "sweep-export" }),
  fade_clip_tool: (c) => ({ clip_id: c.clips.a, fade_in_seconds: "0.5", fade_out_seconds: "0.5" }),
  // The cloud's recent projects are the projects themselves: refused.
  forget_recent_projects_tool: () => ({ missing_only: true }),
  freeze_frame_tool: (c) => ({ timeline_clip_id: c.clips.a, at_seconds: "2", hold_seconds: "1", ripple: true }),
  fetch_motion_graphics_video_tool: () => ({ segment_urls: process.env.SWEEP_MOTION_URL ? [process.env.SWEEP_MOTION_URL] : [], label: "Motion segment" }),
  // Paid (--paid): one still, placed after the baseline.
  generate_image_and_add_to_timeline_tool: () => ({ prompt: "a red fox in fresh snow at golden hour", position_seconds: "16", duration_seconds: "3" }),
  generate_tts_and_add_to_timeline_tool: () => ({ text: "This is the sweep narration.", position: "2" }),
  get_file_info_tool: (c) => ({ file_id: c.files.talk }),
  get_render_status: () => ({ render_id: "r_sweep_unknown" }),
  get_transcript_tool: (c) => ({ file_id: c.files.talk }),
  // A folder of frames on this machine: Zenvi Cloud has no local folders, so this is refused.
  import_image_sequence_tool: () => ({ path: "renders/intro", fps: 24 }),
  import_attached_file: (c) => ({ file: { download_url: c.urls.still, file_id: "file_sweep", file_name: "attached.png", mime_type: "image/png" } }),
  // Zenvi desktop's conversion too: refused here.
  import_project_file_tool: () => ({ file_path: "cut.edl" }),
  import_stock_media_tool: (c) => (c.stock ? { source: "pexels", video_id: String(c.stock.video_id), link: c.stock.link, position_seconds: "16" } : { source: "pexels", video_id: "13736520", position_seconds: "16" }),
  import_video_url_and_add_to_timeline_tool: (c) => ({ video_url: c.urls.b, position_seconds: "20" }),
  // Hosted surfaces refuse web pages (nothing is fetched); the refusal names import_media_from_url.
  ingest_web_video_tool: () => ({ url: "https://www.youtube.com/watch?v=sweep000000", intent: "reference" }),
  inspect_media_tool: (c) => ({ fileId: c.files.a, overview: true }),
  inspect_timeline_tool: (c) => ({ clipId: c.clips.a, start: "0", end: "2" }),
  list_captions_tool: (c) => ({ timeline_clip_id: c.clips.talk }),
  // ComfyUI and recording are Zenvi desktop's: refused in words.
  create_media_with_comfyui_tool: () => ({ kind: "image", prompt: "misty pine forest at dawn" }),
  enhance_file_with_comfyui_tool: (c) => ({ file_id: c.files.a, action: "upscale" }),
  prepare_recording_tool: (c) => ({ sources: ["mic"], timeline_clip_id: c.clips.a }),
  list_project_profiles_tool: () => ({ query: "vertical", fps: 30 }),
  // Reading a rendered file needs ffmpeg on the person's computer: refused in words in the cloud.
  review_render_tool: () => ({ path: "sweep.mp4" }),
  // Custom profiles live in Zenvi desktop's profiles folder: refused in the cloud.
  manage_custom_profiles_tool: () => ({ action: "create", name: "Sweep square", width: 1000, height: 1000, fps: 30 }),
  match_color_to_reference_tool: (c) => ({ timeline_clip_id: c.clips.b, referenceClipId: c.clips.a }),
  list_project_files_tool: () => ({ usage: "used", detail: "full" }),
  list_projects: () => ({ limit: 5 }),
  list_timeline_transitions_tool: () => ({ track: "2" }),
  // Optimized previews are Zenvi desktop's: refused on every web surface.
  manage_optimized_previews_tool: () => ({ action: "status" }),
  modify_clip_tool: (c) => ({ timeline_clip_id: c.clips.b, description: "a calm ocean at sunset" }),
  move_clip_tool: (c) => ({ clip_id: c.clips.b, position_seconds: "7" }),
  move_clips_tool: (c) => ({ timeline_clip_ids: [c.clips.still], by_seconds: 1 }),
  open_project: (c) => ({ project_id: c.projectId }),
  // A still is opaque: cut it in (overlay needs a transparent render).
  place_motion_graphic_tool: (c) => ({ file_id: c.files.still, mode: "cut_in", position_seconds: "6", duration_seconds: "2" }),
  preview_frame: () => ({ time_seconds: 1, width: 320 }),
  probe_media_tool: () => ({ path: "sweep-a.mp4" }),
  reindex_project_file_tool: (c) => ({ file_id: c.files.a }),
  remove_captions_tool: (c) => ({ timeline_clip_id: c.clips.talk }),
  remove_effect_tool: (c) => ({ effect_id: c.effectId }),
  // The still is used once (track 2): removing its file takes that clip too.
  remove_files_from_project_tool: (c) => ({ file_ids: [c.files.still], confirm_remove_clips: true }),
  remove_keyframes_tool: (c) => ({ timeline_clip_ids: [c.clips.a], properties: ["all"] }),
  remove_marker_tool: () => ({ markers: ["Sweep marker"] }),
  // Tracks 4 and 5 are empty in the baseline.
  remove_track_tool: () => ({ track: "5" }),
  // The still starts at 2 s on track 2: one gap to close.
  remove_gaps_tool: () => ({ track: "2" }),
  remove_silence_tool: (c) => ({ timeline_clip_id: c.clips.talk }),
  remove_transition_tool: (c) => ({ transition_ids: [c.transitions[1]] }),
  remove_words_tool: (c) => ({ timeline_clip_id: c.clips.talk, fillerPreset: "um_uh" }),
  render_project: () => ({ height: 360, quality: "low" }),
  repeat_clip_tool: (c) => ({ timeline_clip_ids: [c.clips.talk] }),
  // No stored waveform data in the baseline: nothing to drop.
  reset_caches_and_history_tool: () => ({ target: "waveforms" }),
  // Zenvi Cloud keeps no recovery copies: refused.
  restore_recovery_version_tool: () => ({ version: 1 }),
  resummarize_project_file_tool: (c) => ({ file_id: c.files.a }),
  reverse_transition_tool: (c) => ({ transition_ids: [c.transitions[0]] }),
  save_frame_image_tool: () => ({ time: 2, file_path: "sweep-still.png" }),
  search_clip_scenes_tool: (c) => ({ query: "colour bars", timeline_clip_id: c.clips.b }),
  search_clips_tool: () => ({ query: "colour bars" }),
  search_emojis_tool: () => ({ query: "fire" }),
  search_media_local_tool: () => ({ query: "colour bars" }),
  search_transitions_tool: () => ({ query: "fade" }),
  seek_playhead_tool: () => ({ seconds: 3 }),
  set_clip_audio_video_tool: (c) => ({ timeline_clip_ids: [c.clips.a], audio: "off" }),
  set_clip_properties_tool: (c) => ({ timeline_clip_ids: [c.clips.a], properties: { alpha: 0.5 } }),
  set_clip_property_tool: (c) => ({ clip_id: c.clips.a, property: "alpha", value: "0.5" }),
  set_clip_speed_tool: (c) => ({ clip_id: c.clips.b, factor: "2" }),
  set_clip_volume_tool: (c) => ({ timeline_clip_id: c.clips.a, level_db: "-6" }),
  set_effect_property_tool: (c) => ({ effect_id: c.effectId, property: "horizontal_radius", value: "5" }),
  set_export_setting_tool: () => ({ key: "height", value: 720 }),
  set_keyframes_tool: (c) => ({ timeline_clip_id: c.clips.a, property: "alpha", points: [{ seconds: 0, value: 0 }, { seconds: 1, value: 1 }] }),
  // The baseline is vertical 1080p already: the same profile, and the landscape clips cropped to fill it.
  set_project_profile_tool: () => ({ profile: "instagram_reel", reframe: "fill" }),
  // The baseline is vertical already: the same profile, and full-frame clips of another shape fitted.
  set_project_setting_tool: () => ({ orientation: "portrait", reframe: "fit" }),
  slice_clip_at_best_match_tool: (c) => ({ query: "middle", timeline_clip_id: c.clips.a, start_seconds: "3" }),
  slice_clips_tool: (c) => ({ timeline_clip_ids: [c.clips.a], at_seconds: 3 }),
  split_clip_tool: (c) => ({ clip_id: c.clips.a, at_seconds: "3" }),
  split_file_add_clip_tool: (c) => ({ file_id: c.files.a, start_seconds: "1", end_seconds: "3" }),
  transcribe_media_tool: (c) => ({ file_id: c.files.talk }),
  trim_clip_tool: (c) => ({ clip_id: c.clips.a, edge: "right", at_seconds: "5" }),
  trim_clips_tool: (c) => ({ timeline_clip_ids: [c.clips.a], trim_start_seconds: 0.5 }),
  update_effect_tool: (c) => ({ effect_id: c.effectId, properties: { sigma: 6 } }),
  update_marker_tool: () => ({ marker: "Sweep marker", name: "Renamed marker" }),
  update_project_files_tool: (c) => ({ file_ids: [c.files.b], name: "Sweep bars", add_tags: ["b-roll"], rename_clips: true }),
  update_track_tool: () => ({ track: "2", name: "Stills" }),
  // The fade-in at the still's start keeps that edge.
  update_transition_tool: (c) => ({ transition_ids: [c.transitions[0]], duration_seconds: 1.5, contrast: 6, audio_crossfade: true }),
  wait_until_project_indexed_tool: () => ({ timeout_seconds: 5 }),
  watch_clip_window_tool: (c) => ({ timeline_clip_id: c.clips.a, start: "0", end: "2" }),
};

/** A project without speech recognition results kept on its files: keeping one is not an edit. */
function withoutTranscripts(project: unknown): unknown {
  const copy = structuredClone(project) as { files?: { ai_metadata?: Record<string, unknown> }[] };
  for (const file of copy.files ?? []) {
    if (!file.ai_metadata || !("asr" in file.ai_metadata)) continue;
    delete file.ai_metadata.asr;
    if (Object.keys(file.ai_metadata).length === 0) delete file.ai_metadata;
  }
  return copy;
}

function classify(result: CallResult | undefined, thrown: string): Outcome {
  if (thrown) return "crash";
  const text = textOf(result);
  if (CRASH.test(text) && (result?.isError || /"status":\s*"error"/.test(text))) return "crash";
  if (result?.isError || /^Error:/.test(text) || /"status":\s*"(refused|error)"/.test(text)) return "refused";
  return "ok";
}

function textOf(result: CallResult | undefined): string {
  return (result?.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function report(rows: Row[]): string {
  const order: Outcome[] = ["broken", "dirty", "crash", "noop", "refused", "ok"];
  const lines = ["| Outcome | Tool | ms | Changed | Arguments | Answer |", "|---|---|---|---|---|---|"];
  for (const outcome of order) {
    for (const r of rows.filter((x) => x.outcome === outcome)) {
      const cell = (s: string) => oneLine(s).replace(/\|/g, "\\|").slice(0, 220);
      lines.push(`| ${r.outcome}${r.ms > SLOW_MS ? " (slow)" : ""} | \`${r.tool}\` | ${r.ms} | ${r.changed ? "yes" : ""} | ${cell(JSON.stringify(r.args))} | ${cell(r.answer)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
