/**
 * create_reel: the one-shot path for chats (ChatGPT, Claude). From a short
 * ask to a finished short video in one tool call:
 *
 *   project   a new one in the reel's frame (vertical by default), or the
 *             open project when it has media and no edit yet
 *   footage   files attached in the chat, links, and stock clips for the
 *             searches the model writes (Pexels through the Zenvi backend),
 *             fetched three at a time, all added to the project in one edit
 *   music     a link or a stock search (Freesound through the backend)
 *   edit      the engine's build_reel_tool: cuts on the beat, moves, looks,
 *             flashes, hook title, end card, music bed
 *   editor    the Zenvi editor opens in the chat on the result
 *
 * Downloads stop at a deadline so the call fits a chat's tool budget: what
 * arrived in time is used, the rest is reported.
 */

import {
  isMotionStyleId,
  MOTION_STYLE_IDS,
  MOTION_STYLES,
  pickMusic,
  pickStockFile,
  pickStockVideo,
  REEL_STYLE_IDS,
  REEL_STYLES,
  type FreesoundSound,
  type MotionStyleId,
  type PexelsVideo,
  type Project,
  type ReelStyleId,
} from "@zenvi/engine";
import { z } from "zod";
import { SCOPE_WRITE } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { addMediaFile } from "../projects/files.js";
import { PROJECT_FORMATS, profileFor } from "../projects/profiles.js";
import type { ImportResult } from "../services/importer.js";
import { editorSession, projectIdArg } from "./cloud-tools.js";
import { defineTool } from "./define.js";
import { EDITOR_META_KEY, editorWidgetToolMeta } from "./editor-widget.js";
import { displayText, type EngineRegistry } from "./engine.js";
import { createCloudHost } from "./host.js";
import { editProject, resolveProjectId } from "./projects.js";
import type { McpTool } from "./types.js";

/** Stop waiting for downloads after this long, ms (a chat gives a tool call about a minute). */
const FETCH_DEADLINE_MS = 32_000;
const PARALLEL_FETCHES = 3;
const MAX_SOURCES = 10;

/**
 * How many stock clips to take per search: about one clip for every two
 * cuts the style makes in the reel's length (at its own tempo), so a fast
 * cut does not keep showing the same shot; at most three per search. A
 * motion style shows a fixed number of pictures (its cards, crops, steps).
 */
export function stockClipsPerQuery(style: ReelStyleId | MotionStyleId, seconds: number | undefined, queries: number): number {
  if (isMotionStyleId(style)) return Math.max(1, Math.min(3, Math.ceil(Math.min(MAX_SOURCES, MOTION_STYLES[style].media) / Math.max(1, queries))));
  const s = REEL_STYLES[style];
  const beats = (seconds ?? s.defaultSeconds) * (s.defaultBpm / 60);
  const pattern = [...s.pattern, ...(s.climax ?? s.pattern)];
  const shots = beats / (pattern.reduce((a, b) => a + b, 0) / pattern.length);
  const target = Math.min(MAX_SOURCES, Math.ceil(shots / 2));
  return Math.max(1, Math.min(3, Math.ceil(target / Math.max(1, queries))));
}

/**
 * Run `jobs` `limit` at a time, writing each outcome into `results` as it
 * settles (so whatever finished is usable even if the caller stops waiting).
 */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number, results: (PromiseSettledResult<T> | undefined)[]): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await jobs[index]!() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function titleFrom(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}…`;
}

const attachedFile = z.object({
  download_url: z.string().min(1).max(8192),
  file_id: z.string().min(1).max(512),
  mime_type: z.string().max(200).optional(),
  file_name: z.string().max(255).optional(),
});

/**
 * The tool's input. Built when the tool list is (after the engine registry
 * loaded): the bundled server initialises the engine's reel modules with the
 * tool catalog, so REEL_STYLE_IDS is not ready while this module evaluates.
 */
const inputSchema = () => z.object({
  prompt: z.string().min(1).max(1000).describe("The person's ask, in their words. It names the project."),
  name: z.string().min(1).max(200).optional().describe("Project name (default: from the prompt)."),
  style: z
    .enum([...REEL_STYLE_IDS, ...MOTION_STYLE_IDS])
    .optional()
    .describe(
      "Footage-led: hype (fast cuts, flashes: launches, sport, travel), cinematic (moody, filmic), highlight (the person's own clips, building to the big moment), " +
        "match_cut (shapes that line up, one cut per beat), minimal (calm, long holds), editorial (graphic, labels), retro (VHS). " +
        "Motion-designed (graphics laid out and animated on the beat, the footage inside them): ui_promo (app or tool promo: a search types the hook, footage in UI cards, a pointer clicks, a scrolling word list, a logo card), " +
        "editorial_motion (specimen-sheet type with image tiles, labelled crop boxes over a shot), product_callout (a product on a dark field with leader lines out to its features), " +
        "tutorial (how-to steps: footage in cards with numbered captions and arrows, ending on 'Save this'). Default hype.",
    ),
  format: z.enum(PROJECT_FORMATS).optional().describe("Frame (default vertical_1080p for Reels, TikTok and Shorts)."),
  duration_seconds: z.number().min(5).max(60).optional().describe("Target length, seconds (default per style, 12-20)."),
  files: z.array(attachedFile).max(MAX_SOURCES).optional().describe("Video, image or audio files the person attached, in story order."),
  media_urls: z.array(z.string().min(1).max(4096)).max(MAX_SOURCES).optional().describe("Direct https links to media files, in story order."),
  stock_queries: z
    .array(z.string().min(2).max(80))
    .max(8)
    .optional()
    .describe("When the person gave no footage: 4-8 concrete visual searches for stock clips, in story order (e.g. 'barista pouring latte art close up')."),
  music_query: z.string().min(2).max(100).optional().describe("Stock music search: mood, genre, tempo (e.g. 'upbeat electronic 120 bpm'). Default: from the style."),
  music_url: z.string().min(1).max(4096).optional().describe("Direct https link to the music to use instead of a search."),
  no_music: z.boolean().optional().describe("Make it without music (cuts follow the style's tempo)."),
  labels: z
    .array(z.string().max(40))
    .max(MAX_SOURCES)
    .optional()
    .describe(
      "Small labels on the shots (editorial style), card captions (ui_promo), crop labels (editorial_motion) or step captions (tutorial): one per attached file / link / stock search, in the same story order (\"\" for none).",
    ),
  words: z
    .array(z.string().min(1).max(48))
    .max(12)
    .optional()
    .describe("Motion styles only: the scrolling word list (ui_promo), kinetic words (editorial_motion), the product's features as 'Name: value' (product_callout), each step's label box (tutorial)."),
  hook: z.string().max(80).optional().describe("Opening title, 2-6 punchy words."),
  end_card: z.string().max(80).optional().describe("Closing title: a call to action, a name, a date."),
  end_card_subtitle: z.string().max(80).optional(),
  project_id: projectIdArg.describe("Build into this project instead of a new one: its media plus anything above (its timeline must be empty)."),
});

const output = z.object({
  project_id: z.string(),
  name: z.string(),
  url: z.string(),
  duration_seconds: z.number(),
  shots: z.number(),
  /** Motion styles: how many scenes. */
  scenes: z.number().optional(),
  bpm: z.number(),
  brief: z.object({ format: z.string(), story: z.string(), pace: z.string(), look: z.string() }),
  music: z.object({ name: z.string(), credit: z.string(), license: z.string(), source: z.string() }).optional(),
  footage: z.array(z.object({ name: z.string(), credit: z.string(), source: z.string() })),
  warnings: z.array(z.string()),
});

const DEFAULT_MUSIC: Record<string, string> = {
  hype: "energetic electronic beat",
  cinematic: "cinematic ambient build",
  highlight: "upbeat sport rock",
  match_cut: "lofi hip hop beat",
  minimal: "calm acoustic ambient",
  editorial: "minimal electronic groove",
  retro: "retro synthwave",
  ui_promo: "upbeat modern tech pop",
  editorial_motion: "minimal electronic beat",
  product_callout: "dark electronic pulse",
  tutorial: "lofi chill beat",
};

interface Fetched {
  imported: ImportResult;
  role: "visual" | "music";
  credit?: { name: string; credit: string; license?: string; source: string };
  /** Which attached file / link / stock search this came from (story order), for its label. */
  source?: number;
}

export interface ReelToolOptions {
  /** How long to wait for downloads, ms (default FETCH_DEADLINE_MS). */
  fetchDeadlineMs?: number;
}

export function reelTools(registry: EngineRegistry, backendEnabled: boolean, options: ReelToolOptions = {}): McpTool[] {
  const fetchDeadlineMs = options.fetchDeadlineMs ?? FETCH_DEADLINE_MS;
  return [
    defineTool({
      name: "create_reel",
      title: "Create a reel",
      description:
        "Make a finished short video (Reels, TikTok, Shorts, ads, highlight reels) from a short ask, in one step, and open it in the Zenvi editor here. " +
        "Uses the files the person attached and links they gave; without footage, give stock_queries (concrete visual searches, story order). " +
        "Music comes from music_url or a stock search (music_query). The reel is cut on the music's beats in a style, with a hook title and an end card. " +
        "Answer with the brief it returns (format, story, pace, look). Then keep editing with the other tools; the editor follows live.",
      input: inputSchema(),
      output,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      scope: SCOPE_WRITE,
      invoking: "Making the reel…",
      invoked: "Reel ready",
      meta: { ...editorWidgetToolMeta(), "openai/fileParams": ["files"] },
      async run(ctx, args) {
        const userId = ctx.principal.userId;
        const retryAfter = ctx.services.limiter.hit(`reel:${userId}`, { limit: 20, windowMs: 3_600_000 });
        if (retryAfter > 0) throw new ApiError(429, "rate_limited", `Too many reels this hour; try again in ${Math.ceil(retryAfter / 60)} minutes.`);
        const warnings: string[] = [];
        const wantsStock = (args.stock_queries?.length ?? 0) > 0;
        const wantsStockMusic = !args.no_music && !args.music_url;
        if ((wantsStock || wantsStockMusic) && !backendEnabled) {
          warnings.push("Stock search needs the Zenvi backend, which this server is not connected to.");
        }

        // The project: the open one (media, no edit yet) or a new one in the reel's frame.
        let projectId: string;
        let project: Project;
        if (args.project_id) {
          projectId = await resolveProjectId(ctx, args.project_id);
          project = (await ctx.services.projects.get(userId, projectId)).project;
          if (project.clips.length > 0) {
            throw new ApiError(409, "has_edit", "That project already has an edit on its timeline. Create the reel as a new project (leave project_id out).");
          }
        } else {
          const choice = profileFor(args.format ?? "vertical_1080p", 30);
          if (!choice.ok) throw new ApiError(400, "unknown_profile", choice.message);
          const created = await ctx.services.projects.create(userId, { name: args.name ?? titleFrom(args.prompt), profile: choice.profile });
          await ctx.services.sessions.set(userId, ctx.connection, created.id);
          projectId = created.id;
          project = (await ctx.services.projects.get(userId, projectId)).project;
        }
        const portrait = Number(project.height) > Number(project.width);
        const frameWidth = Math.min(Number(project.width) || 1920, Number(project.height) || 1080);

        // Everything to fetch, in story order; stock picks are resolved first (searches are quick).
        // Downloads past the deadline are aborted (what arrived is used).
        const downloads = new AbortController();
        const stopDownloads = () => downloads.abort();
        ctx.signal.addEventListener("abort", stopDownloads, { once: true });
        const jobs: { label: string; run: () => Promise<Fetched> }[] = [];
        const fetch = (url: string, filename: string | undefined, role: Fetched["role"], credit?: Fetched["credit"], source?: number) => async (): Promise<Fetched> => ({
          imported: await ctx.services.importer.importUrl(userId, url, { filename, signal: downloads.signal }),
          role,
          credit,
          source,
        });
        let sourceIndex = 0;
        for (const file of args.files ?? []) jobs.push({ label: file.file_name ?? "attached file", run: fetch(file.download_url, file.file_name, "visual", undefined, sourceIndex++) });
        for (const url of args.media_urls ?? []) jobs.push({ label: url, run: fetch(url, undefined, "visual", undefined, sourceIndex++) });
        if (wantsStock && backendEnabled) {
          const used = new Set<number>();
          const queries = args.stock_queries!;
          const perQuery = stockClipsPerQuery(args.style ?? "hype", args.duration_seconds, queries.length);
          const picked: { query: string; clips: { video: PexelsVideo; link: string }[] }[] = [];
          const searches = await Promise.allSettled(
            args.stock_queries!.map((query) =>
              ctx.services.backendSessions.request<{ videos?: PexelsVideo[]; error?: string }>(userId, `/api/v1/pexels/search?query=${encodeURIComponent(query)}&per_page=15`, { signal: ctx.signal }),
            ),
          );
          searches.forEach((result, i) => {
            const query = queries[i]!;
            if (result.status === "rejected" || result.value.error) {
              warnings.push(`Stock search "${query}" failed: ${result.status === "rejected" ? message(result.reason) : result.value.error}`);
              return;
            }
            const clips: { video: PexelsVideo; link: string }[] = [];
            for (let n = 0; n < perQuery; n += 1) {
              const video = pickStockVideo(result.value.videos ?? [], portrait, used);
              const link = video ? pickStockFile(video, frameWidth, portrait)?.link : undefined;
              if (!video || !link) break;
              used.add(video.id);
              clips.push({ video, link });
            }
            if (clips.length === 0) warnings.push(`No stock clip found for "${query}".`);
            else picked.push({ query, clips });
          });
          // Within the cap, drop second clips from the middle of the story first (never the opening or the payoff).
          let total = picked.reduce((n, p) => n + p.clips.length, 0) + jobs.length;
          for (let step = 0, i = Math.floor(picked.length / 2); total > MAX_SOURCES && step < picked.length * 3; step += 1) {
            const entry = picked[(i + step) % picked.length]!;
            if (entry.clips.length > 1) {
              entry.clips.pop();
              total -= 1;
            }
          }
          const firstStock = sourceIndex;
          for (const { query, clips } of picked) {
            const source = firstStock + queries.indexOf(query);
            clips.forEach(({ video, link }, n) => {
              // Named by what it shows (the brief's story reads these names).
              const name = `${query.replace(/[^\w ]+/g, "").trim().replace(/\s+/g, " ").slice(0, 60) || "stock clip"}${n > 0 ? ` ${n + 1}` : ""}.mp4`;
              jobs.push({
                label: n > 0 ? `${query} (${n + 1})` : query,
                run: fetch(link, name, "visual", { name: query, credit: video.user_name ? `${video.user_name} on Pexels` : "Pexels", source: video.url ?? `https://www.pexels.com/video/${video.id}/` }, source),
              });
            });
          }
        }
        // Music first: the cut follows its beats, so it should never be the file that misses the deadline.
        const musicJobs: typeof jobs = [];
        if (!args.no_music) {
          if (args.music_url) {
            musicJobs.push({ label: "music", run: fetch(args.music_url, undefined, "music") });
          } else if (backendEnabled) {
            const query = args.music_query ?? DEFAULT_MUSIC[args.style ?? "hype"]!;
            try {
              const found = await ctx.services.backendSessions.request<{ sounds?: FreesoundSound[]; error?: string }>(
                userId,
                `/api/v1/freesound/search?query=${encodeURIComponent(query)}&page_size=20&min_duration=${Math.max(20, (args.duration_seconds ?? 15) + 4)}`,
                { signal: ctx.signal },
              );
              const sound = found.error ? undefined : pickMusic(found.sounds ?? [], args.duration_seconds ?? 15);
              const preview = sound?.previews?.hq_mp3 || sound?.previews?.lq_mp3;
              if (sound && preview) {
                const name = `${sound.name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 40) || "music"}.mp3`;
                musicJobs.push({
                  label: "music",
                  run: fetch(preview, name, "music", { name: sound.name, credit: sound.username ? `${sound.username} on Freesound` : "Freesound", license: sound.license ?? "", source: `https://freesound.org/s/${sound.id}/` }),
                });
              } else {
                warnings.push(`No stock music found for "${query}"${found.error ? ` (${found.error})` : ""}.`);
              }
            } catch (error) {
              warnings.push(`Stock music search failed: ${message(error)}`);
            }
          }
        }
        if (jobs.length > MAX_SOURCES) jobs.splice(MAX_SOURCES);
        jobs.unshift(...musicJobs);

        // Fetch three at a time; stop waiting at the deadline and use what arrived.
        const results: (PromiseSettledResult<Fetched> | undefined)[] = new Array(jobs.length);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finished = await Promise.race([
          pool(jobs.map((j) => j.run), PARALLEL_FETCHES, results).then(() => true),
          new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), fetchDeadlineMs))),
        ]);
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", stopDownloads);
        if (!finished) {
          downloads.abort();
          warnings.push("Some downloads were still running at the time limit; the reel uses what arrived.");
        }
        const fetched: Fetched[] = [];
        // An index loop: a download still running left a hole that forEach would skip.
        for (let i = 0; i < jobs.length; i += 1) {
          const r = results[i];
          if (r?.status === "fulfilled") fetched.push(r.value);
          else warnings.push(`Could not fetch ${jobs[i]!.label}: ${r ? message(r.reason) : "still downloading at the time limit"}`);
        }

        // Add the media in one edit, then cut the reel in another (two undo steps: media, edit).
        const added = await editProject(ctx, projectId, async (doc) => {
          const ids: { id: string; role: Fetched["role"]; isAudio: boolean; source?: number }[] = [];
          if (fetched.length === 0) return ids;
          doc.transaction("Import reel media", (tx) => {
            for (const item of fetched) {
              const { file } = addMediaFile(tx, item.imported);
              ids.push({ id: String(file.id), role: item.role, isAudio: !file.has_video && Boolean(file.has_audio), source: item.source });
            }
          });
          return ids;
        });
        const existing = args.project_id ? project.files.filter((f) => f.has_video || /image/i.test(String(f.media_type))).map((f) => String(f.id)) : [];
        const fresh = added.value.filter((m) => !m.isAudio);
        const visualIds = [...existing, ...fresh.map((m) => m.id)];
        // Labels follow the sources (files, links, searches) in story order; a search's extra clips share its label.
        const labelFor = new Map<string, string>();
        fresh.forEach((m) => {
          const label = m.source !== undefined ? args.labels?.[m.source] : undefined;
          if (label?.trim()) labelFor.set(m.id, label.trim());
        });
        const musicId = added.value.find((m) => m.role === "music" && m.isAudio)?.id ?? added.value.find((m) => m.isAudio)?.id;
        if (visualIds.length === 0) {
          throw new ApiError(422, "no_footage", `No footage to cut. Attach clips, give links, or pass stock_queries. ${warnings.join(" ")}`.trim());
        }

        const built = await editProject(ctx, projectId, async (doc) => {
          const { host, dispose } = createCloudHost(ctx, projectId, () => doc.project);
          try {
            return await registry.run({ doc, host, signal: ctx.signal }, "build_reel_tool", {
              style: args.style ?? "hype",
              file_ids: [...new Set(visualIds)],
              ...(musicId ? { music_file_id: musicId } : {}),
              ...(args.duration_seconds ? { duration_seconds: args.duration_seconds } : {}),
              ...(labelFor.size > 0 ? { labels: [...new Set(visualIds)].map((id) => labelFor.get(id) ?? "") } : {}),
              ...(args.hook ? { hook: args.hook } : {}),
              ...(args.end_card ? { end_card: args.end_card } : {}),
              ...(args.end_card_subtitle ? { end_card_subtitle: args.end_card_subtitle } : {}),
              ...(args.words ? { words: args.words } : {}),
            });
          } finally {
            await dispose();
          }
        });
        const result = built.value;
        if (!result.ok) throw new ApiError(422, "reel_failed", displayText(result));
        const receipt = result.data as { warnings?: string[]; data?: { duration: number; bpm: number; shots?: unknown[]; scenes?: unknown[]; brief: { format: string; story: string; pace: string; look: string } } };
        const reel = receipt.data!;
        warnings.push(...(receipt.warnings ?? []));

        const session = await editorSession(ctx, projectId);
        const meta = await ctx.services.projects.get(userId, projectId);
        const music = fetched.find((f) => f.role === "music")?.credit;
        const footage = fetched.filter((f) => f.role === "visual" && f.credit).map((f) => ({ name: f.credit!.name, credit: f.credit!.credit, source: f.credit!.source }));
        const brief = reel.brief;
        const text =
          `Here's the brief for your reel:\nFormat: ${brief.format}\nStory: ${brief.story}\nPace: ${brief.pace}\nLook: ${brief.look}\n` +
          `It is open in the Zenvi editor above (full editor: ${session.openUrl}).` +
          (music ? ` Music: "${music.name}" by ${music.credit}${music.license ? ` (${music.license})` : ""}.` : "") +
          (warnings.length > 0 ? `\nNotes: ${warnings.join(" ")}` : "");
        return {
          text,
          data: {
            project_id: projectId,
            name: meta.meta.name,
            url: session.openUrl,
            duration_seconds: reel.duration,
            shots: reel.shots?.length ?? reel.scenes?.length ?? 0,
            ...(reel.scenes ? { scenes: reel.scenes.length } : {}),
            bpm: Math.round(reel.bpm),
            brief,
            ...(music ? { music: { name: music.name, credit: music.credit, license: music.license ?? "", source: music.source } } : {}),
            footage,
            warnings,
          },
          meta: { [EDITOR_META_KEY]: session },
        };
      },
    }),
  ];
}
