/**
 * `WatchHost` on Node: a 640 px proxy of the render (ffmpeg, AAC 96 k), then
 * an editor's critique of it from the Zenvi backend's `POST /api/v1/watch`
 * as the signed-in person, or from Gemini directly when a developer key is
 * set (`ZENVI_GEMINI_API_KEY`; the bench and local development).
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COMPARE_PROMPT_VERSION,
  COMPARE_RESPONSE_SCHEMA,
  COMPARE_SYSTEM_PROMPT,
  compareUserText,
  normalizeComparison,
  normalizeCritique,
  WATCH_MAX_BYTES,
  WATCH_MAX_SECONDS,
  WATCH_PATH,
  WATCH_PROXY_EDGE,
  WATCH_RESPONSE_SCHEMA,
  WATCH_SYSTEM_PROMPT,
  WatchError,
  watchHttpError,
  watchUserText,
  type CompareRequest,
  type CompareVerdict,
  type WatchCritique,
  type WatchHost,
  type WatchRequest,
} from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { ffprobe } from "../probe/ffprobe.js";
import type { BackendHostOptions } from "./backend.js";
import { appendPreference } from "./preferences.js";

/** Gemini's inline request limit is 20 MB; base64 adds a third. */
const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_WATCH_MODEL = "gemini-3.8-flash";
/** Frames per second the model samples: 4 sees a 2-6 frame flash cut, at low resolution ~300 tokens/s. */
const WATCH_FPS = 4;

export interface WatchProxy {
  bytes: Uint8Array;
  duration: number;
  hasAudio: boolean;
}

/** Frames per second from ffprobe's "num/den", 0 when unknown. */
function frameRate(text: string | undefined): number {
  const [num, den = 1] = String(text ?? "").split("/").map(Number);
  return num && den ? num / den : 0;
}

/** The render as it is sent: long edge at most 640 px, at most 30 fps, H.264 + AAC 96 k, at most `maxBytes` (the backend's 25 MB). */
export async function makeWatchProxy(file: string, signal?: AbortSignal, maxBytes = WATCH_MAX_BYTES): Promise<WatchProxy> {
  let probe;
  try {
    probe = await ffprobe(file, signal);
  } catch (error) {
    throw new WatchError("rejected", `could not read ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const video = probe.streams.find((s) => s.codec_type === "video");
  if (!video) throw new WatchError("rejected", `${path.basename(file)} has no picture`);
  const duration = Number(probe.format.duration) || 0;
  if (duration > WATCH_MAX_SECONDS + 0.5) {
    throw new WatchError("too_long", `${path.basename(file)} is ${duration.toFixed(1)} s; watching takes at most ${WATCH_MAX_SECONDS} s`);
  }
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const dir = await mkdtemp(path.join(tmpdir(), "zenvi-watch-"));
  try {
    const out = path.join(dir, "proxy.mp4");
    const edge = WATCH_PROXY_EDGE;
    // An fps filter only above 30 (not -fpsmax, which ffmpeg before 4.4 lacks). The higher of the two
    // rates: an MP4 muxer without VFR falls back to r_frame_rate, which can be above a variable avg_frame_rate.
    const fps = Math.max(frameRate(video.avg_frame_rate), frameRate(video.r_frame_rate)) > 30.01 ? ",fps=30" : "";
    for (const crf of [30, 38]) {
      await runBinary(
        resolveBinary("ffmpeg"),
        [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
          "-i", file,
          "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []),
          "-vf", `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2${fps}`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p",
          ...(hasAudio ? ["-c:a", "aac", "-b:a", "96k", "-ac", "2"] : []),
          "-movflags", "+faststart",
          out,
        ],
        { signal, what: `Making the watch proxy of ${path.basename(file)} failed` },
      );
      if ((await stat(out)).size <= maxBytes) {
        return { bytes: new Uint8Array(await readFile(out)), duration, hasAudio };
      }
    }
    throw new WatchError("too_large", `the proxy of ${path.basename(file)} is still over ${Math.round(maxBytes / 1024 / 1024)} MB; render a shorter part`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A critique from the backend's answer (snake_case, already normalized there; normalized again here). */
export function critiqueFromBackend(body: unknown, proxy: WatchProxy): WatchCritique {
  const b = isRecord(body) ? body : {};
  const usage = isRecord(b.usage) ? b.usage : {};
  const duration = Number(b.duration) || proxy.duration;
  return {
    model: String(b.model ?? ""),
    duration,
    hasAudio: typeof b.has_audio === "boolean" ? b.has_audio : proxy.hasAudio,
    ...normalizeCritique(body, duration),
    usage: { inputTokens: Number(usage.input_tokens) || 0, outputTokens: Number(usage.output_tokens) || 0, credits: Number(usage.credits) || 0 },
    via: "backend",
  };
}

/** The multipart body of `POST /api/v1/watch` (zenvi-backend api/routes/watch.py). */
export function watchForm(proxy: WatchProxy, request: WatchRequest): FormData {
  const form = new FormData();
  form.append("video", new Blob([proxy.bytes], { type: "video/mp4" }), "render.mp4");
  if (request.brief) form.append("brief", request.brief);
  if (request.focus && request.focus.length > 0) form.append("focus", request.focus.join(","));
  if (request.timelineNotes) form.append("timeline_notes", request.timelineNotes);
  return form;
}

/** Watch a local render file: checks first (sign-in), then the proxy, then the critique. */
type Critic = (file: string, request: WatchRequest) => Promise<WatchCritique>;

/** `POST /api/v1/watch` as the signed-in person. Signed out: a sign-in WatchError before anything is sent. */
export function backendCritic(options: BackendHostOptions): Critic {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  return async (file, request) => {
    const blocked = await options.unavailable?.();
    if (blocked) throw new WatchError("sign_in", blocked);
    const token = await options.token?.();
    if (!token) throw new WatchError("sign_in", "watching a render needs a Zenvi sign-in: run `zenvi login`");
    const proxy = await makeWatchProxy(file, request.signal);
    const form = watchForm(proxy, request);
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
    if (options.userAgent) headers["User-Agent"] = options.userAgent;
    const timeout = AbortSignal.timeout(180_000);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await doFetch(`${base}${WATCH_PATH}`, { method: "POST", headers, body: form, signal });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      throw new WatchError("failed", `cannot reach the Zenvi backend at ${base}: ${(error as Error).message}`);
    }
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Plain-text body.
    }
    if (!response.ok) throw watchHttpError(response.status, parsed);
    return critiqueFromBackend(parsed, proxy);
  };
}

interface GeminiOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/** One `generateContent` call with schema-constrained JSON out: the parsed answer and the tokens it took. */
async function geminiJson(
  options: GeminiOptions,
  parts: unknown[],
  system: string,
  schema: unknown,
  what: string,
  signal: AbortSignal | undefined,
): Promise<{ raw: unknown; usage: { inputTokens: number; outputTokens: number } }> {
  const model = options.model || DEFAULT_WATCH_MODEL;
  const doFetch = options.fetchImpl ?? fetch;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: schema,
      mediaResolution: "MEDIA_RESOLUTION_LOW",
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
  const timeout = AbortSignal.timeout(180_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await doFetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WatchError("failed", `cannot reach Gemini: ${(error as Error).message}`);
  }
  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = isRecord(answer?.error) && typeof answer.error.message === "string" ? answer.error.message : response.statusText;
    throw new WatchError(response.status === 401 || response.status === 403 ? "unavailable" : "failed", `Gemini ${response.status}: ${message}`);
  }
  const candidate = Array.isArray(answer?.candidates) ? (answer.candidates[0] as Record<string, unknown> | undefined) : undefined;
  const content = isRecord(candidate?.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = content.map((p) => (isRecord(p) && typeof p.text === "string" && p.thought !== true ? p.text : "")).join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WatchError("failed", `Gemini returned no ${what}`);
  }
  const meta = isRecord(answer?.usageMetadata) ? answer.usageMetadata : {};
  return {
    raw,
    usage: {
      inputTokens: Number(meta.promptTokenCount) || 0,
      // Thinking bills as output.
      outputTokens: (Number(meta.candidatesTokenCount) || 0) + (Number(meta.thoughtsTokenCount) || 0),
    },
  };
}

const videoPart = (proxy: WatchProxy) => ({ inlineData: { mimeType: "video/mp4", data: Buffer.from(proxy.bytes).toString("base64") }, videoMetadata: { fps: WATCH_FPS } });

/** Gemini `generateContent` with the video inline: the developer path, same prompt and schema as the backend. */
export function geminiCritic(options: GeminiOptions): Critic {
  const model = options.model || DEFAULT_WATCH_MODEL;
  return async (file, request) => {
    // Over the inline limit the proxy is made again at the smaller quality before giving up.
    const proxy = await makeWatchProxy(file, request.signal, GEMINI_INLINE_MAX_BYTES);
    const { raw, usage } = await geminiJson(options, [videoPart(proxy), { text: watchUserText(proxy.duration, request) }], WATCH_SYSTEM_PROMPT, WATCH_RESPONSE_SCHEMA, "critique", request.signal);
    return { model, duration: proxy.duration, hasAudio: proxy.hasAudio, ...normalizeCritique(raw, proxy.duration), usage, via: "gemini" };
  };
}

/** Two local renders in one watch, `first` as A. */
export type Comparer = (first: string, second: string, request: CompareRequest) => Promise<CompareVerdict>;

/** Both videos inline in one request (each proxy within half the inline limit), labelled A and B, compared with the engine's prompt. */
export function geminiComparer(options: GeminiOptions & { log?: string; source?: string }): Comparer {
  const model = options.model || DEFAULT_WATCH_MODEL;
  return async (first, second, request) => {
    const half = Math.floor(GEMINI_INLINE_MAX_BYTES / 2);
    const a = await makeWatchProxy(first, request.signal, half);
    const b = await makeWatchProxy(second, request.signal, half);
    const durations = { A: a.duration, B: b.duration };
    const parts = [{ text: "=== Video A ===" }, videoPart(a), { text: "=== Video B ===" }, videoPart(b), { text: compareUserText(durations, request) }];
    const { raw, usage } = await geminiJson(options, parts, COMPARE_SYSTEM_PROMPT, COMPARE_RESPONSE_SCHEMA, "comparison", request.signal);
    const verdict: CompareVerdict = { model, durations, ...normalizeComparison(raw, durations), usage, via: "gemini" };
    if (options.log) {
      // Taste data must not cost the judgment: a log that cannot be written is skipped.
      await appendPreference(options.log, {
        source: options.source ?? "zenvi-cli",
        judge: model,
        prompt: COMPARE_PROMPT_VERSION,
        brief: request.brief,
        a: { path: first, seconds: a.duration },
        b: { path: second, seconds: b.duration },
        winner: verdict.winner === "A" ? "a" : verdict.winner === "B" ? "b" : "tie",
        scores: { a: verdict.scores.A, b: verdict.scores.B },
      }).catch(() => undefined);
    }
    return verdict;
  };
}

export interface NodeWatchOptions {
  env?: NodeJS.ProcessEnv;
  backend?: BackendHostOptions;
  /** A render path as the tool names it → the local file. */
  resolvePath: (p: string) => string;
  signal?: AbortSignal;
}

/**
 * The developer key wins when set (it is set on purpose, for the bench and
 * local work); otherwise the backend as the signed-in person. Neither: none.
 */
export function createNodeWatchHost(options: NodeWatchOptions): WatchHost | undefined {
  const env = options.env ?? process.env;
  const key = env.ZENVI_GEMINI_API_KEY?.trim();
  const model = env.ZENVI_GEMINI_WATCH_MODEL?.trim();
  const critic = key ? geminiCritic({ apiKey: key, model }) : options.backend ? backendCritic(options.backend) : undefined;
  if (!critic) return undefined;
  const host: WatchHost = {
    watch: (p, request = {}) => critic(options.resolvePath(p), { ...request, signal: request.signal ?? options.signal }),
    length: async (p, signal) => Number((await ffprobe(options.resolvePath(p), signal ?? options.signal)).format.duration) || 0,
  };
  // Side by side needs both videos in one request: the developer path only (the backend watches one file per call).
  if (key) {
    const comparer = geminiComparer({ apiKey: key, model, log: env.ZENVI_PREFERENCES_LOG?.trim() || undefined, source: env.ZENVI_PREFERENCES_SOURCE?.trim() || undefined });
    host.compare = (first, second, request = {}) => comparer(options.resolvePath(first), options.resolvePath(second), { ...request, signal: request.signal ?? options.signal });
  }
  return host;
}
