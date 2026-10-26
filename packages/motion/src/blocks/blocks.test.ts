// @vitest-environment jsdom
/**
 * Every block builds with its defaults (jsdom has no layout, so sizes are 0:
 * this checks wiring and determinism, the render smoke test checks pixels).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BLOCKS } from "../catalog.js";
import { checkParams } from "../params.js";
import { createContext, type BlockBuild } from "../runtime/index.js";

/** Blocks that draw only into a canvas, which jsdom does not paint. */
const CANVAS_ONLY = new Set(["gradient_field", "ripple_logo"]);

/** The root's HTML with each style attribute's declarations sorted (setting a property again may move it). */
function normalized(root: HTMLElement): string {
  return root.outerHTML.replace(/style="([^"]*)"/g, (_, css: string) => `style="${css.split(";").map((d) => d.trim()).filter(Boolean).sort().join("; ")}"`);
}


beforeEach(() => {
  document.body.innerHTML = "";
});

describe.each(BLOCKS.map((b) => [b.id, b] as const))("%s", (id, manifest) => {
  it("builds and seeks deterministically on 9:16 and 16:9", async () => {
    const mod = (await import(`./${id}/block.ts`)) as { build?: BlockBuild };
    expect(typeof mod.build, `${id}/block.ts exports build`).toBe("function");
    for (const [width, height] of [[1080, 1920], [1920, 1080]] as const) {
      document.body.innerHTML = "";
      const checked = checkParams(manifest, {});
      if (!checked.ok) throw new Error(checked.error);
      const ctx = createContext(document, { block: id, params: checked.params, width, height, fps: 30, seconds: manifest.duration.default, alpha: manifest.alpha, media: {}, draft: false });
      await mod.build!(ctx);
      const frame = (t: number): string => {
        ctx.tl.seek(t);
        return normalized(ctx.root);
      };
      const mid = manifest.duration.default / 2;
      const a = frame(mid);
      frame(0);
      frame(manifest.duration.default);
      expect(frame(mid)).toBe(a);
      if (!CANVAS_ONLY.has(id)) expect(frame(0)).not.toBe(a);
    }
  });

  it("builds at the seed bounds and its shortest and longest length", async () => {
    const mod = (await import(`./${id}/block.ts`)) as { build: BlockBuild };
    for (const seed of [0, 2147483647]) {
      for (const seconds of [manifest.duration.min, manifest.duration.max]) {
        document.body.innerHTML = "";
        const checked = checkParams(manifest, { seed });
        if (!checked.ok) throw new Error(checked.error);
        const ctx = createContext(document, { block: id, params: checked.params, width: 1080, height: 1920, fps: 30, seconds, alpha: manifest.alpha, media: {}, draft: false });
        await mod.build(ctx);
        for (const t of [0, seconds / 2, seconds]) ctx.tl.seek(t);
      }
    }
  });
});

describe("card_shuffle", () => {
  it("lands on a picture when given one file", async () => {
    const { build } = await import("./card_shuffle/block.js");
    const manifest = BLOCKS.find((b) => b.id === "card_shuffle")!;
    const checked = checkParams(manifest, {});
    if (!checked.ok) throw new Error(checked.error);
    const media = { media_1: { kind: "image" as const, url: "data:image/png;base64,iVBORw0KGgo=", width: 600, height: 800 } };
    const ctx = createContext(document, { block: "card_shuffle", params: checked.params, width: 1080, height: 1920, fps: 30, seconds: 4.5, alpha: false, media, draft: false });
    await build(ctx);
    ctx.tl.seek(4.5);
    const shown = Array.from(ctx.root.querySelectorAll<HTMLImageElement>(".cs-card img")).filter((img) => img.style.opacity !== "0");
    expect(shown).toHaveLength(1);
  });
});
