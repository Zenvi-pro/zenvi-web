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
const CANVAS_ONLY = new Set(["gradient_field"]);

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

/** Build `id` on 9:16 with `params`, for `seconds`. */
async function built(id: string, params: Record<string, unknown>, seconds: number): Promise<{ root: HTMLElement; seek: (t: number) => void }> {
  const manifest = BLOCKS.find((b) => b.id === id)!;
  const mod = (await import(`./${id}/block.ts`)) as { build: BlockBuild };
  const checked = checkParams(manifest, params);
  if (!checked.ok) throw new Error(checked.error);
  const ctx = createContext(document, { block: id, params: checked.params, width: 1080, height: 1920, fps: 30, seconds, alpha: manifest.alpha, media: {}, draft: false });
  await mod.build(ctx);
  return { root: ctx.root, seek: (t) => ctx.tl.seek(t) };
}

describe("blocks with the most items they take still land their climax before the exit", () => {
  it("cursor_path reaches its last stop at the default length", async () => {
    const points = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 }];
    const b = await built("cursor_path", { points, zoom: 1 }, 6);
    b.seek(6 - 0.4);
    const cursor = b.root.querySelector<HTMLElement>(".cursor")!;
    // The last stop in the drawn screen's space (1080 × 72 % of 1920 from 10 %), less the 88 px pointer's tip offset.
    expect(parseFloat(cursor.style.left)).toBeCloseTo(0.2 * 1080 - (88 * 6) / 28, 1);
    expect(parseFloat(cursor.style.top)).toBeCloseTo(192 + 0.3 * 1920 * 0.72 - (88 * 3.5) / 28, 1);
  });
  it("notification_stack lands its last card at the shortest length", async () => {
    const b = await built("notification_stack", { items: ["A: 1", "B: 2", "C: 3", "D: 4", "E: 5", "F: 6"] }, 2.5);
    b.seek(2.5 - 0.4);
    const cards = b.root.querySelectorAll<HTMLElement>(".ns-card");
    expect(cards[cards.length - 1]!.style.opacity).toBe("1");
  });
  it("toggle_panel shows its done state with every row off at the default length", async () => {
    const b = await built("toggle_panel", { rows: ["A", "B", "C", "D", "E", "F"] }, 5);
    b.seek(5 - 0.4);
    expect(b.root.querySelector(".tp-count")!.textContent).toBe("All on");
    expect((b.root.querySelectorAll<HTMLElement>(".tp-tile .icon")[1]!).style.opacity).toBe("1");
  });
});
