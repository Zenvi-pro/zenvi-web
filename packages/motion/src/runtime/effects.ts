/**
 * Effects built on the timeline: seeded particles, SVG stroke drawing, a
 * 2.5D camera with depth of field, and media frames seeked by time.
 */

import { random01 } from "./rng.js";
import type { VideoFrames } from "../config.js";
import type { Track } from "./timeline.js";

export interface ParticleOptions {
  seed: number;
  count: number;
  /** Emitter, design px. */
  x: number;
  y: number;
  /** Burst time, seconds. */
  at: number;
  /** Each particle's life, seconds (min, max). */
  life?: [number, number];
  /** Launch speed, px/s (min, max). */
  speed?: [number, number];
  /** Launch directions: centre angle and spread, degrees (0 = right, -90 = up). Default all round. */
  angle?: number;
  spread?: number;
  /** px/s², down positive. */
  gravity?: number;
  /** Exponential velocity decay per second (air drag). */
  drag?: number;
  /** Diameter, px (min, max). */
  size?: [number, number];
  colors: string[];
  shape?: "dot" | "square" | "streak" | "ring";
  /** Seconds over which particles leave the emitter (0 = all at once). */
  emit?: number;
}

/** Where one particle is at age `age` (s): launched with v0, decaying by drag, falling with gravity. */
export function particlePosition(v0x: number, v0y: number, age: number, drag: number, gravity: number): { x: number; y: number } {
  const k = Math.max(drag, 1e-6);
  const travel = (1 - Math.exp(-k * age)) / k;
  return { x: v0x * travel, y: v0y * travel + 0.5 * gravity * age * age };
}

/** A track drawing a particle burst into a 2D canvas the size of the frame (cleared every seek). */
export function particles(canvas: HTMLCanvasElement, bursts: readonly ParticleOptions[], scale = 1): Track {
  return (t) => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    for (const b of bursts) drawBurst(g, b, t);
  };
}

function drawBurst(g: CanvasRenderingContext2D, b: ParticleOptions, t: number): void {
  const [lifeMin, lifeMax] = b.life ?? [0.6, 1.4];
  const [vMin, vMax] = b.speed ?? [300, 1100];
  const [sMin, sMax] = b.size ?? [6, 16];
  const spread = ((b.spread ?? 360) * Math.PI) / 180;
  const center = ((b.angle ?? -90) * Math.PI) / 180;
  for (let i = 0; i < b.count; i += 1) {
    const r = (k: number): number => random01(b.seed, i, k);
    const delay = (b.emit ?? 0) * r(0);
    const life = lifeMin + (lifeMax - lifeMin) * r(1);
    const age = t - b.at - delay;
    if (age < 0 || age > life) continue;
    const a = center + (r(2) - 0.5) * spread;
    const v = vMin + (vMax - vMin) * r(3);
    const p = particlePosition(Math.cos(a) * v, Math.sin(a) * v, age, b.drag ?? 3, b.gravity ?? 0);
    const k = age / life;
    const size = (sMin + (sMax - sMin) * r(4)) * (1 - 0.6 * k);
    g.globalAlpha = Math.max(0, 1 - k * k);
    const color = b.colors[Math.floor(r(5) * b.colors.length)] ?? "#fff";
    const x = b.x + p.x;
    const y = b.y + p.y;
    g.fillStyle = color;
    g.strokeStyle = color;
    switch (b.shape ?? "dot") {
      case "square":
        g.save();
        g.translate(x, y);
        g.rotate(r(6) * Math.PI * 2 + age * 6 * (r(7) - 0.5));
        g.fillRect(-size / 2, -size / 2, size, size);
        g.restore();
        break;
      case "streak": {
        const speedNow = v * Math.exp(-(b.drag ?? 3) * age);
        const len = Math.max(size, speedNow * 0.05);
        g.lineWidth = Math.max(1.5, size / 3);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
        g.lineTo(x, y);
        g.stroke();
        break;
      }
      case "ring":
        g.lineWidth = Math.max(1.5, size / 5);
        g.beginPath();
        g.arc(x, y, size / 2, 0, Math.PI * 2);
        g.stroke();
        break;
      default:
        g.beginPath();
        g.arc(x, y, size / 2, 0, Math.PI * 2);
        g.fill();
    }
  }
  g.globalAlpha = 1;
}

/**
 * Prepare an SVG shape for drawing on: its length normalised to 1, fully
 * hidden. Tween `attr:stroke-dashoffset` from 1 to 0 to draw it.
 */
export function strokeDrawable(shape: SVGGeometryElement): SVGGeometryElement {
  shape.setAttribute("pathLength", "1");
  shape.setAttribute("stroke-dasharray", "1 1");
  shape.setAttribute("stroke-dashoffset", "1");
  return shape;
}

export interface Camera {
  /** The perspective viewport (fills its parent). */
  viewport: HTMLElement;
  /** The world group the camera moves: tween x, y, z, rotateX, rotateY on it. */
  world: HTMLElement;
  /** A plane at depth `z` px (positive = closer). */
  layer(z: number, className?: string): HTMLElement;
  /** A track blurring each layer by its distance from the focus depth `focus(t)`. */
  depthOfField(focus: (t: number) => number, pxPerBlur?: number, maxBlur?: number): Track;
}

/** A 2.5D camera: CSS perspective + preserve-3d planes, so cards float at real depths. */
export function createCamera(parent: HTMLElement, perspective = 1600): Camera {
  const doc = parent.ownerDocument;
  const viewport = doc.createElement("div");
  viewport.className = "camera";
  Object.assign(viewport.style, { position: "absolute", inset: "0", perspective: `${perspective}px`, perspectiveOrigin: "50% 50%", overflow: "hidden" });
  const world = doc.createElement("div");
  world.className = "world";
  Object.assign(world.style, { position: "absolute", inset: "0", transformStyle: "preserve-3d" });
  viewport.append(world);
  parent.append(viewport);
  const layers: { el: HTMLElement; z: number }[] = [];
  return {
    viewport,
    world,
    layer(z, className) {
      const el = doc.createElement("div");
      el.className = className ? `plane ${className}` : "plane";
      Object.assign(el.style, { position: "absolute", inset: "0", transformStyle: "preserve-3d", transform: `translateZ(${z}px)` });
      world.append(el);
      layers.push({ el, z });
      return el;
    },
    depthOfField(focus, pxPerBlur = 120, maxBlur = 14) {
      return (t) => {
        const f = focus(t);
        for (const { el, z } of layers) {
          const b = Math.min(maxBlur, Math.abs(z - f) / pxPerBlur);
          el.style.filter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : "";
        }
      };
    },
  };
}

export function frameUrl(video: VideoFrames, n: number): string {
  const i = Math.max(0, Math.min(video.frames - 1, n));
  return video.pattern.replace("{n}", String(i + 1).padStart(5, "0"));
}

/**
 * A track showing frame `t·fps` of `video` in `img` (holding the last frame
 * past the end). `pending` collects decodes the renderer awaits before it
 * captures.
 */
export function videoTrack(img: HTMLImageElement, video: VideoFrames, pending: Set<Promise<unknown>>, start = 0): Track {
  return (t) => {
    const url = frameUrl(video, Math.floor(Math.max(0, t - start) * video.fps + 1e-6));
    if (img.getAttribute("src") === url) return;
    img.setAttribute("src", url);
    if (typeof img.decode === "function") {
      const p = img.decode().catch(() => undefined);
      pending.add(p);
      void p.finally(() => pending.delete(p));
    }
  };
}
