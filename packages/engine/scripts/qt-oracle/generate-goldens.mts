/**
 * Regenerates packages/engine/src/render/qt/qt-goldens.json from real Qt 5.15
 * calls (the oracle in qtoracle.cpp mirrors what libopenshot does with
 * QPainter/QImage). Run on a machine with Qt 5.15 (Homebrew `qt@5`):
 *
 *   npx tsx packages/engine/scripts/qt-oracle/generate-goldens.mts
 *
 * Env: QT5_DIR (default /opt/homebrew/opt/qt@5), CXX (default clang++).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GOLDEN_CASES, type GoldenCase } from "../../src/render/qt/qt-golden-cases.js";
import { gradientImage, noiseImage, toBase64 } from "../../src/render/testing/images.js";
import type { PremulImage } from "../../src/render/pixels.js";

const here = dirname(fileURLToPath(import.meta.url));
const qt = process.env.QT5_DIR ?? "/opt/homebrew/opt/qt@5";
const cxx = process.env.CXX ?? "clang++";
const work = mkdtempSync(join(tmpdir(), "zenvi-qt-oracle-"));
const oracle = join(work, "qtoracle");
execFileSync(cxx, ["-std=c++17", "-O1", `-F${qt}/lib`, "-framework", "QtGui", "-framework", "QtCore", `-I${qt}/include`, "-o", oracle, join(here, "qtoracle.cpp")], {
  stdio: "inherit",
});

function write(name: string, img: PremulImage): string {
  const p = join(work, name);
  writeFileSync(p, img.data);
  return p;
}

function run(args: string[]): { width: number; height: number; data: string } {
  const out = join(work, "out.rgba");
  const [w, h] = execFileSync(oracle, [...args, out], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  return { width: w!, height: h!, data: toBase64(readFileSync(out)) };
}

const f = Math.fround;
const p17 = (v: number): string => v.toPrecision(17);

function generate(c: GoldenCase): { width: number; height: number; data: string } {
  switch (c.kind) {
    case "smooth":
      return run(["smooth", write("in.rgba", noiseImage(c.w, c.h, c.seed, c.alpha)), `${c.w}`, `${c.h}`, `${c.dw}`, `${c.dh}`]);
    case "fast":
      return run(["fast", write("in.rgba", noiseImage(c.w, c.h, c.seed, "mixed")), `${c.w}`, `${c.h}`, `${c.dw}`, `${c.dh}`]);
    case "rect": {
      const [cw, ch, cs] = c.canvas;
      const [iw, ih, is] = c.image;
      const canvas = write("c.rgba", noiseImage(cw, ch, cs, "mixed"));
      const image = write("i.rgba", noiseImage(iw, ih, is, "mixed"));
      return run(["rectblit", canvas, `${cw}`, `${ch}`, image, `${iw}`, `${ih}`, ...c.target.map(String), ...c.source.map(String)]);
    }
    case "clip": {
      const img =
        c.image === "gradient" ? gradientImage(c.w, c.h) : noiseImage(c.w, c.h, c.seed, c.image === "mixed" ? "mixed" : "opaque");
      const ox = f(f(c.w * f(c.sw)) * c.ofx);
      const oy = f(f(c.h * f(c.sh)) * c.ofy);
      const values = [f(c.x), f(c.y), f(c.r), f(c.shx), f(c.shy), ox, oy, f(c.sw), f(c.sh), f(c.alpha)].map(p17);
      return run(["clip", write("in.rgba", img), `${c.w}`, `${c.h}`, `${c.cw}`, `${c.ch}`, ...values, "0", `${c.corner}`]);
    }
    case "compose": {
      const d = write("d.rgba", noiseImage(c.w, c.h, c.seed, "mixed"));
      const s = write("s.rgba", noiseImage(c.w, c.h, c.seed + 1000, "mixed"));
      return run(["compose", d, `${c.w}`, `${c.h}`, s, `${c.mode}`]);
    }
  }
}

const cases: Record<string, { width: number; height: number; data: string }> = {};
for (const c of GOLDEN_CASES) cases[`${c.kind}/${c.name}`] = generate(c);
const target = resolve(here, "../../src/render/qt/qt-goldens.json");
writeFileSync(target, `${JSON.stringify({ qt: "5.15 (see qtoracle.cpp)", cases }, null, 1)}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${Object.keys(cases).length} cases to ${target}`);
