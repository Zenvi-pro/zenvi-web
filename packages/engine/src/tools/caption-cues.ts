/**
 * The cue text of libopenshot's Caption effect, the way zenvi-core's caption
 * tools read and write it (src/classes/caption_cues.py). One `caption_text`
 * string holds every cue, in the format the Captions dock edits:
 *
 *     00:00:00:500 --> 00:00:03:000
 *     Welcome back to my channel.
 *
 * Times are the captioned clip's own (source) seconds. Drawing follows
 * libopenshot exactly (render/kernels/caption.ts `parseCaptions`); this module
 * is the tools' reading of the same text (cue text includes a line the
 * renderer would skip, so tools can show and edit it), plus `safeText`, which
 * rewrites text so libopenshot draws every line as written: a "10:30" inside
 * a cue would otherwise end it, and one-letter or "NOTE" lines are skipped.
 */

import { pyRound } from "../model/rounding.js";

export const ZERO_WIDTH = "​";
/** Older captions used this look-alike colon; `displayText` still undoes it. */
export const RATIO_COLON = "∶";

export interface Cue {
  /** Seconds, in the time base of whoever holds the cue (clip source time inside effects). */
  start: number;
  end: number;
  text: string;
}

/** caption_cues.py `_CAPTION_RE` (Python `.` = any character but "\n", `\Z` = the very end). */
const CAPTION_RE =
  /(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})\s*-->\s*(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})([\s\S]*?)([^\n]*?)(?=\d{2}:\d{2,3}|$(?![\s\S]))/gu;
const TIME_IN_TEXT = /(?<=\d\d):(?=\d\d)/g;

/** `format_time`: seconds → "HH:MM:SS:mmm", rounded to the millisecond. */
export function formatCueTime(seconds: number): string {
  const ms = Math.trunc(pyRound(Math.max(0, Number(seconds) || 0) * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(hours)}:${two(minutes)}:${two(secs)}:${String(milli).padStart(3, "0")}`;
}

function fraction(group: string | undefined): number {
  return Number((group ?? "").padEnd(3, "0").slice(0, 3)) / 1000;
}

/** `drawn_lines`: the lines of a cue libopenshot draws (not empty, not "NOTE…", longer than one UTF-16 unit). */
export function drawnLines(text: string): string[] {
  return String(text ?? "")
    .split("\n")
    .filter((line) => line && !line.startsWith("NOTE") && line.length > 1);
}

/** `parse_caption_text`: the cues of a Caption effect's text, in text order. */
export function parseCaptionText(captionText: string): Cue[] {
  let prepared = String(captionText ?? "");
  if (!prepared.endsWith("\n\n")) prepared += "\n\n";
  const cues: Cue[] = [];
  for (const m of prepared.matchAll(CAPTION_RE)) {
    const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + fraction(m[4]);
    const end = Number(m[5] ?? 0) * 3600 + Number(m[6]) * 60 + Number(m[7]) + fraction(m[8]);
    const body = (m[9] ?? "") + (m[10] ?? "");
    const text = body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    cues.push({ start, end, text });
  }
  return cues;
}

/** `safe_line`: one line rewritten so libopenshot draws all of it. */
export function safeLine(line: string): string {
  let out = line.replace(TIME_IN_TEXT, `${ZERO_WIDTH}:`);
  if (out.startsWith("NOTE")) out = ZERO_WIDTH + out;
  if (out.length === 1) out += ZERO_WIDTH;
  return out;
}

/** `safe_text`: [drawable text, changed?]; blank lines dropped, each line made safe. */
export function safeText(text: string): [string, boolean] {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  const kept = lines.filter(Boolean);
  const result = kept.map(safeLine).join("\n");
  return [result, result !== kept.join("\n")];
}

/** `display_text`: undo `safeLine` for people (and models). */
export function displayText(text: string): string {
  return String(text ?? "").replaceAll(ZERO_WIDTH, "").replaceAll(RATIO_COLON, ":");
}

/** `build_caption_text`: Caption effect text for `cues`, sorted by start (text must already be safe). */
export function buildCaptionText(cues: readonly Cue[]): string {
  const blocks = [...cues]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((cue) => `${formatCueTime(cue.start)} --> ${formatCueTime(cue.end)}\n${cue.text}`);
  return blocks.join("\n\n") + (blocks.length > 0 ? "\n\n" : "");
}
