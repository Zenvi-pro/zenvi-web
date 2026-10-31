/**
 * Tools only the remote MCP server has: they manage cloud projects, bring
 * media in, and run renders/previews in Zenvi Cloud. Editing tools come from
 * the engine catalog (mcp/engine.ts).
 *
 * Hints follow the hosts' review rules (remote-mcp-requirements.md §2.3):
 * every hint explicit; anything that persists data is not read-only; nothing
 * here deletes or overwrites, so nothing is destructive; URL import and AI
 * video reach the open internet.
 */

import { defaultExportEnd, finishGaps, finishLines } from "@zenvi/engine";
import { z } from "zod";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { addMediaFile } from "../projects/files.js";
import { displayName } from "../projects/model.js";
import { PROFILE_SHORTHANDS, PROJECT_FORMATS, PROJECT_FPS, profileFor, resolveProfile } from "../projects/profiles.js";
import { snapKlingDuration, t2vDims } from "../generation/service.js";
import { isAudioRenderFormat, PRESET_NAMES, PRESETS, type PresetName, RENDER_FORMATS } from "../render/options.js";
import type { RenderJobView } from "../render/service.js";
import { defineTool } from "./define.js";
import { cloudCapabilities } from "./host.js";
import { checkProjectId, editProject, resolveProjectId } from "./projects.js";
import type { McpCallContext, McpTool } from "./types.js";
import { EDITOR_META_KEY, editorWidgetToolMeta, type EditorSessionMeta } from "./editor-widget.js";
import { widgetToolMeta } from "./widget.js";

export const projectIdArg = z
  .string()
  .max(40)
  .optional()
  .describe("Cloud project id (c_…). Defaults to the project opened with open_project or create_project.");

export function editorLink(ctx: McpCallContext, projectId: string): string {
  return `${ctx.services.config.editorUrl}/p/${projectId}`;
}

function seconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const listProjects = defineTool({
  name: "list_projects",
  title: "List projects",
  description:
    "List the person's Zenvi Cloud video projects, most recently edited first, with their ids. Use this when you need a project id, or to find the project the person means before calling open_project.",
  input: z.object({ limit: z.number().int().min(1).max(100).optional().describe("How many projects to return (default 20).") }),
  output: z.object({
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        updated_at: z.string(),
        clips: z.number(),
        duration_seconds: z.number(),
        width: z.number(),
        height: z.number(),
        editor_url: z.string(),
      }),
    ),
    total: z.number(),
    current_project_id: z.string().nullable(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_READ,
  invoking: "Listing your projects…",
  invoked: "Listed projects",
  async run(ctx, input) {
    const all = await ctx.services.projects.list(ctx.principal.userId);
    const current = await ctx.services.sessions.current(ctx.principal.userId, ctx.connection);
    const projects = all.slice(0, input.limit ?? 20).map((p) => ({
      id: p.id,
      name: p.name,
      updated_at: p.updatedAt,
      clips: p.stats.clips,
      duration_seconds: p.stats.duration,
      width: p.stats.width,
      height: p.stats.height,
      editor_url: editorLink(ctx, p.id),
    }));
    const text =
      all.length === 0
        ? "No cloud projects yet. Create one with create_project."
        : `${all.length} project${all.length === 1 ? "" : "s"}${current ? ` (open: ${current})` : ""}:\n` +
          projects.map((p) => `- ${p.id} "${p.name}" — ${p.clips} clips, ${p.duration_seconds}s, updated ${p.updated_at}`).join("\n");
    return { text, data: { projects, total: all.length, current_project_id: current } };
  },
});

const createProject = defineTool({
  name: "create_project",
  title: "Create project",
  description:
    "Create a new, empty Zenvi Cloud video project and open it, so later editing tools act on it, and show it in the Zenvi editor in the chat. " +
    "Use this when the person wants to start a new video. " +
    `Pick the frame with profile: ${PROFILE_SHORTHANDS}. ` +
    "Choose it from where the video will be shown (vertical for Reels/TikTok/Shorts). Progressive profiles are used unless interlaced is asked for; " +
    "when nothing matches, the tool answers with the closest profiles instead of guessing. Alternatively give format + fps. Default: landscape 1080p 30 fps.",
  input: z.object({
    name: z.string().min(1).max(200).describe("Project name shown in Zenvi."),
    profile: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Profile name or shorthand, e.g. "vertical 1080p 30", "square", "4k 24", "FHD 1080p 25 fps". Use alone (not with format/fps).'),
    format: z.enum(PROJECT_FORMATS).optional().describe("Frame size (default landscape_1080p, 1920×1080) when no profile is given."),
    fps: z.literal(PROJECT_FPS).optional().describe("Frames per second with format (default 30)."),
  }),
  output: z.object({
    project_id: z.string(),
    name: z.string(),
    profile: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    editor_url: z.string(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  scope: SCOPE_WRITE,
  invoking: "Creating the project…",
  invoked: "Project created",
  meta: editorWidgetToolMeta(),
  async run(ctx, input) {
    if (input.profile !== undefined && (input.format !== undefined || input.fps !== undefined)) {
      throw new ApiError(
        400,
        "invalid_request",
        'Give either profile (it can include the frame rate, e.g. "vertical 1080p 60") or format + fps, not both.',
      );
    }
    const choice = input.profile !== undefined ? resolveProfile(input.profile) : profileFor(input.format ?? "landscape_1080p", input.fps ?? 30);
    if (!choice.ok) throw new ApiError(400, "unknown_profile", choice.message);
    const profile = choice.profile;
    const created = await ctx.services.projects.create(ctx.principal.userId, { name: input.name, profile });
    await ctx.services.sessions.set(ctx.principal.userId, ctx.connection, created.id);
    const data = {
      project_id: created.id,
      name: created.name,
      profile: profile.description,
      width: profile.width,
      height: profile.height,
      fps: seconds(profile.fps.num / profile.fps.den),
      editor_url: editorLink(ctx, created.id),
    };
    return {
      text: `Created "${created.name}" (${created.id}, ${profile.description}, ${profile.width}×${profile.height}) and opened it in the Zenvi editor in this chat. Import media with import_media_from_url or get_upload_link.`,
      data,
      meta: { [EDITOR_META_KEY]: await editorSession(ctx, created.id) },
    };
  },
});

const openProject = defineTool({
  name: "open_project",
  title: "Open project",
  description:
    "Open a cloud project so the editing tools act on it (it stays open for this connection), show it in the Zenvi editor in the chat, and return its overview: " +
    "size, length, tracks and media files. Use this after list_projects when the person names a project.",
  input: z.object({ project_id: z.string().min(1).max(40).describe("Project id from list_projects (c_…).") }),
  output: z.object({
    project_id: z.string(),
    name: z.string(),
    updated_at: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    duration_seconds: z.number(),
    clips: z.number(),
    tracks: z.number(),
    files: z.array(z.object({ id: z.string(), name: z.string(), media_type: z.string(), duration_seconds: z.number().optional() })),
    editor_url: z.string(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_READ,
  invoking: "Opening the project…",
  invoked: "Project opened",
  meta: editorWidgetToolMeta(),
  async run(ctx, input) {
    const projectId = await resolveProjectId(ctx, input.project_id);
    const { project, meta } = await ctx.services.projects.get(ctx.principal.userId, projectId);
    const files = project.files.slice(0, 100).map((file) => ({
      id: file.id,
      name: typeof file.name === "string" && file.name !== "" ? file.name : String(file.path ?? file.id).split(/[\\/]/).pop() ?? file.id,
      media_type: String(file.media_type ?? "video"),
      ...(typeof file.duration === "number" && file.media_type !== "image" ? { duration_seconds: seconds(file.duration) } : {}),
    }));
    const data = {
      project_id: projectId,
      name: meta.name,
      updated_at: meta.updatedAt,
      width: project.width,
      height: project.height,
      fps: seconds(project.fps.num / project.fps.den),
      duration_seconds: meta.stats.duration,
      clips: project.clips.length,
      tracks: Array.isArray(project.layers) ? project.layers.length : 0,
      files,
      editor_url: editorLink(ctx, projectId),
    };
    const fileLines = files.length === 0 ? "No media yet." : files.map((f) => `- ${f.id} ${f.media_type} "${f.name}"`).join("\n");
    return {
      text: `Opened "${meta.name}" (${projectId}) in the Zenvi editor in this chat: ${project.width}×${project.height} at ${data.fps} fps, ${data.clips} clips on ${data.tracks} tracks, ${data.duration_seconds}s long.\nMedia:\n${fileLines}`,
      data,
      meta: { [EDITOR_META_KEY]: await editorSession(ctx, projectId) },
    };
  },
});

/** Adds downloaded media to the project bin (shared by the URL and attachment imports). */
async function importInto(ctx: McpCallContext, projectIdInput: string | undefined, url: string, name: string | undefined) {
  const retryAfter = ctx.services.limiter.hit(`import:${ctx.principal.userId}`, { limit: 30, windowMs: 3_600_000 });
  if (retryAfter > 0) throw new ApiError(429, "rate_limited", `Too many imports; try again in ${Math.ceil(retryAfter / 60)} minutes.`);
  const projectId = await resolveProjectId(ctx, projectIdInput);
  const imported = await ctx.services.importer.importUrl(ctx.principal.userId, url, { filename: name, signal: ctx.signal });
  const edit = await editProject(ctx, projectId, async (doc) => {
    let result: ReturnType<typeof addMediaFile> | undefined;
    doc.transaction(`Import ${imported.name}`, (tx) => {
      result = addMediaFile(tx, imported);
    });
    if (!result) throw new Error("import transaction produced no file");
    return result;
  });
  const { file, added } = edit.value;
  const shownName = added ? imported.name : displayName(file);
  const data = {
    project_id: projectId,
    file_id: file.id,
    name: shownName,
    media_type: String(file.media_type),
    duration_seconds: seconds(Number(file.duration) || 0),
    width: Number(file.width) || 0,
    height: Number(file.height) || 0,
    size_bytes: imported.size,
    sha256: imported.sha256,
    already_in_project: !added,
  };
  return {
    text: added
      ? `Imported "${shownName}" as file ${file.id} (${data.media_type}, ${data.duration_seconds}s). Add it to the timeline with the clip tools.`
      : `That file is already in the project as "${shownName}" (file ${file.id}).`,
    data,
  };
}

const importedShape = z.object({
  project_id: z.string(),
  file_id: z.string(),
  name: z.string(),
  media_type: z.string(),
  duration_seconds: z.number(),
  width: z.number(),
  height: z.number(),
  size_bytes: z.number(),
  sha256: z.string(),
  already_in_project: z.boolean(),
});

const importMediaFromUrl = defineTool({
  name: "import_media_from_url",
  title: "Import media from a URL",
  description:
    "Download a video, audio or image file from a public https URL into Zenvi Cloud and add it to the open project's media bin (not the timeline). Use this when the person gives a direct link to a media file; for files on their computer use get_upload_link. Importing the same file again returns the existing entry.",
  input: z.object({
    url: z.string().min(1).max(4096).describe("Direct https link to the media file."),
    name: z.string().max(255).optional().describe("File name to show in the project (defaults to the name in the URL)."),
    project_id: projectIdArg,
  }),
  output: importedShape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  scope: SCOPE_WRITE,
  invoking: "Importing the file…",
  invoked: "File imported",
  run: (ctx, input) => importInto(ctx, input.project_id, input.url, input.name),
});

const importAttachedFile = defineTool({
  name: "import_attached_file",
  title: "Import an attached file",
  description:
    "Add a video, audio or image file the person attached in this chat to the open project's media bin (not the timeline). Use this when the person attaches media; the host passes the file automatically. Importing the same file again returns the existing entry.",
  input: z.object({
    file: z
      .object({
        download_url: z.string().min(1).max(8192),
        file_id: z.string().min(1).max(512),
        mime_type: z.string().max(200).optional(),
        file_name: z.string().max(255).optional(),
      })
      .describe("The attached file."),
    project_id: projectIdArg,
  }),
  output: importedShape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_WRITE,
  invoking: "Importing the attachment…",
  invoked: "Attachment imported",
  meta: { "openai/fileParams": ["file"] },
  run: (ctx, input) => importInto(ctx, input.project_id, input.file.download_url, input.file.file_name),
});

const getUploadLink = defineTool({
  name: "get_upload_link",
  title: "Get upload link",
  description:
    "Get a link to the Zenvi web editor where the person can drop files from their computer into the open project. Use this when the media is on the person's device rather than at a public URL; ask them to tell you when the upload is done.",
  input: z.object({ project_id: projectIdArg }),
  output: z.object({ project_id: z.string(), upload_url: z.string() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_READ,
  invoking: "Getting an upload link…",
  invoked: "Upload link ready",
  async run(ctx, input) {
    const projectId = await resolveProjectId(ctx, input.project_id);
    const url = `${editorLink(ctx, projectId)}?upload=1`;
    return { text: `Open ${url} to add files to the project (sign in with your Zenvi account).`, data: { project_id: projectId, upload_url: url } };
  },
});

/** How long the embedded editor's token lasts; the view asks for a new one (open_in_editor) when it runs out. */
const EMBED_TTL_SECONDS = 12 * 3600;

/** The embedded editor for `projectId`: a token for this project only, and where the view frames it. */
export async function editorSession(ctx: McpCallContext, projectId: string): Promise<EditorSessionMeta> {
  const principal = ctx.principal;
  const issued = await ctx.services.tokens.issueEmbed({
    userId: principal.userId,
    email: principal.email,
    projectId,
    clientName: principal.kind === "oauth" ? principal.clientName : principal.name,
    // The editor can do what the connection can: a read-only connection opens a read-only editor.
    scopes: [SCOPE_READ, SCOPE_WRITE].filter((scope) => principal.scopes.includes(scope)),
    familyId: principal.kind === "oauth" ? principal.familyId : undefined,
    parentPatId: principal.kind === "pat" ? principal.tokenId : undefined,
    ttlSeconds: EMBED_TTL_SECONDS,
  });
  return {
    url: `${ctx.origin}/editor/embed/${encodeURIComponent(projectId)}`,
    token: issued.token,
    expiresAt: issued.record.expiresAt ?? "",
    projectId,
    openUrl: editorLink(ctx, projectId),
  };
}

const openInEditor = defineTool({
  name: "open_in_editor",
  title: "Open in the Zenvi editor",
  description:
    "Show the project in the Zenvi editor right here in the chat, where the person can play it, scrub, trim, add titles, effects and transitions, and export. " +
    "open_project and create_project already show it, and it follows the edits you make with other tools live, so call this only when the person asks to see the editor again. " +
    "Also returns the link to the full editor on zenvi.pro.",
  input: z.object({
    project_id: projectIdArg,
    refresh: z
      .boolean()
      .optional()
      .describe("Set only by the editor view when it renews its access; it keeps the chat's open project as it is. Leave it out."),
  }),
  output: z.object({ project_id: z.string(), name: z.string(), url: z.string(), embedded: z.boolean() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_READ,
  invoking: "Opening the Zenvi editor…",
  invoked: "Zenvi editor open",
  meta: editorWidgetToolMeta(),
  async run(ctx, input) {
    // An editor card renewing its token (perhaps an older one, in a conversation reopened later) must not switch the
    // project the chat's other tools edit.
    const projectId = input.refresh && input.project_id ? await checkProjectId(ctx, input.project_id) : await resolveProjectId(ctx, input.project_id);
    const { meta } = await ctx.services.projects.get(ctx.principal.userId, projectId);
    const session = await editorSession(ctx, projectId);
    return {
      text: `Opened “${meta.name}” in the Zenvi editor in this chat; edits you make with other tools show up there live. Full editor: ${session.openUrl}`,
      data: { project_id: projectId, name: meta.name, url: session.openUrl, embedded: true },
      meta: { [EDITOR_META_KEY]: session },
    };
  },
});

const renderStatusShape = z.object({
  render_id: z.string(),
  project_id: z.string(),
  status: z.enum(["queued", "running", "done", "error"]),
  progress: z.number(),
  format: z.string(),
  width: z.number(),
  height: z.number(),
  url: z.string().optional(),
  url_expires_at: z.string().optional(),
  size_bytes: z.number().optional(),
  error: z.string().optional(),
  /** What the render leaves out (render_project only), e.g. sound past the last picture. */
  notes: z.array(z.string()).optional(),
});

function renderData(job: RenderJobView): z.infer<typeof renderStatusShape> {
  return {
    render_id: job.renderId,
    project_id: job.projectId,
    status: job.status,
    progress: Math.round(job.progress * 100) / 100,
    format: job.format,
    width: job.options.width,
    height: job.options.height,
    ...(job.url ? { url: job.url } : {}),
    ...(job.urlExpiresAt ? { url_expires_at: job.urlExpiresAt } : {}),
    ...(job.bytes !== undefined ? { size_bytes: job.bytes } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

/** The watch to suggest once a video render is done, where this server can watch (watch_render_tool by render_id). */
function watchHint(ctx: McpCallContext, job: RenderJobView): string {
  if (job.status !== "done" || isAudioRenderFormat(job.format) || job.format === "gif" || !cloudCapabilities(ctx.services).has("watch")) return "";
  return ` Then watch_render_tool ${JSON.stringify({ render_id: job.renderId })} once, so an editor watches it with sound and names what to fix.`;
}

function renderText(job: RenderJobView): string {
  switch (job.status) {
    case "queued":
      return `Render ${job.renderId} is queued. Call get_render_status with render_id "${job.renderId}" to follow it.`;
    case "running":
      return `Render ${job.renderId} is ${Math.round(job.progress * 100)}% done. Call get_render_status again in a little while.`;
    case "done":
      return `Render ${job.renderId} is ready (${job.format}, ${job.options.width}×${job.options.height}). Download: ${job.url} (link valid for 1 hour; call get_render_status again for a fresh one).`;
    case "error":
      return `Render ${job.renderId} failed: ${job.error ?? "unknown error"}`;
  }
}

const renderProject = defineTool({
  name: "render_project",
  title: "Render video",
  description:
    "Start rendering the open project to a video (or audio) file in Zenvi Cloud. Returns a render_id right away; renders take roughly as long as the video, so follow up with get_render_status, which returns the download link when it is done. Asking again for the same project state and settings returns the same render.",
  input: z.object({
    preset: z.enum(PRESET_NAMES as [string, ...string[]]).optional().describe("Output preset (default mp4 at the project's size). A resolution preset sets the short side: mp4-1080p is 1920×1080 landscape, 1080×1920 vertical, 1080×1080 square."),
    format: z.enum(RENDER_FORMATS).optional().describe("Container format; overrides the preset's."),
    height: z.number().int().min(16).max(4320).optional().describe("Output height in pixels; width follows the project's aspect ratio."),
    quality: z.enum(["low", "medium", "high", "lossless"]).optional(),
    start_seconds: z.number().min(0).optional().describe("Render only from this timeline time."),
    end_seconds: z.number().positive().optional().describe("Render only up to this timeline time. Default: the end of the last clip with a picture (sound past it is left out, and the answer says so)."),
    project_id: projectIdArg,
  }),
  output: renderStatusShape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_WRITE,
  invoking: "Starting the render…",
  invoked: "Render started",
  async run(ctx, input) {
    if (!ctx.services.renders.rendererAvailable) {
      throw new ApiError(503, "unavailable", "Cloud rendering is not available on this Zenvi Cloud build yet. Use open_in_editor and export from the editor.");
    }
    const projectId = await resolveProjectId(ctx, input.project_id);
    const range =
      input.start_seconds !== undefined || input.end_seconds !== undefined
        ? { start: input.start_seconds ?? 0, end: input.end_seconds ?? Number.MAX_SAFE_INTEGER }
        : undefined;
    const { project } = await ctx.services.projects.get(ctx.principal.userId, projectId);
    const format = input.format ?? PRESETS[(input.preset as PresetName | undefined) ?? "mp4"].format;
    // A start alone runs to where a whole render would end (the last picture, for video).
    if (range && range.end === Number.MAX_SAFE_INTEGER) range.end = defaultExportEnd(project, !isAudioRenderFormat(format)).end;
    if (range && range.end <= range.start) throw new ApiError(400, "invalid_request", "end_seconds must be after start_seconds.");
    const job = await ctx.services.renders.start(ctx.principal.userId, projectId, {
      preset: input.preset as (typeof PRESET_NAMES)[number] | undefined,
      options: {
        ...(input.format ? { format: input.format } : {}),
        ...(input.height ? { height: input.height } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        ...(range ? { range } : {}),
      },
    });
    const view = await ctx.services.renders.getById(ctx.principal.userId, job.renderId);
    const notes = job.notes.length > 0 ? ` ${job.notes.join(" ")}` : "";
    // What the director's finish still owes the edit (grade, transitions, sound design, master), with the calls: agents act on receipts.
    const gaps = isAudioRenderFormat(format) ? [] : finishGaps(project);
    const finish = gaps.length > 0 ? ` Not finished: ${gaps.map((g) => g.kind).join(", ")} missing. ${finishLines(gaps).join(" ")}` : "";
    return { text: `${renderText(view)}${watchHint(ctx, view)}${notes}${finish}`, data: { ...renderData(view), notes: job.notes } };
  },
});

const getRenderStatus = defineTool({
  name: "get_render_status",
  title: "Get render status",
  description:
    "Check a render started with render_project: queued, running (with progress), done (with a download link valid for one hour) or error. Waits up to wait_seconds for it to finish before answering.",
  input: z.object({
    render_id: z.string().min(1).max(40).describe("The render_id render_project returned."),
    wait_seconds: z.number().int().min(0).max(45).optional().describe("Wait up to this long for the render to finish (default 20)."),
  }),
  output: renderStatusShape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_READ,
  invoking: "Checking the render…",
  invoked: "Render status",
  meta: widgetToolMeta(),
  async run(ctx, input) {
    if (!/^r_[a-z0-9]{16}$/.test(input.render_id)) throw new ApiError(400, "invalid_request", "render_id looks like r_… (from render_project).");
    const job = await ctx.services.renders.waitFor(ctx.principal.userId, input.render_id, (input.wait_seconds ?? 20) * 1000, ctx.signal);
    return { text: `${renderText(job)}${watchHint(ctx, job)}`, data: renderData(job) };
  },
});

const previewFrame = defineTool({
  name: "preview_frame",
  title: "Preview a frame",
  description:
    "Render one frame of the open project at a timeline time and return it as an image (plus a link to it), so you can check framing, titles and effects. Use it to verify edits visually before rendering the whole video.",
  input: z.object({
    time_seconds: z.number().min(0).optional().describe("Timeline time of the frame, in seconds."),
    seconds: z.number().min(0).optional().describe("Same as time_seconds (the local Zenvi MCP server's name)."),
    width: z.number().int().min(64).max(1920).optional().describe("Image width in pixels (default: project width, at most 960)."),
    project_id: projectIdArg,
  }),
  output: z.object({ project_id: z.string(), time_seconds: z.number(), image_url: z.string(), url_expires_at: z.string() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_READ,
  invoking: "Rendering the frame…",
  invoked: "Frame ready",
  meta: widgetToolMeta(),
  async run(ctx, input) {
    const at = input.time_seconds ?? input.seconds;
    if (at === undefined) throw new ApiError(400, "invalid_request", "time_seconds is required: the timeline time of the frame, in seconds.");
    const projectId = await resolveProjectId(ctx, input.project_id);
    const loaded = await ctx.services.projects.get(ctx.principal.userId, projectId);
    const preview = await ctx.services.frames.preview({
      userId: ctx.principal.userId,
      projectId,
      project: loaded.project,
      revision: loaded.revision,
      seconds: at,
      width: input.width,
      signal: ctx.signal,
    });
    return {
      text: `Frame at ${seconds(at)}s of "${loaded.meta.name}". Image link (1 hour): ${preview.url}`,
      data: { project_id: projectId, time_seconds: seconds(at), image_url: preview.url, url_expires_at: preview.urlExpiresAt },
      images: [preview.image],
    };
  },
});

const generationStatusShape = z.object({
  generation_id: z.string(),
  project_id: z.string(),
  status: z.enum(["queued", "running", "done", "error"]),
  prompt: z.string(),
  duration_seconds: z.number(),
  file_id: z.string().optional(),
  clip_id: z.string().optional(),
  error: z.string().optional(),
});

function generationData(job: Awaited<ReturnType<McpCallContext["services"]["generations"]["getById"]>>): z.infer<typeof generationStatusShape> {
  return {
    generation_id: job.generationId,
    project_id: job.projectId,
    status: job.status,
    prompt: job.prompt,
    duration_seconds: job.durationSeconds,
    ...(job.fileId ? { file_id: job.fileId } : {}),
    ...(job.clipId ? { clip_id: job.clipId } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function generationText(job: Awaited<ReturnType<McpCallContext["services"]["generations"]["getById"]>>): string {
  switch (job.status) {
    case "queued":
      return `Video generation ${job.generationId} is queued. Call get_generation_status with generation_id "${job.generationId}".`;
    case "running":
      return `Video generation ${job.generationId} is running. Call get_generation_status again in a little while.`;
    case "done":
      return `Video generation ${job.generationId} is on the timeline (file_id=${job.fileId ?? "?"}, timeline_clip_id=${job.clipId ?? "?"}).`;
    case "error":
      return `Video generation ${job.generationId} failed: ${job.error ?? "unknown error"}`;
  }
}

const generateVideo = defineTool({
  name: "generate_video",
  title: "Generate video",
  description:
    "Start an AI video from a text prompt and add it to the open project's timeline when it is ready. Returns a generation_id immediately (this takes longer than one chat turn). Follow up with get_generation_status until status is done or error. Asking again with the same prompt on the same project state returns the same job. Needs the Zenvi account connected with Allow.",
  input: z.object({
    prompt: z.string().min(2).max(2000).describe("What the video should show."),
    duration_seconds: z.number().optional().describe("Length in seconds. 5 unless 8 or more is asked for, which becomes 10."),
    position_seconds: z.number().min(0).optional().describe("Timeline time to place the clip. Omit to put it at the end."),
    track: z.number().int().positive().optional().describe("Layer number from list_layers_tool. Omit for the bottom track."),
    project_id: projectIdArg,
  }),
  output: generationStatusShape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  scope: SCOPE_WRITE,
  invoking: "Starting video generation…",
  invoked: "Video generation started",
  async run(ctx, input) {
    const projectId = await resolveProjectId(ctx, input.project_id);
    const loaded = await ctx.services.projects.get(ctx.principal.userId, projectId);
    const [width, height] = t2vDims(loaded.project.width, loaded.project.height);
    const job = await ctx.services.generations.start(ctx.principal.userId, projectId, {
      prompt: input.prompt,
      durationSeconds: snapKlingDuration(input.duration_seconds),
      width,
      height,
      ...(input.position_seconds !== undefined ? { positionSeconds: input.position_seconds } : {}),
      ...(input.track !== undefined ? { layer: input.track } : {}),
    });
    return { text: generationText(job), data: generationData(job) };
  },
});

const getGenerationStatus = defineTool({
  name: "get_generation_status",
  title: "Get video generation status",
  description:
    "Check a video started with generate_video: queued, running, done (file_id and clip_id of the timeline clip) or error. Waits up to wait_seconds for it to finish before answering.",
  input: z.object({
    generation_id: z.string().min(1).max(40).describe("The generation_id generate_video returned."),
    wait_seconds: z.number().int().min(0).max(45).optional().describe("Wait up to this long for generation to finish (default 20)."),
  }),
  output: generationStatusShape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: SCOPE_READ,
  invoking: "Checking video generation…",
  invoked: "Video generation status",
  async run(ctx, input) {
    if (!/^g_[a-z0-9]{16}$/.test(input.generation_id)) {
      throw new ApiError(400, "invalid_request", "generation_id looks like g_… (from generate_video).");
    }
    const job = await ctx.services.generations.waitFor(ctx.principal.userId, input.generation_id, (input.wait_seconds ?? 20) * 1000, ctx.signal);
    return { text: generationText(job), data: generationData(job) };
  },
});

export function cloudTools(options: { backend?: boolean } = {}): McpTool[] {
  const tools = [listProjects, createProject, openProject, importMediaFromUrl, importAttachedFile, getUploadLink, openInEditor, renderProject, getRenderStatus, previewFrame];
  if (options.backend) tools.push(generateVideo, getGenerationStatus);
  return tools;
}

