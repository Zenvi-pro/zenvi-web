/**
 * Tools only the local MCP server has (on top of the engine catalog):
 * choosing the project file, rendering, previewing frames, showing the result
 * in the desktop app, and sharing through Zenvi Cloud.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { finishGaps, finishLines, readBrief, type ToolImage } from "@zenvi/engine";
import type { JsonSchemaObject } from "@zenvi/engine/tools";
import { applied, DIRECTOR_START, failed, refused, type ToolReceipt } from "@zenvi/engine/tools";
import { frameCaption, type RenderResult } from "@zenvi/render-node";
import { pushProject } from "../cloud/sync.js";
import { openInDesktop } from "../desktop/open.js";
import { CliError } from "../output.js";
import { isProjectPath } from "../project/select.js";
import type { CommandContext } from "../commands/context.js";
import { cloudClient, keepCloudRefs } from "../commands/account.js";
import { newProject } from "../commands/project.js";
import { exportOnDesktop, exportOptionsFrom, type RenderFlags } from "../commands/render.js";
import { parseTime } from "../commands/edit.js";
import { DIRECTOR_RECIPES } from "../hosts/director.gen.js";
import { guideText } from "../hosts/guides.js";
import { SOUND_PALETTES } from "../hosts/sound.gen.js";
import { VERSION } from "../version.js";
import type { McpState } from "./state.js";

export interface ExtraToolResult {
  receipt: ToolReceipt;
  images?: ToolImage[];
  /** Who ran it, reported as structuredContent.engine (default portable; null = not an edit of the project). */
  engine?: "portable" | "desktop" | null;
}

export interface ExtraCallContext {
  signal: AbortSignal;
  progress?: (progress: number, total: number, message: string) => void;
}

export interface ExtraTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint?: boolean };
  /** The tool checks argument names itself (forwarded desktop tools use the desktop's own schema). */
  checksOwnArguments?: boolean;
  /** Older names it still answers to, not listed. */
  aliases?: readonly string[];
  run(state: McpState, args: Record<string, unknown>, call: ExtraCallContext): Promise<ExtraToolResult>;
}

const str = (description: string) => ({ type: "string" as const, description });
const num = (description: string) => ({ type: "number" as const, description });
const bool = (description: string) => ({ type: "boolean" as const, description });

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
}

/** What a recipe read before any brief starts with. */
const BRIEF_FIRST =
  "This project has no brief yet. Step 0, before the first edit: compile the brief with the brief compiler below (inspect_media_bin_tool, one style, up to four techniques, the critique) and save it with save_brief_tool; then build it with the recipe after it.";

/** On an empty project, the plan: open_project_file is the one receipt every agent reads before its first edit. */
function startNotes(state: McpState): { notes?: string[] } {
  return state.session.doc.project.clips.length === 0 ? { notes: [DIRECTOR_START] } : {};
}

function projectSummary(state: McpState): Record<string, unknown> {
  const p = state.session.doc.project;
  return {
    project: state.session.file ?? null,
    profile: p.profile,
    width: p.width,
    height: p.height,
    fps: p.fps,
    files: p.files.length,
    clips: p.clips.length,
    tracks: p.layers.length,
  };
}

export function extraTools(ctx: CommandContext): ExtraTool[] {
  return [
    {
      name: "open_project_file",
      title: "Open or create a project file",
      description:
        "Choose the .zvn project this session edits. Opens it if it exists; otherwise creates a new empty project there (or saves your unsaved edits there). Every later edit autosaves to this file, with its undo history.",
      inputSchema: {
        type: "object",
        properties: {
          path: str("Project file, e.g. edits/trailer.zvn (relative to the working folder)."),
          create: bool("Create the file when it does not exist (default true)."),
          profile: str('Video profile for a new project, e.g. "HD 1080p 30 fps", or a social preset: "instagram_reel", "tiktok", "youtube_shorts" (1080x1920), "youtube" (1920x1080), "square_post" (1080x1080). Default "HD 720p 30 fps".'),
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async run(state, args) {
        const tool = "open_project_file";
        const raw = text(args.path);
        if (!raw) return { receipt: refused(tool, "path is required") };
        const file = path.resolve(ctx.cwd, isProjectPath(raw) ? raw : `${raw}.zvn`);
        if (existsSync(file)) {
          await state.switchTo(file);
          return { receipt: applied(tool, `Opened ${file}`, { data: projectSummary(state), ...startNotes(state) }, 0) };
        }
        if (args.create === false || args.create === "false") return { receipt: failed(tool, `${file} does not exist.`) };
        const keepEdits = !state.session.file && (state.session.doc.canUndo || state.session.doc.project.clips.length > 0 || state.session.doc.project.files.length > 0);
        const project = keepEdits ? state.session.doc.toJSON() : newProject(text(args.profile));
        await state.switchTo(file, project);
        return {
          receipt: applied(tool, keepEdits ? `Saved the unsaved project as ${file}` : `Created ${file}`, { data: { ...projectSummary(state), created: true }, ...startNotes(state) }, 0),
        };
      },
    },
    {
      name: "read_director_recipe",
      title: "Read a director recipe",
      description:
        "The motion director's recipe for a genre (structure in seconds, shot lengths, sound plan, the exact tool calls and the finish), the same text as the resource zenvi://director/<recipe> and the zenvi-motion-director skill's recipes/. " +
        "Read it before the first edit of a whole video. recipe=director gives the director's shared rules; sound_palette a sound designer palette (zenvi://sound/<palette>); styles the brief compiler (brief, step 0 of every edit), the styles index (index) or one style or technique by id (zenvi://styles/<id>). Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          recipe: { type: "string", enum: ["director", ...DIRECTOR_RECIPES.map((r) => r.genre)], description: "The genre's recipe, or director for the shared rules." },
          sound_palette: { type: "string", enum: SOUND_PALETTES.map((p) => p.genre), description: "Instead: a sound designer palette." },
          styles: { type: "string", description: "Instead: brief (the brief compiler), index (every style and technique, one line each) or a style or technique id from the index." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async run(state, args) {
        const tool = "read_director_recipe";
        const recipe = text(args.recipe);
        const palette = text(args.sound_palette);
        const styles = text(args.styles);
        if ([recipe, palette, styles].filter((v) => v !== undefined).length !== 1) return { receipt: refused(tool, "Error: give one of recipe, sound_palette or styles."), engine: null };
        if (styles !== undefined) {
          const uri = styles === "index" ? "zenvi://styles" : `zenvi://styles/${styles}`;
          const markdown = guideText(uri);
          if (!markdown) return { receipt: refused(tool, `Error: no style or technique ${styles}; styles=index lists them.`), engine: null };
          return { receipt: applied(tool, markdown, { data: { uri } }, 0), engine: null };
        }
        const uri = palette ? `zenvi://sound/${palette}` : recipe === "director" ? "zenvi://director" : `zenvi://director/${recipe}`;
        const markdown = guideText(uri);
        if (!markdown) return { receipt: refused(tool, `Error: no ${palette ? `sound palette ${palette}` : `recipe ${recipe}`}; recipes: director, ${DIRECTOR_RECIPES.map((r) => r.genre).join(", ")}.`), engine: null };
        // Bench sk0, first pass: agents went from the card straight to the recipe and never compiled
        // the brief. A genre recipe read before any brief is saved carries the brief compiler first.
        if (recipe !== undefined && recipe !== "director" && !readBrief(state.session.doc.project)) {
          return { receipt: applied(tool, `${BRIEF_FIRST}\n\n${guideText("zenvi://styles/brief")}\n\n--- Recipe (${uri}) ---\n\n${markdown}`, { data: { uri, brief: "zenvi://styles/brief" } }, 0), engine: null };
        }
        return { receipt: applied(tool, markdown, { data: { uri } }, 0), engine: null };
      },
    },
    {
      name: "render_video",
      title: "Render the timeline",
      description:
        "Render the project to a file: mp4 (default), webm, mov, mkv, gif, mp3, wav or png (frames). Returns the file path, size and duration. Render after the finish (unify_grade_tool, transitions, sound design, master_audio_tool last): the receipt lists what is still missing, with the calls; then review_render_tool on the file. review_edit_tool watches the cut before it.",
      inputSchema: {
        type: "object",
        properties: {
          output: str("Output file (default: <project name>.<format> next to the project)."),
          output_path: str("Same as output (the desktop export_video_tool name)."),
          format: { type: "string", enum: ["mp4", "webm", "mov", "mkv", "gif", "mp3", "wav", "png"], description: "Container format (default from the file name, else mp4)." },
          quality: { type: "string", enum: ["low", "medium", "high", "lossless"], description: "Default high." },
          width: num("Output width in pixels (height follows the project aspect)."),
          height: num("Output height in pixels."),
          fps: str("Frame rate, e.g. 30 or 30000/1001 (default: the project's)."),
          start: num("Render from this timeline time (seconds)."),
          end: num("Render up to this timeline time (seconds)."),
          overwrite: bool("Accepted for agents that ask: a render always replaces the file at its output path."),
          loudness: str("Normalise the mix on export: social (-14 LUFS, -1 dBTP), broadcast (-23), podcast (-16) or a LUFS number; two-pass loudnorm with a true-peak limiter. Use it when master_audio_tool says the peaks held the mix under its target. Default off."),
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async run(state, args, call) {
        const tool = "render_video";
        const desktop = await state.desktopExecutor();
        const requested = text(args.output) ?? text(args.output_path);
        const output = requested ? path.resolve(ctx.cwd, requested) : undefined;
        if (desktop) {
          const outcome = await exportOnDesktop(desktop, output);
          return { receipt: outcome.receipt ?? (outcome.ok ? applied(tool, outcome.text, {}, 0) : failed(tool, outcome.text)), engine: "desktop" };
        }
        const session = state.session;
        const flags: RenderFlags = {
          format: text(args.format),
          quality: text(args.quality),
          width: text(args.width),
          height: text(args.height),
          fps: text(args.fps),
          start: text(args.start),
          end: text(args.end),
          loudness: text(args.loudness),
        };
        let options;
        try {
          options = exportOptionsFrom(session.doc.project, output, flags);
        } catch (error) {
          return { receipt: refused(tool, (error as Error).message) };
        }
        const result = (await session.host.exporter!.export(session.doc.project, options, (f) => call.progress?.(f, 1, `Rendering ${Math.round(f * 100)}%`))) as RenderResult;
        const mb = (result.bytes ?? 0) / 1e6;
        const audioOnly = options.format === "mp3" || options.format === "wav";
        // What the director's finish still owes (grade, transitions, sound design, master), with the next calls: agents act on receipts.
        const gaps = audioOnly ? [] : finishGaps(session.doc.project);
        const notes = [
          ...(state.unreviewedCut() && !audioOnly ? ["This cut has not been reviewed since the last edit: review_edit_tool shows pacing, beat sync, holds and black frames in one image. Fix what it flags and render again."] : []),
          ...finishLines(gaps),
          ...(gaps.length > 0 ? ["Then render again and call review_render_tool on the file."] : []),
        ];
        return {
          receipt: applied(
            tool,
            `Rendered ${result.location} (${options.format}, ${options.width}x${options.height}, ${result.durationSeconds.toFixed(2)} s, ${mb.toFixed(1)} MB)` +
              (gaps.length > 0 ? `. Not finished: ${gaps.map((g) => g.kind).join(", ")} missing. The edit is not done until these run: make the calls in notes, then render once more (finishing, not polish)` : ""),
            {
              data: { ...result, format: options.format, width: options.width, height: options.height, ...(gaps.length > 0 ? { finish: gaps } : {}) },
              warnings: result.warnings,
              ...(notes.length > 0 ? { notes } : {}),
            },
            0,
          ),
        };
      },
    },
    {
      name: "preview_frame",
      title: "Look at a frame",
      description:
        "Render one composited timeline frame and return it as an image, so you can check one moment (positions, titles, transitions, effects) before rendering. grid=true adds the 0-1 coordinate grid (origin top-left). To judge the whole cut (pacing, cut rhythm against the music, flashes, black frames) call review_edit_tool once instead of previewing many frames.",
      inputSchema: {
        type: "object",
        properties: {
          seconds: num("Timeline time in seconds."),
          time_seconds: num("Same as seconds (Zenvi Cloud's name)."),
          width: num("Image width in pixels (default 768, max 1920)."),
          grid: bool("Draw a 0-1 coordinate grid and a frame caption (default false)."),
          format: { type: "string", enum: ["jpeg", "png"], description: "Default jpeg." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async run(state, args) {
        const tool = "preview_frame";
        let seconds: number;
        try {
          seconds = parseTime(String(args.seconds ?? args.time_seconds ?? "")) ?? NaN;
        } catch {
          seconds = NaN;
        }
        if (!Number.isFinite(seconds) || seconds < 0) return { receipt: refused(tool, "seconds must be a time ≥ 0") };
        const desktop = await state.desktopExecutor();
        if (desktop) {
          const outcome = await desktop.call("inspect_timeline_tool", { start: seconds, end: seconds, maxFrames: 1 });
          return { receipt: outcome.receipt ?? (outcome.ok ? applied(tool, outcome.text, {}, 0) : failed(tool, outcome.text)), images: outcome.images, engine: "desktop" };
        }
        const project = state.session.doc.project;
        const width = Math.max(64, Math.min(1920, Number(args.width) || 768));
        const format = args.format === "png" ? "png" : "jpeg";
        const fps = project.fps.num / project.fps.den;
        const frame = Math.floor(seconds * fps + 1e-9);
        const grid = args.grid === true || args.grid === "true";
        const image = await state.session.host.frames!.renderFrame(project, seconds, {
          width,
          format,
          overlay: grid ? { grid: true, caption: frameCaption(frame, seconds) } : undefined,
        });
        return {
          receipt: applied(tool, `Frame at ${seconds.toFixed(2)} s (frame ${frame})`, { data: { seconds, frame, width, format } }, 0),
          images: [image],
        };
      },
    },
    {
      name: "launch_editor",
      title: "Show the project in the Zenvi app",
      description:
        "Open the project in the Zenvi desktop app so the person can watch and fine-tune the edit (focuses it if it is already open). Later edits from this session go through the app while it has the project open.",
      inputSchema: {
        type: "object",
        properties: { path: str("Project file (default: this session's project).") },
        additionalProperties: false,
      },
      // Not read-only: it starts or focuses the desktop app and can switch its project.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      async run(state, args) {
        const tool = "launch_editor";
        const file = text(args.path) ? path.resolve(ctx.cwd, text(args.path)!) : state.session.file;
        if (!file) return { receipt: refused(tool, "This project has no file yet: call open_project_file first.") };
        try {
          const result = await openInDesktop({ config: ctx.config, project: file, deps: state.launcher, clientVersion: VERSION });
          return { receipt: applied(tool, result.summary, { data: { method: result.method, project: file } }, 0), engine: null };
        } catch (error) {
          return { receipt: failed(tool, error instanceof CliError && error.hint ? `${error.message} ${error.hint}` : (error as Error).message) };
        }
      },
    },
    {
      // The engine's mcp_health_tool (Zenvi up, motion runtime) and what the sign-in enables, in one tool:
      // the merge of #53 and #58 had listed both. `mcp_health` stays callable.
      name: "mcp_health_tool",
      aliases: ["mcp_health"],
      title: "Is Zenvi up, and what the current sign-in enables",
      description:
        "Check that Zenvi answers and can render Zenvi Motion blocks, and report who Zenvi is signed in as and which features that sign-in enables: local editing and rendering, Zenvi Cloud, AI image/video generation, AI voice (text to speech), speech recognition and media search; for each one that is off, how to turn it on. Call it before generating images, video or voice, or when one of those fails with a sign-in error. Read-only.",
      inputSchema: { type: "object", properties: { main_thread_timeout_seconds: num("Desktop app only: how long to wait for its editor to answer (default 5).") }, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      async run(state, args, call) {
        const tool = "mcp_health_tool";
        const desktop = await state.desktopExecutor();
        const engine = desktop
          ? await desktop.call(tool, args).then((outcome) => ({ ok: outcome.ok, summary: outcome.receipt?.summary ?? outcome.text, data: outcome.receipt?.data, warnings: outcome.receipt?.warnings ?? [] }))
          : await state.session.run(tool, args, call.signal).then(({ result }) => {
              const receipt = result.data as ToolReceipt | undefined;
              return { ok: result.ok, summary: receipt?.summary ?? result.text, data: receipt?.data, warnings: receipt?.warnings ?? [] };
            });
        const who = await ctx.auth.whoami();
        const features = await ctx.auth.features();
        const account = !who.loggedIn
          ? who.expired
            ? "Sign-in expired: run `zenvi login`."
            : "Not signed in."
          : `Signed in as ${who.email ?? who.userId ?? "an unnamed account"} (${who.kind === "pat" ? "personal token: Zenvi Cloud only" : "Zenvi account"}).`;
        const lines = features.map((f) => `- ${f.name}: ${f.enabled ? "on" : `off. ${f.fix}`}`);
        const summary = [engine.summary, account, ...lines].join("\n");
        const data = { ...(engine.data && typeof engine.data === "object" ? engine.data : {}), signedIn: who.loggedIn, kind: who.kind ?? null, features };
        return { receipt: engine.ok ? applied(tool, summary, { data, warnings: engine.warnings }, 0) : failed(tool, summary), engine: null };
      },
    },
    {
      name: "push_to_cloud",
      title: "Share through Zenvi Cloud",
      description:
        "Upload the project and its media to Zenvi Cloud and return a zenvi.pro web editor link the person can open anywhere. Needs `zenvi login`. Repeated pushes update the same cloud project.",
      inputSchema: {
        type: "object",
        properties: {
          name: str("Cloud project name (default: the file name)."),
          force: bool("Overwrite edits made in the cloud since the last push."),
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      async run(state, args) {
        const tool = "push_to_cloud";
        const file = state.session.file;
        if (!file) return { receipt: refused(tool, "This project has no file yet: call open_project_file first.") };
        if (!(await ctx.auth.cloudToken())) return { receipt: refused(tool, "Not signed in to Zenvi: run `zenvi login` in a terminal, then try again.") };
        const warnings: string[] = [];
        try {
          const result = await pushProject({
            config: ctx.config,
            client: cloudClient(ctx),
            projectFile: file,
            project: state.session.doc.toJSON(),
            name: text(args.name),
            force: args.force === true || args.force === "true",
            warn: (m) => warnings.push(m),
          });
          await keepCloudRefs(ctx, state.session, result.cloudRefs);
          return { receipt: applied(tool, `Pushed to Zenvi Cloud: ${result.editorUrl}`, { data: result, warnings }, 0) };
        } catch (error) {
          return { receipt: failed(tool, error instanceof CliError && error.hint ? `${error.message} ${error.hint}` : (error as Error).message, { warnings }) };
        }
      },
    },
  ];
}
