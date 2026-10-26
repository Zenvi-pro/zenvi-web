import { beforeAll, describe, expect, it } from "vitest";
import { FONT_FAMILIES, FONT_FAMILY_IDS, bundledFamily, fontFileFor } from "./families.js";
import { FontLibrary } from "./library.js";
import { OUTLINE_ATTR, outlineSvgText } from "./outline.js";
import { readBundledFont } from "./test-fonts.js";
import { fitText, inkBox, setRun, typeset } from "./typeset.js";

let lib: FontLibrary;

beforeAll(async () => {
  lib = await FontLibrary.load(readBundledFont, FONT_FAMILY_IDS);
});

describe("bundled families", () => {
  it("every family loads, draws Latin text and has its licence next to it", async () => {
    for (const id of FONT_FAMILY_IDS) {
      expect(lib.has(id)).toBe(true);
      const block = typeset(lib, "Hamburgefonstiv 0123", { family: id, size: 100 });
      expect(block.missing, id).toEqual([]);
      expect(block.width, id).toBeGreaterThan(300);
      const dir = FONT_FAMILIES[id].files[0]!.path.replace(/[^/]+$/, "");
      const licence = new TextDecoder().decode(await readBundledFont(`${dir}OFL.txt`));
      expect(licence, id).toContain("SIL OPEN FONT LICENSE");
    }
  });

  it("resolves names and picks the nearest file", () => {
    expect(bundledFamily("Bebas Neue")).toBe("bebas-neue");
    expect(bundledFamily("bebas-neue")).toBe("bebas-neue");
    expect(bundledFamily("INTER")).toBe("inter");
    expect(bundledFamily("Helvetica")).toBeNull();
    expect(fontFileFor("space-mono", 800, false).path).toContain("Bold");
    expect(fontFileFor("instrument-serif", 400, true).path).toContain("Italic");
    expect(fontFileFor("anton", 400, true).italic).toBe(false);
  });
});

describe("typeset", () => {
  it("kerns pairs, including Inter's extension lookups", () => {
    const style = { family: "inter" as const, size: 100 };
    const pair = typeset(lib, "AV", style).width;
    const apart = typeset(lib, "A", style).width + typeset(lib, "V", style).width;
    expect(pair).toBeLessThan(apart - 2);
    expect(typeset(lib, "AV", { ...style, kerning: false }).width).toBeCloseTo(apart, 3);
    const anton = { family: "anton" as const, size: 100 };
    expect(typeset(lib, "To", anton).width).toBeLessThan(typeset(lib, "T", anton).width + typeset(lib, "o", anton).width - 1);
  });

  it("instances the variable face by weight and optical size", () => {
    const regular = typeset(lib, "Weight", { family: "inter", size: 80, weight: 400 });
    const black = typeset(lib, "Weight", { family: "inter", size: 80, weight: 900 });
    expect(black.width).toBeGreaterThan(regular.width * 1.05);
    const text = typeset(lib, "Optical", { family: "inter", size: 80, opticalSize: 14 });
    const display = typeset(lib, "Optical", { family: "inter", size: 80, opticalSize: 32 });
    // Inter's text cut is looser and wider than its display cut at the same size.
    expect(text.width).toBeGreaterThan(display.width);
    expect(typeset(lib, "Optical", { family: "inter", size: 80 }).width).toBeCloseTo(display.width, 3);
  });

  it("adds tracking between glyphs, not after the last", () => {
    const base = typeset(lib, "ABC", { family: "inter", size: 100 });
    const tracked = typeset(lib, "ABC", { family: "inter", size: 100, tracking: 0.1 });
    expect(tracked.width - base.width).toBeCloseTo(20, 3);
  });

  it("wraps without splitting words, balanced by default", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const style = { family: "inter" as const, size: 40 };
    const greedy = typeset(lib, text, style, { maxWidth: 600, wrap: "greedy" });
    const balanced = typeset(lib, text, style, { maxWidth: 600 });
    expect(balanced.lines.length).toBe(greedy.lines.length);
    expect(balanced.lines.length).toBeGreaterThan(1);
    const spread = (b: typeof greedy) => Math.max(...b.lines.map((l) => l.box.width)) - Math.min(...b.lines.map((l) => l.box.width));
    expect(spread(balanced)).toBeLessThanOrEqual(spread(greedy));
    for (const line of balanced.lines) expect(line.box.width).toBeLessThanOrEqual(600);
    expect(balanced.words.map((w) => w.text).join(" ")).toBe(text);
    expect(typeset(lib, "one\ntwo", style).lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  it("gives every word its glyphs, line and box; aligns lines", () => {
    const block = typeset(lib, "big small words", { family: "anton", size: 60, lineHeight: 1 }, { maxWidth: 250, align: "center" });
    expect(block.words.map((w) => w.text)).toEqual(["big", "small", "words"]);
    for (const w of block.words) {
      expect(block.glyphs.slice(w.first, w.end).map((g) => g.char).join("")).toBe(w.text);
      expect(w.box.x).toBeGreaterThanOrEqual(-1e-6);
      expect(w.box.x + w.box.width).toBeLessThanOrEqual(block.width + 1e-6);
    }
    for (const line of block.lines) expect(line.box.x + line.box.width / 2).toBeCloseTo(block.width / 2, 3);
    expect(block.lines[1]!.baseline - block.lines[0]!.baseline).toBeCloseTo(60, 6);
    const ink = inkBox(block.glyphs)!;
    expect(ink.y).toBeGreaterThanOrEqual(0);
    expect(ink.y + ink.height).toBeLessThanOrEqual(block.height + 1e-6);
  });

  it("falls back to Inter, lists characters nothing draws, slants a missing italic", () => {
    const block = typeset(lib, "Ω 🙂", { family: "bebas-neue", size: 50 });
    expect(block.missing).toEqual(["🙂"]);
    expect(block.glyphs.map((g) => g.char)).toEqual(["Ω"]);
    const upright = inkBox(typeset(lib, "l", { family: "inter", size: 100 }).glyphs)!;
    const oblique = inkBox(typeset(lib, "l", { family: "inter", size: 100, italic: true }).glyphs)!;
    expect(oblique.width).toBeGreaterThan(upright.width + 10);
  });

  it("fits a box: the largest size whose lines fit, or null", () => {
    const text = "Make every word count";
    const box = { width: 500, height: 300 };
    const fit = fitText(lib, text, { family: "anton" }, box, { maxSize: 400, minSize: 10 })!;
    expect(fit.width).toBeLessThanOrEqual(500);
    expect(fit.height).toBeLessThanOrEqual(300);
    const bigger = typeset(lib, text, { family: "anton", size: fit.style.size + 1 }, { maxWidth: 500 });
    expect(bigger.width > 500 || bigger.height > 300).toBe(true);
    expect(fitText(lib, text, { family: "anton" }, { width: 20, height: 10 }, { maxSize: 100, minSize: 10 })).toBeNull();
    expect(fitText(lib, text, { family: "anton" }, box, { maxSize: 400, maxLines: 1 })!.lines).toHaveLength(1);
  });

  it("sets a run with its spaces", () => {
    const run = setRun(lib, "a b", { family: "space-mono", size: 10 });
    expect(run.glyphs.map((g) => g.char)).toEqual(["a", " ", "b"]);
    expect(run.width).toBeCloseTo(3 * 6.12, 1);
  });
});

/** x coordinates of a path's points (every command's even arguments). */
function xsOf(d: string): number[] {
  const out: number[] = [];
  let i = 0;
  for (const t of d.split(" ")) {
    if (/^[A-Z]$/.test(t)) i = 0;
    else if (i++ % 2 === 0) out.push(Number(t));
  }
  return out;
}

describe("outlineSvgText", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">' +
    '<text x="200" y="100" font-family="\'Helvetica Neue\', Helvetica, sans-serif" font-size="40" font-weight="bold" text-anchor="middle" fill="#ffffff">Hello <tspan fill="#ff0000">world</tspan></text>' +
    '<text x="10" y="180" font-family="Menlo, monospace" font-size="20" fill="#cccccc">code</text>' +
    "</svg>";
  const pathsOf = (out: string) => [...out.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)].map((m) => ({ d: m[1]!, fill: m[2]! }));

  it("redraws resolved text as paths per run and keeps the text hidden", () => {
    const out = outlineSvgText(svg, lib, { family: (css) => (css === "Helvetica Neue" ? "inter" : null) });
    expect(out.outlined).toBe(1);
    expect(out.svg).toContain(`${OUTLINE_ATTR}="inter"`);
    const paths = pathsOf(out.svg);
    expect(paths.map((p) => p.fill)).toEqual(["#ffffff", "#ff0000"]);
    expect(out.svg).toMatch(/<text [^>]*display="none"[^>]*>Hello/);
    expect(out.svg).toMatch(/<text x="10"[^>]*>code<\/text>/);
    const xs = paths.flatMap((p) => xsOf(p.d));
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeGreaterThan(195);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeLessThan(205);
    expect(outlineSvgText(svg, lib, { family: () => null }).svg).toBe(svg);
  });

  it("shrinks a chunk to its width cap about its anchor", () => {
    const capped = outlineSvgText(svg, lib, { family: (css) => (css === "Helvetica Neue" ? "archivo-black" : null), maxWidth: () => 100 });
    const xs = pathsOf(capped.svg).flatMap((p) => xsOf(p.d));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(101);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(200, 0);
  });

  it("matches the cap height it is given", () => {
    const caps = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text x="0" y="100" font-family="sans" font-size="40">HIE</text></svg>';
    const out = outlineSvgText(caps, lib, { family: () => "anton", capHeight: 0.717 });
    const d = pathsOf(out.svg)[0]!.d;
    const ys = d.split(" ").filter((t) => !/^[A-Z]$/.test(t)).map(Number).filter((_, k) => k % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(100 - 0.717 * 40, 0);
    expect(Math.max(...ys)).toBeCloseTo(100, 0);
  });

  it("keeps the text's filter, clip, mask and opacity on its outlines", () => {
    const glow =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><defs><filter id="glow"/></defs>' +
      '<text id="t" x="0" y="100" font-family="Anton" font-size="40" opacity="0.5" style="fill:url(#gold);filter:url(#glow);clip-path:url(#c)" transform="rotate(5)">Gold</text></svg>';
    const out = outlineSvgText(glow, lib, { family: () => "anton" });
    const group = /<g [^>]*data-zenvi-outline="anton"[^>]*>/.exec(out.svg)![0];
    expect(group).toContain('id="t-outline"');
    expect(group).toContain('transform="rotate(5)"');
    expect(group).toContain('opacity="0.5"');
    expect(group).toContain('filter="url(#glow)"');
    expect(group).toContain('clip-path="url(#c)"');
    expect(group).not.toContain("mask");
    expect(out.svg).toContain('fill="url(#gold)"');
  });
});
