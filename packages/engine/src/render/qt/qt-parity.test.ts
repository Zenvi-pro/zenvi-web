import { describe, expect, it } from "vitest";
import { createPremul, type PremulImage } from "../pixels.js";
import { diffBytes, fromBase64, gradientImage, noiseImage } from "../testing/images.js";
import { drawImageRect, fastScaled } from "./blit.js";
import { composerFor } from "./compose.js";
import { drawImage, roundedRectClip } from "./draw-image.js";
import { GOLDEN_CASES, type GoldenCase } from "./qt-golden-cases.js";
import goldens from "./qt-goldens.json";
import { smoothScale } from "./smooth-scale.js";
import { QTransform } from "./transform.js";

const f = Math.fround;
const isNear = (a: number, b: number): boolean => Math.abs(a - b) < 0.000001;

/** Replays a golden case through the TypeScript port. */
function render(c: GoldenCase): PremulImage {
  switch (c.kind) {
    case "smooth":
      return smoothScale(noiseImage(c.w, c.h, c.seed, c.alpha), c.dw, c.dh);
    case "fast":
      return fastScaled(noiseImage(c.w, c.h, c.seed, "mixed"), c.dw, c.dh);
    case "rect": {
      const [cw, ch, cs] = c.canvas;
      const [iw, ih, is] = c.image;
      const canvas = noiseImage(cw, ch, cs, "mixed");
      const [tx, ty, tw, th] = c.target;
      const [sx, sy, sw, sh] = c.source;
      drawImageRect(canvas, noiseImage(iw, ih, is, "mixed"), { x: tx, y: ty, width: tw, height: th }, { x: sx, y: sy, width: sw, height: sh });
      return canvas;
    }
    case "clip": {
      const img = c.image === "gradient" ? gradientImage(c.w, c.h) : noiseImage(c.w, c.h, c.seed, c.image === "mixed" ? "mixed" : "opaque");
      const ox = f(f(c.w * f(c.sw)) * c.ofx);
      const oy = f(f(c.h * f(c.sh)) * c.ofy);
      // The same QTransform call sequence as Clip::get_transform (Clip.cpp:1718-1737).
      const t = new QTransform();
      if (!isNear(f(c.x), 0) || !isNear(f(c.y), 0)) t.translate(f(c.x), f(c.y));
      if (!isNear(f(c.r), 0) || !isNear(f(c.shx), 0) || !isNear(f(c.shy), 0)) {
        t.translate(ox, oy);
        t.rotate(f(c.r));
        t.shear(f(c.shx), f(c.shy));
        t.translate(-ox, -oy);
      }
      if (!isNear(f(c.sw), 1) || !isNear(f(c.sh), 1)) t.scale(f(c.sw), f(c.sh));
      const canvas = createPremul(c.cw, c.ch);
      const corner = Math.max(0, Math.min(0.5, c.corner));
      const clip = corner > 0 ? roundedRectClip(img.width, img.height, corner * Math.min(img.width, img.height), t, c.cw, c.ch) : null;
      drawImage(canvas, img, { transform: t, smooth: !t.isIdentity(), antialias: corner > 0, opacity: f(c.alpha), mode: 0, clip });
      return canvas;
    }
    case "compose": {
      const d = noiseImage(c.w, c.h, c.seed, "mixed");
      const s = noiseImage(c.w, c.h, c.seed + 1000, "mixed");
      composerFor(c.mode)(d.data, 0, s.data, 0, c.w * c.h, 255);
      return d;
    }
  }
}

describe("Qt 5.15 raster parity (goldens from scripts/qt-oracle)", () => {
  const table = (goldens as { cases: Record<string, { width: number; height: number; data: string }> }).cases;
  for (const c of GOLDEN_CASES) {
    const key = `${c.kind}/${c.name}`;
    it(`${key} is bit-exact`, () => {
      const golden = table[key];
      expect(golden, `missing golden ${key}; run scripts/qt-oracle/generate-goldens.mts`).toBeDefined();
      const out = render(c);
      expect([out.width, out.height]).toEqual([golden!.width, golden!.height]);
      const diff = diffBytes(fromBase64(golden!.data), out.data);
      expect(diff.differing, `max diff ${diff.maxDiff}`).toBe(0);
    });
  }
});
