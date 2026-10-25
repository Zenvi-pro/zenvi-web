/**
 * A FrameHost that really renders, for the colour tools' tests (used only by
 * `*.test.ts`): the engine's frame planner and CPU compositor, every
 * video/image source painted by `paint(path, width, height, sourceSeconds)`,
 * and the frame encoded as PNG (node:zlib), the way render-node answers.
 * Effects (ColorGrade, ChromaKey, Negate…) run through the real kernels.
 */

import { deflateSync } from "node:zlib";
import type { Project } from "../../model/types.js";
import { compositeFrame, planFrame } from "../../render/index.js";
import type { RgbaImage } from "../../render/types.js";
import { frameContaining } from "../../timeline/time.js";
import type { FrameHost, ToolImage } from "../types.js";

export type Painter = (path: string, width: number, height: number, seconds: number) => RgbaImage;

/** A solid colour source. */
export function solid(width: number, height: number, rgba: readonly [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

/** A grey subject (middle third) on a screen colour, like a green-screen shot. */
export function screenShot(width: number, height: number, screen: readonly [number, number, number], subject: readonly [number, number, number] = [128, 120, 110]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = Math.abs(x - width / 2) < width / 6 && Math.abs(y - height / 2) < height / 4;
      const c = inside ? subject : screen;
      data.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** 8-bit RGBA PNG. */
export function encodePng(image: RgbaImage): Uint8Array {
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface PixelHost extends FrameHost {
  /** Frames rendered: [width of the scratch project, seconds] per call. */
  readonly renders: { project: Project; seconds: number; width: number; format: string }[];
}

/** Render with the CPU compositor; `paint` draws each source. */
export function pixelFrameHost(paint: Painter): PixelHost {
  const renders: PixelHost["renders"] = [];
  return {
    renders,
    async renderFrame(project, seconds, options = {}): Promise<ToolImage> {
      const width = Math.max(16, Math.round(options.width ?? project.width));
      const height = Math.max(16, Math.round((width * project.height) / Math.max(1, project.width)));
      renders.push({ project, seconds, width, format: options.format ?? "png" });
      const plan = planFrame(project, frameContaining(Math.max(0, seconds), project.fps), { width, height }, { preview: true });
      const layers = plan.layers.map((layer) => {
        const source = layer.source;
        if (source.kind === "color") return null;
        const time = source.kind === "video" ? source.time : 0;
        return paint(source.path, layer.drawWidth, layer.drawHeight, time);
      });
      const image = compositeFrame(plan, { layers });
      return { mimeType: "image/png", data: Buffer.from(encodePng(image)).toString("base64") };
    },
  };
}
