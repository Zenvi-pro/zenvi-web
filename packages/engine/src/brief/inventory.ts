/**
 * The media inventory the brief is planned against: one compact row per
 * media-bin file (what it is, how long, which way up, whether someone
 * speaks, faces, its colours and energy). The metadata half reads only what
 * the project already knows (probe fields, the indexer's ai_metadata, kept
 * transcripts, the marks the generators leave); the measured half turns one
 * or two small frames and an RMS envelope into colours and energy.
 */

import { isAudioOnlyMedia, isSingleImageMedia } from "../model/media.js";
import type { Project, ProjectFile } from "../model/types.js";
import type { RgbaImage } from "../render/types.js";
import { SFX_ROLE } from "../sfx/moments.js";
import { MUSIC_MIN_DURATION } from "../tools/audio-mix.js";
import { fileHasAudio, storedTranscript } from "../tools/transcripts.js";

export type InventoryKind = "video" | "image" | "title" | "music" | "voice" | "sfx" | "audio" | "motion" | "3d" | "fx";
export type Orientation = "portrait" | "landscape" | "square";
export type Tristate = "yes" | "no" | "unknown";
export type Level = "low" | "medium" | "high";

export interface InventoryEntry {
  id: string;
  name: string;
  kind: InventoryKind;
  seconds: number | null;
  width: number | null;
  height: number | null;
  orientation: Orientation | null;
  speech: Tristate;
  faces: Tristate;
  /** Dominant colours, most of the frame first, #rrggbb. */
  colors: string[];
  /** dark / mid / bright picture. */
  brightness: "dark" | "mid" | "bright" | null;
  /** Picture motion for footage, loudness and punch for sound. */
  energy: Level | null;
  /** The indexer's one-line summary, cut short. */
  summary: string;
  /** Clips on the timeline that play it. */
  used: number;
}

/** Files the text-to-speech tool writes (generation.ts). */
const TTS_FILE = /(^|[\\/])zenvi_tts_[^\\/]*$/;
const PEOPLE = /\b(face|faces|person|people|man|woman|men|women|boy|girl|portrait|speaker|talking|presenter|selfie|crowd)\b/i;
const SUMMARY_CHARS = 90;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function orientationOf(width: number | null, height: number | null): Orientation | null {
  if (!width || !height) return null;
  const ratio = width / height;
  if (ratio > 1.05) return "landscape";
  if (ratio < 0.95) return "portrait";
  return "square";
}

function kindOf(file: ProjectFile): InventoryKind {
  const link = String(record(file.zenvi_link).kind ?? "");
  if (link === "zenvi-motion") return "motion";
  if (link === "blender") return "3d";
  if (link === "zenvi-fx") return "fx";
  const path = String(file.path ?? "");
  if (/\.svg$/i.test(path)) return "title";
  if (isAudioOnlyMedia(file)) {
    if (file.zenvi_role === SFX_ROLE) return "sfx";
    if (TTS_FILE.test(path)) return "voice";
    const seconds = positive(file.duration);
    return seconds !== null && seconds >= MUSIC_MIN_DURATION ? "music" : "sfx";
  }
  return isSingleImageMedia(file) ? "image" : "video";
}

function words(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" ");
  return typeof value === "string" ? value : "";
}

function speechOf(file: ProjectFile, kind: InventoryKind): Tristate {
  if (kind === "voice") return "yes";
  if (kind === "image" || kind === "title" || kind === "sfx" || kind === "motion" || kind === "3d") return "no";
  if (!fileHasAudio(file)) return "no";
  const ai = record(file.ai_metadata);
  const transcript = storedTranscript(file);
  if (transcript) return transcript.words.length > 0 ? "yes" : "no";
  if (words(ai.transcript).trim() || (Array.isArray(ai.transcript_cues) && ai.transcript_cues.length > 0)) return "yes";
  return "unknown";
}

function facesOf(file: ProjectFile, kind: InventoryKind): Tristate {
  if (kind !== "video" && kind !== "image") return "no";
  const ai = record(file.ai_metadata);
  if (typeof ai.faces === "number") return ai.faces > 0 ? "yes" : "no";
  if (Array.isArray(ai.faces)) return ai.faces.length > 0 ? "yes" : "no";
  const tags = record(ai.tags);
  const text = [ai.short_summary, ai.description, tags.objects, tags.scenes, tags.activities].map(words).join(" ");
  return PEOPLE.test(text) ? "yes" : "unknown";
}

function colorsOf(file: ProjectFile): string[] {
  const ai = record(file.ai_metadata);
  const raw = ai.dominant_colors ?? ai.colors ?? record(ai.tags).colors;
  return Array.isArray(raw) ? raw.map(String).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3) : [];
}

/** What the project already knows about `file`. */
export function inventoryEntry(project: Project, file: ProjectFile): InventoryEntry {
  const kind = kindOf(file);
  const visual = kind !== "music" && kind !== "voice" && kind !== "sfx" && kind !== "audio";
  const width = visual ? positive(file.width) : null;
  const height = visual ? positive(file.height) : null;
  const ai = record(file.ai_metadata);
  const summary = String(ai.short_summary || ai.description || "").replace(/\s+/g, " ").trim();
  const seconds = kind === "image" || kind === "title" ? null : positive(file.duration);
  return {
    id: String(file.id),
    name: String(file.name || String(file.path ?? "?").split(/[\\/]/).pop()),
    kind,
    seconds: seconds === null ? null : Math.round(seconds * 10) / 10,
    width,
    height,
    orientation: orientationOf(width, height),
    speech: speechOf(file, kind),
    faces: facesOf(file, kind),
    colors: colorsOf(file),
    brightness: null,
    energy: null,
    summary: summary.length > SUMMARY_CHARS ? `${summary.slice(0, SUMMARY_CHARS - 1)}…` : summary,
    used: project.clips.filter((c) => String(c.file_id) === String(file.id)).length,
  };
}

/** Files worth planning with: generated sound effects and subclip aliases are the edit's, not the person's. */
export function inventoryFiles(project: Project): ProjectFile[] {
  return project.files.filter((f) => !f.zenvi_subclip && f.zenvi_role !== SFX_ROLE);
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The few colours that cover most of `image`: pixels binned at 3 bits a
 * channel, the biggest bins averaged, near-duplicates merged.
 */
export function dominantColors(image: RgbaImage, count = 3): string[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const { data } = image;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  const ranked = [...bins.values()].sort((a, b) => b.n - a.n).map((bin) => [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n] as const);
  const kept: (readonly [number, number, number])[] = [];
  for (const c of ranked) {
    if (kept.length >= count) break;
    if (kept.every((k) => Math.hypot(k[0] - c[0], k[1] - c[1], k[2] - c[2]) > 48)) kept.push(c);
  }
  return kept.map(([r, g, b]) => hex(r, g, b));
}

/** Mean luma 0-1 (Rec. 601). */
export function meanLuma(image: RgbaImage): number {
  const { data } = image;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    n += 1;
  }
  return n > 0 ? sum / n / 255 : 0;
}

export function brightnessOf(luma: number): "dark" | "mid" | "bright" {
  return luma < 0.3 ? "dark" : luma > 0.65 ? "bright" : "mid";
}

/** How much the picture changes between two frames of the same size: mean absolute luma difference, 0-1. */
export function frameChange(a: RgbaImage, b: RgbaImage): number {
  if (a.width !== b.width || a.height !== b.height) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < a.data.length; i += 4) {
    const la = 0.299 * a.data[i]! + 0.587 * a.data[i + 1]! + 0.114 * a.data[i + 2]!;
    const lb = 0.299 * b.data[i]! + 0.587 * b.data[i + 1]! + 0.114 * b.data[i + 2]!;
    sum += Math.abs(la - lb);
    n += 1;
  }
  return n > 0 ? sum / n / 255 : 0;
}

/** Picture energy from the change over ~0.4 s: a locked-off shot, a moving one, a whip or a sport. */
export function motionLevel(change: number): Level {
  return change < 0.025 ? "low" : change < 0.08 ? "medium" : "high";
}

/** Sound energy from an RMS envelope: how loud the body is and how hard it hits above it. */
export function soundLevel(rms: ArrayLike<number>): Level | null {
  const values = Array.from(rms).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const peak = sorted[Math.floor((sorted.length - 1) * 0.98)]!;
  if (peak <= 1e-4) return null;
  const bodyDb = 20 * Math.log10(Math.max(median, 1e-6));
  // Drums over a quiet body read as energetic too: the peaks stand well above the median.
  const punchy = peak / Math.max(median, 1e-6) > 4;
  if (bodyDb > -20) return "high";
  if (bodyDb < -32) return punchy ? "medium" : "low";
  return punchy ? "high" : "medium";
}

/** One line per entry, for the receipt. */
export function inventoryLine(e: InventoryEntry): string {
  const parts = [`${e.id} ${e.name}`, e.kind];
  if (e.seconds !== null) parts.push(`${e.seconds}s`);
  if (e.orientation) parts.push(`${e.orientation} ${e.width}x${e.height}`);
  if (e.speech !== "no") parts.push(`speech ${e.speech}`);
  if (e.faces === "yes") parts.push("faces");
  if (e.colors.length > 0) parts.push(e.colors.join(" "));
  if (e.brightness) parts.push(e.brightness);
  if (e.energy) parts.push(`energy ${e.energy}`);
  if (e.used > 0) parts.push(`on timeline x${e.used}`);
  if (e.summary) parts.push(`"${e.summary}"`);
  return parts.join(" · ");
}
