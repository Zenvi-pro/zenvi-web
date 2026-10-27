/**
 * The timeline: tweens on element transforms, opacity, blur, CSS variables,
 * styles and SVG attributes (or plain object fields), plus per-frame tracks.
 *
 * `seek(t)` is stateless: every animated property is recomputed from the
 * tween list for time t alone, so frame 90 is the same whether it is
 * rendered first, last or twice. There is no clock; the renderer (or
 * HyperFrames) owns time.
 */

import type { PictureEvent, PictureEventKind } from "@zenvi/engine";
import { resolveEase, type Ease, type EaseName } from "./easing.js";
import { interpolate, type Value } from "./interpolate.js";
import { random01 } from "./rng.js";

export type Target = Element | Record<string, unknown>;
export type Targets = Target | readonly Target[] | NodeListOf<Element> | null | undefined;
export type Props = Readonly<Record<string, Value>>;

export interface StaggerOptions {
  /** Seconds between targets (TASTE.md: 0.06 per word, 0.12 per line). */
  each: number;
  from?: "start" | "end" | "center" | "random";
  /** Seed for `from: "random"`. */
  seed?: number;
}

export interface TweenOptions {
  /** Start, seconds. */
  at: number;
  /** Seconds (default 0.6, TASTE.md's entrance). */
  duration?: number;
  ease?: EaseName | Ease;
  stagger?: number | StaggerOptions;
}

/** A picture event's details besides its time and kind (sfx/events.ts in the engine). */
export interface CueOptions {
  /** 0..1, how big it is on screen (default 0.5). */
  weight?: number;
  /** 0..1 of the frame (default 0.5, the centre). */
  x?: number;
  y?: number;
  /** Runs (`type`, `tick`): seconds the run ends. */
  until?: number;
  /** Runs: events per second. */
  rate?: number;
}

/** A function of time run after the tweens on every seek; it must depend on `t` only. */
export type Track = (t: number) => void;

interface Tween {
  prop: string;
  from: Value | undefined;
  to: Value;
  at: number;
  duration: number;
  ease: Ease;
  order: number;
}

/** Transform channels, composed in this order. */
const TRANSFORM_PROPS = ["xPercent", "yPercent", "x", "y", "z", "rotateX", "rotateY", "rotate", "skewX", "skewY", "scale", "scaleX", "scaleY"] as const;
const TRANSFORM_SET = new Set<string>(TRANSFORM_PROPS);
/** Values a transform channel or opacity/blur rests at before any tween. */
const IDENTITY: Readonly<Record<string, number>> = { scale: 1, scaleX: 1, scaleY: 1, opacity: 1 };
/** CSS lengths given as plain numbers are pixels. */
const PX = new Set(["width", "height", "left", "top", "right", "bottom", "borderRadius", "fontSize", "letterSpacing", "padding", "margin", "gap", "strokeWidth", "outlineWidth"]);

function toList(targets: Targets): Target[] {
  if (!targets) return [];
  if (Array.isArray(targets)) return [...(targets as Target[])];
  if (typeof (targets as NodeListOf<Element>).forEach === "function" && typeof (targets as NodeListOf<Element>).length === "number" && !(targets instanceof Element)) {
    return Array.from(targets as NodeListOf<Element>);
  }
  return [targets as Target];
}

function staggerOffsets(count: number, stagger: number | StaggerOptions | undefined): number[] {
  if (!stagger || count <= 1) return new Array<number>(count).fill(0);
  const s = typeof stagger === "number" ? { each: stagger } : stagger;
  const from = s.from ?? "start";
  const order = [...Array(count).keys()];
  if (from === "random") {
    const keys = order.map((i) => random01(s.seed ?? 1, i));
    const ranked = [...order].sort((a, b) => keys[a]! - keys[b]!);
    const out = new Array<number>(count);
    ranked.forEach((i, rank) => (out[i] = rank * s.each));
    return out;
  }
  return order.map((i) => {
    if (from === "end") return (count - 1 - i) * s.each;
    if (from === "center") return Math.abs(i - (count - 1) / 2) * s.each;
    return i * s.each;
  });
}

function isElement(target: Target): target is Element {
  return typeof (target as Element).setAttribute === "function" && typeof (target as Element).tagName === "string";
}

function cssValue(prop: string, value: Value): string {
  return typeof value === "number" && PX.has(prop) ? `${value}px` : String(value);
}

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export class Timeline {
  private readonly tweens = new Map<Target, Tween[]>();
  private readonly tracks: Track[] = [];
  private readonly events: PictureEvent[] = [];
  private order = 0;
  private end = 0;

  /** Seconds the timeline runs: the end of its last tween, or longer when `extend` asked for it. */
  get duration(): number {
    return this.end;
  }

  /** Make the timeline at least `seconds` long (a hold after the last tween). */
  extend(seconds: number): this {
    this.end = Math.max(this.end, seconds);
    return this;
  }

  /** Animate from each property's value at `at` (its previous tween's end, else its rest value) to `props`. */
  to(targets: Targets, props: Props, options: TweenOptions): this {
    return this.add(targets, undefined, props, options);
  }

  fromTo(targets: Targets, from: Props, to: Props, options: TweenOptions): this {
    return this.add(targets, from, to, options);
  }

  /** Jump to `props` at `at` (a zero-length tween). */
  set(targets: Targets, props: Props, at: number): this {
    return this.add(targets, undefined, props, { at, duration: 0, ease: "hold" });
  }

  /** Run `track(t)` on every seek, after the tweens (typing, counters, particles). */
  track(track: Track, until = 0): this {
    this.tracks.push(track);
    this.end = Math.max(this.end, until);
    return this;
  }

  /** Record a picture event: something on screen the ear expects to hear (not drawn; the sound design reads it). */
  cue(at: number, kind: PictureEventKind, options: CueOptions = {}): this {
    const event: PictureEvent = { t: at, kind, weight: options.weight ?? 0.5, x: options.x ?? 0.5, y: options.y ?? 0.5 };
    if (options.until !== undefined && options.until > at) event.until = options.until;
    if (options.rate !== undefined && options.rate > 0) event.rate = options.rate;
    this.events.push(event);
    return this;
  }

  /** The picture events, by time (ties keep the order they were cued in). */
  get cues(): PictureEvent[] {
    return this.events.map((e) => ({ ...e })).sort((a, b) => a.t - b.t);
  }

  private add(targets: Targets, from: Props | undefined, to: Props, options: TweenOptions): this {
    const list = toList(targets);
    const duration = Math.max(0, options.duration ?? 0.6);
    const ease = resolveEase(options.ease);
    const offsets = staggerOffsets(list.length, options.stagger);
    list.forEach((target, i) => {
      const at = options.at + offsets[i]!;
      let tweens = this.tweens.get(target);
      if (!tweens) {
        tweens = [];
        this.tweens.set(target, tweens);
      }
      for (const [prop, value] of Object.entries(to)) {
        tweens.push({ prop, from: from?.[prop], to: value, at, duration, ease, order: this.order++ });
      }
      this.end = Math.max(this.end, at + duration);
    });
    return this;
  }

  /** Every animated property of `target` at time `t`. */
  valuesAt(target: Target, t: number): Map<string, Value> {
    const out = new Map<string, Value>();
    const byProp = new Map<string, Tween[]>();
    for (const tween of this.tweens.get(target) ?? []) {
      let list = byProp.get(tween.prop);
      if (!list) {
        list = [];
        byProp.set(tween.prop, list);
      }
      list.push(tween);
    }
    for (const [prop, list] of byProp) {
      list.sort((a, b) => a.at - b.at || a.order - b.order);
      const rest: Value | undefined = list[0]!.from ?? IDENTITY[prop] ?? (TRANSFORM_SET.has(prop) || prop === "blur" ? 0 : undefined);
      let value: Value | undefined = rest;
      for (const tween of list) {
        if (tween.at > t) break;
        const from = tween.from ?? value ?? tween.to;
        const p = tween.duration <= 0 ? 1 : Math.min(1, (t - tween.at) / tween.duration);
        value = interpolate(from, tween.to, tween.ease(p));
      }
      if (value !== undefined) out.set(prop, value);
    }
    return out;
  }

  /** Put every target in its state at time `t` (seconds), then run the tracks. */
  seek(t: number): void {
    for (const target of this.tweens.keys()) apply(target, this.valuesAt(target, t));
    for (const track of this.tracks) track(t);
  }
}

function apply(target: Target, values: Map<string, Value>): void {
  if (!isElement(target)) {
    for (const [prop, value] of values) (target as Record<string, unknown>)[prop] = value;
    return;
  }
  const el = target as HTMLElement;
  let transform = false;
  for (const [prop, value] of values) {
    if (TRANSFORM_SET.has(prop)) transform = true;
    else if (prop === "opacity") el.style.opacity = String(value);
    else if (prop === "blur") el.style.filter = Number(value) > 0.01 ? `blur(${value}px)` : "";
    else if (prop.startsWith("--")) el.style.setProperty(prop, String(value));
    else if (prop.startsWith("attr:")) el.setAttribute(prop.slice(5), String(value));
    else el.style.setProperty(kebab(prop), cssValue(prop, value));
  }
  if (transform) el.style.transform = composeTransform(values);
}

/** The CSS transform of the transform channels in `values`. */
export function composeTransform(values: ReadonlyMap<string, Value>): string {
  const n = (prop: string, fallback: number): number => {
    const v = values.get(prop);
    return v === undefined ? fallback : Number(v);
  };
  const parts: string[] = [];
  const xp = n("xPercent", 0);
  const yp = n("yPercent", 0);
  if (xp !== 0 || yp !== 0) parts.push(`translate(${xp}%, ${yp}%)`);
  const x = n("x", 0);
  const y = n("y", 0);
  const z = n("z", 0);
  if (x !== 0 || y !== 0 || z !== 0) parts.push(`translate3d(${x}px, ${y}px, ${z}px)`);
  for (const [prop, fn] of [["rotateX", "rotateX"], ["rotateY", "rotateY"], ["rotate", "rotate"], ["skewX", "skewX"], ["skewY", "skewY"]] as const) {
    const v = n(prop, 0);
    if (v !== 0) parts.push(`${fn}(${v}deg)`);
  }
  const s = n("scale", 1);
  const sx = n("scaleX", 1) * s;
  const sy = n("scaleY", 1) * s;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.join(" ") || "none";
}
