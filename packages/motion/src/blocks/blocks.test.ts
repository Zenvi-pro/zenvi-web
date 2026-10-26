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

describe("dock_magnify", () => {
  it("keeps each icon's colour at its dock position when one colour is malformed", async () => {
    const { build } = await import("./dock_magnify/block.js");
    const manifest = BLOCKS.find((b) => b.id === "dock_magnify")!;
    const checked = checkParams(manifest, { colors: ["#112233", "red", "#445566"] });
    if (!checked.ok) throw new Error(checked.error);
    const ctx = createContext(document, { block: "dock_magnify", params: checked.params, width: 1080, height: 1920, fps: 30, seconds: 4.5, alpha: false, media: {}, draft: false });
    await build(ctx);
    const faces = Array.from(ctx.root.querySelectorAll<HTMLElement>(".dm-face")).map((f) => f.style.background);
    // jsdom serialises the hex colours as rgb().
    expect(faces[0]).toContain("rgb(17, 34, 51)");
    expect(faces[1]).toContain("rgb(47, 192, 168)");
    expect(faces[2]).toContain("rgb(68, 85, 102)");
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

describe("chart_build's change badge", () => {
  it("is left out when the highlight is the first bar (nothing to compare it with)", async () => {
    expect((await built("chart_build", { values: ["9", "3", "4"] }, 5)).root.querySelector(".cb-badge")).toBeNull();
    expect((await built("chart_build", { values: ["3", "9", "4"] }, 5)).root.querySelector(".cb-badge")?.textContent).toBe("+200% vs Jan");
  });
});
