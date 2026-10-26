/**
 * Text animators: split text into chars/words/lines, typewriter, scramble,
 * counters and odometers. Each returns elements to tween or a Track, a pure
 * function of time.
 */

import { resolveEase, type Ease, type EaseName } from "./easing.js";
import { random01 } from "./rng.js";
import type { Track } from "./timeline.js";

export interface SplitText {
  words: HTMLElement[];
  chars: HTMLElement[];
  /** Line wrappers (`.line`, each holding a `.line-inner`), when `lines` was asked for. */
  lines: HTMLElement[];
  /** The `.line-inner` of each line: what a mask reveal moves. */
  lineInners: HTMLElement[];
}

export interface SplitOptions {
  chars?: boolean;
  /** Group words into line wrappers (needs layout: call after fonts load). */
  lines?: boolean;
}

/**
 * Replace `el`'s text with one inline-block span per word (`.word`) and,
 * with `chars`, per character (`.char`). Spaces stay text so the line still
 * wraps naturally.
 */
export function splitText(el: HTMLElement, options: SplitOptions = {}): SplitText {
  const doc = el.ownerDocument;
  const text = el.textContent ?? "";
  el.textContent = "";
  const words: HTMLElement[] = [];
  const chars: HTMLElement[] = [];
  const tokens = text.split(/(\s+)/).filter((s) => s.length > 0);
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      el.append(doc.createTextNode(" "));
      continue;
    }
    const word = doc.createElement("span");
    word.className = "word";
    word.style.display = "inline-block";
    word.style.whiteSpace = "nowrap";
    if (options.chars) {
      for (const c of Array.from(token)) {
        const ch = doc.createElement("span");
        ch.className = "char";
        ch.style.display = "inline-block";
        ch.textContent = c;
        word.append(ch);
        chars.push(ch);
      }
    } else {
      word.textContent = token;
    }
    el.append(word);
    words.push(word);
  }
  const out: SplitText = { words, chars, lines: [], lineInners: [] };
  if (options.lines) groupLines(el, out);
  return out;
}

function groupLines(el: HTMLElement, split: SplitText): void {
  const doc = el.ownerDocument;
  const rows: HTMLElement[][] = [];
  let lastTop: number | undefined;
  for (const word of split.words) {
    const top = Math.round(word.offsetTop);
    if (lastTop === undefined || Math.abs(top - lastTop) > 2) rows.push([]);
    rows[rows.length - 1]!.push(word);
    lastTop = top;
  }
  el.textContent = "";
  for (const row of rows) {
    const line = doc.createElement("span");
    line.className = "line";
    line.style.display = "block";
    line.style.overflow = "hidden";
    const inner = doc.createElement("span");
    inner.className = "line-inner";
    inner.style.display = "inline-block";
    row.forEach((word, i) => {
      if (i > 0) inner.append(doc.createTextNode(" "));
      inner.append(word);
    });
    line.append(inner);
    el.append(line);
    split.lines.push(line);
    split.lineInners.push(inner);
  }
}

export interface TypewriterOptions {
  at: number;
  /** Characters per second (default 18, a brisk human typist on screen). */
  cps?: number;
  /** Delete back to empty at this time (optional). */
  eraseAt?: number;
}

/** Characters of `text` shown at time `t`. */
export function typedCount(text: string, t: number, options: TypewriterOptions): number {
  const total = Array.from(text).length;
  const cps = options.cps ?? 18;
  let n = Math.floor(Math.max(0, t - options.at) * cps + 1e-6);
  if (options.eraseAt !== undefined && t >= options.eraseAt) n = total - Math.floor((t - options.eraseAt) * cps * 2.5 + 1e-6);
  return Math.max(0, Math.min(total, n));
}

/** Seconds typing `text` takes. */
export function typingSeconds(text: string, cps = 18): number {
  return Array.from(text).length / cps;
}

/** A track that types `text` into `el`. */
export function typewriter(el: HTMLElement, text: string, options: TypewriterOptions): Track {
  const chars = Array.from(text);
  return (t) => {
    const shown = chars.slice(0, typedCount(text, t, options)).join("");
    if (el.textContent !== shown) el.textContent = shown;
  };
}

/** A caret that blinks (on 0.5 s, off 0.5 s) except while `busy(t)`, when it stays on. */
export function caretBlink(el: HTMLElement, busy: (t: number) => boolean, from = 0): Track {
  return (t) => {
    const on = t < from ? false : busy(t) || Math.floor((t - from) * 2) % 2 === 0;
    el.style.visibility = on ? "visible" : "hidden";
  };
}

export const SCRAMBLE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/\\[]{}";

export interface ScrambleOptions {
  at: number;
  /** Seconds from the first character starting to the last one resolving (default 1.2). */
  duration?: number;
  seed?: number;
  glyphs?: string;
  /** Glyph changes per second while scrambling (default 20). */
  rate?: number;
  /** Text shown before `at` (default: nothing). */
  before?: string;
}

/**
 * The text at time t: characters left to right start as random glyphs and
 * resolve into `text`; spaces stay spaces.
 */
export function scrambledText(text: string, t: number, options: ScrambleOptions): string {
  const chars = Array.from(text);
  const glyphs = Array.from(options.glyphs ?? SCRAMBLE_GLYPHS);
  if (t < options.at) return options.before ?? "";
  const duration = options.duration ?? 1.2;
  const n = Math.max(1, chars.length);
  // Each character scrambles for 40 % of the run; starts are spread over the rest.
  const life = duration * 0.4;
  const spread = duration - life;
  const tick = Math.floor(t * (options.rate ?? 20));
  return chars
    .map((c, i) => {
      if (/\s/.test(c)) return c;
      const start = options.at + (spread * i) / n;
      if (t < start) return "";
      if (t >= start + life) return c;
      return glyphs[Math.floor(random01(options.seed ?? 7, i, tick) * glyphs.length)]!;
    })
    .join("");
}

export function scramble(el: HTMLElement, text: string, options: ScrambleOptions): Track {
  return (t) => {
    const shown = scrambledText(text, t, options);
    if (el.textContent !== shown) el.textContent = shown;
  };
}

export interface NumberFormat {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Thousands separator (default ","; "" for none). */
  separator?: string;
}

export function formatNumber(value: number, format: NumberFormat = {}): string {
  const decimals = format.decimals ?? 0;
  const sep = format.separator ?? ",";
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, frac] = fixed.split(".");
  const grouped = sep ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : whole!;
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return `${format.prefix ?? ""}${sign}${grouped}${frac ? `.${frac}` : ""}${format.suffix ?? ""}`;
}

export interface CounterOptions extends NumberFormat {
  from: number;
  to: number;
  at: number;
  duration?: number;
  ease?: EaseName | Ease;
}

export function counterValue(t: number, options: CounterOptions): number {
  const ease = resolveEase(options.ease ?? "out");
  const p = Math.min(1, Math.max(0, (t - options.at) / (options.duration ?? 1.2)));
  return options.from + (options.to - options.from) * ease(p);
}

/** A track that writes the counter's number into `el`. */
export function counter(el: HTMLElement, options: CounterOptions): Track {
  return (t) => {
    const shown = formatNumber(counterValue(t, options), options);
    if (el.textContent !== shown) el.textContent = shown;
  };
}

/**
 * Odometer wheel positions (0 ≤ p < 10, in digits) for `value`, lowest digit
 * first: the ones wheel turns continuously, every higher wheel turns only
 * while the wheel below it rolls from 9 to 0, like a mechanical counter.
 */
export function odometerPositions(value: number, digits: number): number[] {
  const v = Math.max(0, value);
  const out: number[] = [];
  for (let k = 0; k < digits; k += 1) {
    const unit = 10 ** k;
    if (k === 0) {
      out.push(v % 10);
      continue;
    }
    const lower = v % unit;
    const carry = Math.min(1, Math.max(0, lower - (unit - 1)));
    out.push((Math.floor(v / unit) % 10) + carry);
  }
  return out;
}

export interface Odometer {
  el: HTMLElement;
  /** A track rolling the wheels to the counter's value. */
  track: Track;
}

/**
 * An odometer of `digits` wheels (`.odo-wheel` columns of 0-9-0) inside a
 * `.odometer` span; leading zeros are hidden. Style the span's font; each
 * wheel is one line (1em) tall.
 */
export function odometer(doc: Document, digits: number, options: CounterOptions): Odometer {
  const el = doc.createElement("span");
  el.className = "odometer";
  el.style.display = "inline-flex";
  const wheels: HTMLElement[] = [];
  for (let i = 0; i < digits; i += 1) {
    const window_ = doc.createElement("span");
    window_.className = "odo-window";
    Object.assign(window_.style, { display: "inline-block", height: "1em", lineHeight: "1em", overflow: "hidden" });
    const wheel = doc.createElement("span");
    wheel.className = "odo-wheel";
    Object.assign(wheel.style, { display: "flex", flexDirection: "column" });
    for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
      const digit = doc.createElement("span");
      digit.textContent = String(d);
      Object.assign(digit.style, { height: "1em", lineHeight: "1em", display: "block" });
      wheel.append(digit);
    }
    window_.append(wheel);
    el.append(window_);
    wheels.push(wheel);
  }
  const track: Track = (t) => {
    const v = counterValue(t, options);
    const positions = odometerPositions(v, digits);
    const significant = Math.max(1, String(Math.floor(Math.max(Math.abs(v), Math.abs(options.to)))).length);
    wheels.forEach((wheel, i) => {
      const k = digits - 1 - i;
      wheel.style.transform = `translateY(${-positions[k]!}em)`;
      (wheel.parentElement as HTMLElement).style.display = k < significant ? "inline-block" : "none";
    });
  };
  return { el, track };
}
