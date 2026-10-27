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
const CANVAS_ONLY = new Set(["gradient_field", "line_trails"]);

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
});

describe.each(BLOCKS.map((b) => [b.id, b] as const))("%s with blank list items", (id, manifest) => {
  const lists = Object.entries(manifest.params).filter(([, spec]) => spec.type === "strings").map(([name]) => name);
  it.skipIf(lists.length === 0)("builds and seeks", async () => {
    const mod = (await import(`./${id}/block.ts`)) as { build: BlockBuild };
    const checked = checkParams(manifest, Object.fromEntries(lists.map((name) => [name, [" "]])));
    if (!checked.ok) return;
    const ctx = createContext(document, { block: id, params: checked.params, width: 1080, height: 1920, fps: 30, seconds: manifest.duration.default, alpha: manifest.alpha, media: {}, draft: false });
    await mod.build(ctx);
    ctx.tl.seek(manifest.duration.default / 2);
  });
});
