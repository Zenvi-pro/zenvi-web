import { describe, expect, it } from "vitest";
import type { GrayImage } from "./gray.js";
import { RegionTracker, boxQuad, fitAffine, quadAngle, quadCenter, quadSize, smoothTrack, trackAt, type Quad, type Track } from "./track.js";

const W = 320;
const H = 180;

/** A smooth random texture, sampled at (x, y) through `inverse` (canvas → texture). */
function scene(inverse: (x: number, y: number) => [number, number], seed = 7): GrayImage {
  const blobs: [number, number, number, number][] = [];
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 160; i += 1) blobs.push([rand() * W * 1.4 - W * 0.2, rand() * H * 1.4 - H * 0.2, 3 + rand() * 9, rand() * 200 - 100]);
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [u, v] = inverse(x, y);
      let value = 128;
      for (const [bx, by, r, a] of blobs) {
        const d2 = ((u - bx) ** 2 + (v - by) ** 2) / (r * r);
        if (d2 < 9) value += a * Math.exp(-d2);
      }
      data[y * W + x] = Math.max(0, Math.min(255, value));
    }
  }
  return { width: W, height: H, data };
}

describe("RegionTracker", () => {
  it("follows a box that slides by sub-pixel steps", () => {
    const tracker = new RegionTracker(scene((x, y) => [x, y]), boxQuad(120, 60, 60, 50), "similarity");
    let last: Quad = tracker.quad;
    for (let i = 1; i <= 10; i += 1) {
      const r = tracker.step(scene((x, y) => [x - 2.5 * i, y + 1.25 * i]));
      expect(r.lost).toBe(false);
      last = r.quad;
    }
    const c = quadCenter(last);
    expect(c.x).toBeCloseTo(150 + 25, 0);
    expect(c.y).toBeCloseTo(85 - 12.5, 0);
    expect(quadSize(last).w).toBeCloseTo(60, 0);
  });

  it("follows a zoom and a turn about the subject", () => {
    const cx = 160;
    const cy = 90;
    const tracker = new RegionTracker(scene((x, y) => [x, y]), boxQuad(130, 65, 60, 50), "similarity");
    let last: Quad = tracker.quad;
    for (let i = 1; i <= 8; i += 1) {
      const k = 1 + 0.02 * i;
      const a = (1.5 * i * Math.PI) / 180;
      // Canvas = centre + k·R(a)·(texture − centre); invert it.
      const inv = (x: number, y: number): [number, number] => {
        const dx = (x - cx) / k;
        const dy = (y - cy) / k;
        return [cx + Math.cos(a) * dx + Math.sin(a) * dy, cy - Math.sin(a) * dx + Math.cos(a) * dy];
      };
      last = tracker.step(scene(inv)).quad;
    }
    expect(quadSize(last).w / 60).toBeCloseTo(1.16, 1);
    expect(quadAngle(last, 1)).toBeCloseTo(12, 0);
  });

  it("fits a slanted surface with the affine model", () => {
    const tracker = new RegionTracker(scene((x, y) => [x, y]), boxQuad(110, 50, 100, 80), "affine");
    let last: Quad = tracker.quad;
    for (let i = 1; i <= 6; i += 1) {
      const sh = 0.03 * i;
      // Canvas x = u + sh·(v − 90): a horizontal shear about the middle row.
      last = tracker.step(scene((x, y) => [x - sh * (y - 90), y])).quad;
    }
    // Top edge (v = 50) moved by 0.18·(−40), bottom (v = 130) by 0.18·40.
    expect(last[0].x).toBeCloseTo(110 - 7.2, 0);
    expect(last[3].x).toBeCloseTo(110 + 7.2, 0);
  });

  it("reports lost when the region has nothing to hold on to", () => {
    const flat: GrayImage = { width: W, height: H, data: new Float32Array(W * H).fill(90) };
    const tracker = new RegionTracker(flat, boxQuad(100, 50, 40, 40), "similarity");
    const r = tracker.step(flat);
    expect(r.lost).toBe(true);
    expect(r.quad).toEqual(boxQuad(100, 50, 40, 40));
  });
});

describe("track helpers", () => {
  const track: Track = {
    model: "similarity",
    aspect: 16 / 9,
    samples: [0, 1, 2, 3, 4].map((t) => ({ time: t, quad: boxQuad(0.1 * t + (t % 2 ? 0.02 : 0), 0.2, 0.1, 0.1), lost: false, score: 1 })),
  };

  it("interpolates and holds at the ends", () => {
    expect(trackAt(track, 0.5)[0].x).toBeCloseTo(0.06, 6);
    expect(trackAt(track, -1)[0].x).toBe(0);
    expect(trackAt(track, 9)[0].x).toBeCloseTo(0.4, 6);
  });

  it("smooths jitter but keeps the trend", () => {
    const smooth = smoothTrack(track, 1);
    const xs = smooth.samples.map((s) => s.quad[0].x);
    expect(Math.abs(xs[2]! - 0.2)).toBeLessThan(0.01);
    expect(xs[1]! - xs[0]!).toBeGreaterThan(0);
  });

  it("fits an exact affine", () => {
    const from = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const m = fitAffine(
      from,
      from.map((p) => ({ x: 2 * p.x + 0.5 * p.y + 3, y: -p.x + p.y - 1 })),
    )!;
    expect(m.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 0.5, 3, -1, 1, -1]);
  });
});

describe("guide graphics", () => {
  it("keep the golden spiral's strokes visible inside its scaled group", async () => {
    const { guideSvg } = await import("./guides.js");
    const svg = guideSvg("golden_spiral", 1280, 720, { cx: 640, cy: 360, w: 100, h: 100, angle: 0 }, { color: "#FFFFFF", stroke: 3 });
    const widths = [...svg.matchAll(/stroke-width="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(widths.length).toBe(2);
    for (const w of widths) expect(w * 720).toBeGreaterThan(1.5);
  });
});
