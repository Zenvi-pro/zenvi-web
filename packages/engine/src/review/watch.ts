/**
 * Watching a render with sound: an editor's critique of the finished file
 * (scores per dimension, 3-6 timestamped issues each with a fix), from a
 * model that sees the picture and hears the soundtrack.
 *
 * The host does the watching (`WatchHost`): the Zenvi backend's
 * `POST /api/v1/watch` as the signed-in person, or Gemini directly with a
 * developer key. Both answer in the shape below; the prompt and schema here
 * mirror zenvi-backend `core/watch/critique.py` so the two paths read alike.
 * This module also turns a critique into what an agent acts on: each issue
 * placed on the open timeline and paired with the tools that fix it.
 */

import type { ReviewShot, TimelineReview } from "./types.js";

export const WATCH_PATH = "/api/v1/watch";
/** The backend's limits (zenvi-backend `WATCH_MAX_SECONDS` / `WATCH_MAX_MB`). */
export const WATCH_MAX_SECONDS = 90;
export const WATCH_MAX_BYTES = 25 * 1024 * 1024;
/** Long edge of the proxy that is sent, pixels: the model watches at low resolution anyway. */
export const WATCH_PROXY_EDGE = 640;

export const WATCH_DIMENSIONS = {
  hook: "first 1-2 s: does something move, cut or hit before a thumb scrolls past",
  pacing: "shot lengths and rhythm; cuts on beats and transients; no dead air or sag",
  structure: "the piece builds: setup, escalation, payoff; every shot earns its place",
  motion: "polish of moves: easing, overshoot, motion blur, nothing linear or floaty",
  transitions: "cuts and transitions are motivated (match, whip, flash, mask) not dissolves by default",
  typography: "type is legible, sized for a phone, timed to speech, animated with intent",
  look: "grade and finish: consistent LUT, contrast, grain, no muddy or clipped shots",
  sound_design: "a whoosh, hit or click on cuts and UI events; risers into drops; no silent cuts",
  mix: "music ducks under voice, no clipping, loudness fit for social, nothing buried",
  ending: "a clean payoff or end card; it does not just stop or trail off",
} as const;

export type WatchDimension = keyof typeof WATCH_DIMENSIONS;
export const WATCH_DIMENSION_NAMES = Object.keys(WATCH_DIMENSIONS) as WatchDimension[];
export type WatchSeverity = "high" | "medium" | "low";
const SEVERITIES: readonly WatchSeverity[] = ["high", "medium", "low"];
const MIN_ISSUES = 3;
const MAX_ISSUES = 6;

export interface WatchIssue {
  /** Seconds from the start of the watched file. */
  start: number;
  end: number;
  dimension: WatchDimension | "other";
  severity: WatchSeverity;
  /** What the critic saw or heard. */
  problem: string;
  /** The edit it asks for. */
  fix: string;
}

export interface WatchCritique {
  model: string;
  /** Seconds watched. */
  duration: number;
  hasAudio: boolean;
  verdict: string;
  /** 1-10, null when the critic gave none and no dimension was scored. */
  overall: number | null;
  wouldPost: boolean;
  /** 1-10 per dimension; null when it does not apply (no text: typography). */
  scores: Record<WatchDimension, number | null>;
  issues: WatchIssue[];
  strengths: string[];
  usage: { inputTokens: number; outputTokens: number; credits?: number };
  /** Who watched: the Zenvi backend as the signed-in person, or Gemini with a developer key. */
  via: "backend" | "gemini";
}

export interface WatchRequest {
  /** What the edit was asked to be (the brief), so the critic judges against it. */
  brief?: string;
  /** Dimensions to weigh most (the sound designer asks for sound_design and mix). */
  focus?: readonly WatchDimension[];
  /** The timeline as text (`watchTimelineNotes`), so issues can name shots. */
  timelineNotes?: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type WatchErrorCode =
  /** This server or host has no watching (404/503, no key). */
  | "unavailable"
  /** Not signed in, or the sign-in is not one the backend accepts. */
  | "sign_in"
  | "credits"
  /** Over the length or size limit. */
  | "too_long"
  | "too_large"
  /** The file is not a video the server can read. */
  | "rejected"
  | "failed";

/** A watch that did not happen, with a message written for a person (no "Error:" prefix). */
export class WatchError extends Error {
  override readonly name = "WatchError";
  constructor(
    readonly code: WatchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const CODES: ReadonlySet<string> = new Set(["unavailable", "sign_in", "credits", "too_long", "too_large", "rejected", "failed"]);

/** True for a `WatchError`, also one from another copy of this module (bundles). */
export function isWatchError(error: unknown): error is WatchError {
  if (error instanceof WatchError) return true;
  if (!(error instanceof Error) || error.name !== "WatchError") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CODES.has(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{detail: {code, message}}` (zenvi-backend api/routes/watch.py), `{detail: "…"}` or plain text. */
function detailOf(body: unknown): { code: string; message: string } {
  if (typeof body === "string") return { code: "", message: body.replace(/\s+/g, " ").trim().slice(0, 300) };
  if (!isRecord(body)) return { code: "", message: "" };
  const detail = body.detail ?? body.message ?? body.error;
  if (typeof detail === "string") return { code: "", message: detail.trim() };
  if (isRecord(detail)) return { code: typeof detail.code === "string" ? detail.code : "", message: typeof detail.message === "string" ? detail.message.trim() : "" };
  return { code: "", message: "" };
}

const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** The error for a non-2xx answer of `POST /api/v1/watch`. */
export function watchHttpError(status: number, body: unknown): WatchError {
  const { code, message } = detailOf(body);
  if (status === 404) return new WatchError("unavailable", "watching a render is not available on this Zenvi server yet (it needs a newer Zenvi backend)");
  if (status === 503) return new WatchError("unavailable", `watching a render is not set up on this Zenvi server${message ? ` (${message.replace(/\.$/, "")})` : ""}`);
  if (status === 401 || status === 403) return new WatchError("sign_in", "watching a render needs a Zenvi sign-in; sign in to Zenvi and try again");
  if (status === 402) return new WatchError("credits", sentence(`not enough Zenvi credits to watch this render${message ? `: ${message}` : ""}`));
  if (status === 413) return new WatchError("too_large", sentence(message || "the render is over the server's 25 MB limit"));
  if (code === "video_too_long") return new WatchError("too_long", sentence(message));
  if (status === 415 || status === 422) return new WatchError("rejected", sentence(`the Zenvi server refused the video${message ? `: ${message}` : ""}`));
  return new WatchError("failed", sentence(`the watch failed (HTTP ${status})${message ? `: ${message}` : ""}`));
}

// ---------------------------------------------------------------------------
// Prompt and answer (the developer-key path; the backend has its own copy)
// ---------------------------------------------------------------------------

export const WATCH_SYSTEM_PROMPT =
  "You are a senior short-form video editor reviewing a cut before it is posted. " +
  "You watch the whole video and listen to the whole soundtrack. You are calibrated " +
  "and blunt: 1-3 is amateur or slideshow-like, 4-6 is competent but generic, 7-8 is " +
  "what a working pro would post, 9-10 is reference-grade. Most first cuts are 4-6. " +
  "Score each dimension 1-10, or null when it does not apply (no text on screen: " +
  "typography is null). Then list the issues that most hold the video back, worst " +
  "first. Each issue has the time it happens in seconds from the start of this file, " +
  "what you see or hear, and one concrete fix an editor can make on the timeline: " +
  "what to change, where, and by how much (e.g. 'trim shot 3 to 0.4 s so the cut lands " +
  "on the snare at 2.10 s', 'add a whoosh 80 ms before the whip at 4.2 s', 'duck the " +
  "music 8 dB under the voice from 6 s'). Never suggest reshooting; work with what is " +
  "on the timeline.";

/** Gemini `responseSchema` (OpenAPI subset). */
export const WATCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string" },
    overall: { type: "number" },
    would_post: { type: "boolean" },
    scores: {
      type: "object",
      properties: Object.fromEntries(WATCH_DIMENSION_NAMES.map((d) => [d, { type: "number", nullable: true }])),
      required: WATCH_DIMENSION_NAMES,
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          dimension: { type: "string", enum: [...WATCH_DIMENSION_NAMES, "other"] },
          severity: { type: "string", enum: SEVERITIES },
          problem: { type: "string" },
          fix: { type: "string" },
        },
        required: ["start", "end", "dimension", "severity", "problem", "fix"],
      },
    },
    strengths: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "overall", "would_post", "scores", "issues"],
} as const;

export function watchUserText(duration: number, request: Omit<WatchRequest, "signal"> = {}): string {
  const lines = [
    `This video is ${duration.toFixed(2)} seconds long. Every time in your JSON is in ` +
      `seconds from 0.0 to ${duration.toFixed(2)}; no minutes, frames or fractions of the length.`,
    "Dimensions:",
    ...WATCH_DIMENSION_NAMES.map((d) => `- ${d}: ${WATCH_DIMENSIONS[d]}`),
    `Give ${MIN_ISSUES}-${MAX_ISSUES} issues and 1-3 strengths.`,
  ];
  if (request.focus && request.focus.length > 0) lines.push(`Weigh these dimensions most and put their issues first: ${request.focus.join(", ")}.`);
  if (request.brief) lines.push(`What the editor was asked to make: ${request.brief}`);
  if (request.timelineNotes) lines.push(`The editor's timeline, for mapping your times to what is on it (trust what you see and hear over this):\n${request.timelineNotes}`);
  return lines.join("\n");
}

const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;

function score(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? round(Math.min(Math.max(n, 1), 10), 1) : null;
}

function clampTime(value: unknown, duration: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? round(Math.min(Math.max(n, 0), duration), 2) : 0;
}

/**
 * A critique from a model's or the backend's JSON (snake_case): scores and
 * times clamped, at most six issues, worst first. Mirrors
 * zenvi-backend `normalize_critique`.
 */
export function normalizeCritique(raw: unknown, duration: number): Omit<WatchCritique, "model" | "duration" | "hasAudio" | "usage" | "via"> {
  const r = isRecord(raw) ? raw : {};
  const rawScores = isRecord(r.scores) ? r.scores : {};
  const scores = Object.fromEntries(WATCH_DIMENSION_NAMES.map((d) => [d, score(rawScores[d])])) as Record<WatchDimension, number | null>;
  const issues: WatchIssue[] = [];
  for (const item of Array.isArray(r.issues) ? r.issues : []) {
    if (!isRecord(item)) continue;
    const problem = String(item.problem ?? "").trim();
    const fix = String(item.fix ?? "").trim();
    if (!problem || !fix) continue;
    const start = clampTime(item.start, duration);
    const dim = String(item.dimension ?? "").trim().toLowerCase();
    const sev = String(item.severity ?? "").trim().toLowerCase();
    issues.push({
      start,
      end: Math.max(start, clampTime(item.end ?? start, duration)),
      dimension: dim in WATCH_DIMENSIONS ? (dim as WatchDimension) : "other",
      severity: (SEVERITIES as readonly string[]).includes(sev) ? (sev as WatchSeverity) : "medium",
      problem,
      fix,
    });
  }
  // Stable sort: the critic's own order breaks ties inside a severity.
  issues.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const scored = Object.values(scores).filter((s): s is number => s !== null);
  const overall = score(r.overall) ?? (scored.length > 0 ? round(scored.reduce((a, b) => a + b, 0) / scored.length, 1) : null);
  return {
    verdict: String(r.verdict ?? "").trim(),
    overall,
    wouldPost: r.would_post === true,
    scores,
    issues: issues.slice(0, MAX_ISSUES),
    strengths: (Array.isArray(r.strengths) ? r.strengths : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// From critique to edits
// ---------------------------------------------------------------------------

/** The tools that usually make each kind of fix, most direct first. */
export const WATCH_FIX_TOOLS: Record<WatchDimension | "other", readonly string[]> = {
  hook: ["trim_clip_tool", "swap_shot_tool", "add_kinetic_title_tool"],
  pacing: ["trim_clip_tool", "detect_beats_tool", "speed_ramp_tool"],
  structure: ["move_clips_tool", "delete_from_timeline_tool", "swap_shot_tool"],
  motion: ["set_keyframes_tool", "apply_clip_preset_tool", "apply_motion_transition_tool"],
  transitions: ["apply_motion_transition_tool", "align_match_cut_tool", "add_transition_tool"],
  typography: ["edit_title_tool", "add_kinetic_title_tool", "kinetic_captions_tool"],
  look: ["unify_grade_tool", "color_grade_clip_tool", "apply_fx_tool"],
  sound_design: ["spot_sound_tool", "add_sfx_tool", "auto_sound_design_tool"],
  mix: ["master_audio_tool", "duck_tool", "set_clip_volume_tool"],
  ending: ["add_animated_title_tool", "freeze_frame_tool", "trim_clip_tool"],
  other: ["review_edit_tool"],
};

/** Words in a fix that name the tool better than its dimension does (a pacing issue fixed with a whoosh). */
const FIX_WORDS: readonly [RegExp, string][] = [
  [/\b(whoosh|swoosh|hit|impact|click|riser|boom|sfx|sound effect|foley)\b/i, "add_sfx_tool"],
  [/\b(duck|ducking)\b/i, "duck_tool"],
  [/\b(louder|quieter|loudness|lufs|clipping|true peak|master)\b/i, "master_audio_tool"],
  [/\b(trim|shorten|tighten|cut .{0,20}earlier|hold .{0,12}less)\b/i, "trim_clip_tool"],
  [/\b(speed ramp|ramp|slow[- ]?mo|slow down|speed up)\b/i, "speed_ramp_tool"],
  [/\b(whip|zoom[- ]through|push transition|glitch transition)\b/i, "apply_motion_transition_tool"],
  [/\bmatch[- ]cut\b/i, "align_match_cut_tool"],
  [/\b(grade|lut|contrast|exposure|saturat\w*|shadows|highlights)\b/i, "color_grade_clip_tool"],
  [/\b(caption|subtitle)s?\b/i, "kinetic_captions_tool"],
  [/\b(title|text|font|type size|headline)\b/i, "edit_title_tool"],
  [/\b(end card|outro)\b/i, "add_animated_title_tool"],
  [/\b(swap|replace) (the )?(shot|clip)\b/i, "swap_shot_tool"],
];

/** Up to three tools for an issue: what its words name, then its dimension's. */
export function fixToolsFor(issue: Pick<WatchIssue, "dimension" | "fix" | "problem">): string[] {
  const named = FIX_WORDS.filter(([words]) => words.test(issue.fix)).map(([, tool]) => tool);
  return [...new Set([...named, ...WATCH_FIX_TOOLS[issue.dimension]])].slice(0, 3);
}

/** Shot lines sent with the watch at most (a 90 s montage at 4 cuts/s fits). */
const MAX_NOTE_SHOTS = 400;

/** The timeline as the critic reads it: one line per shot (numbered from 1) and title, timeline seconds. */
export function watchTimelineNotes(review: TimelineReview): string {
  const t = (s: number): string => s.toFixed(2);
  const lines = review.shots.slice(0, MAX_NOTE_SHOTS).map((s) => `shot ${s.index + 1} ${t(s.start)}-${t(s.end)} ${s.name}`);
  for (const title of review.titleClips.slice(0, 60)) lines.push(`title ${t(title.start)}-${t(title.end)} ${title.path.split(/[\\/]/).pop() ?? title.path}`);
  return lines.join("\n").slice(0, 6000);
}

/** The shots an issue's window covers (or the one it starts in), at most three. */
export function shotsAt(review: TimelineReview, issue: Pick<WatchIssue, "start" | "end">): ReviewShot[] {
  const covered = review.shots.filter((s) => s.start < Math.max(issue.end, issue.start + 0.01) && s.end > issue.start);
  return covered.slice(0, 3);
}
