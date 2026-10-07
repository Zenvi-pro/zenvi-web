import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const shots = join(fileURLToPath(new URL(".", import.meta.url)), "__screenshots__");

function fixture(name: string): string {
  const dir = process.env.ZENVI_E2E_FIXTURES;
  if (!dir) throw new Error("fixtures not generated (global setup)");
  return join(dir, name);
}

interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  worst: number;
  longTasks: number[];
}

/** Record animation-frame intervals and long tasks for `ms` while `action` runs. */
async function measure(page: Page, ms: number, action: () => Promise<void>): Promise<FrameStats> {
  const recording = page.evaluate(async (duration) => {
    const intervals: number[] = [];
    const longTasks: number[] = [];
    let last = performance.now();
    let running = true;
    const loop = (t: number) => {
      intervals.push(t - last);
      last = t;
      if (running) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(Math.round(e.duration));
    });
    try {
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask not supported
    }
    await new Promise((r) => setTimeout(r, duration));
    running = false;
    observer.disconnect();
    const sorted = [...intervals.slice(2)].sort((a, b) => a - b);
    const at = (q: number) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) * 10) / 10;
    return { frames: sorted.length, p50: at(0.5), p95: at(0.95), worst: at(1), longTasks };
  }, ms);
  await action();
  return recording;
}

test("a 30-minute, 300-clip timeline stays smooth while scrubbing and scrolling", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("zenvi.debug", "1"));
  await page.goto("/editor/");
  await page.getByRole("button", { name: /HD 1080p/ }).click();
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  await page.locator('input[type="file"][multiple][accept*="video"]').first().setInputFiles(fixture("pattern.webm"));
  await expect(page.getByRole("button", { name: "pattern.webm", exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { __zenvi?: unknown }).__zenvi));

  // 300 clips on three tracks, 100 per track every 18 s: 30 minutes.
  await page.evaluate(() => {
    type Debug = {
      session: { project: { files: { id: string }[]; layers: { number: number }[] }; edit: (l: string, fn: (tx: unknown) => void) => void; ui: { setState: (s: unknown) => void } };
      engine: { addClip: (tx: unknown, input: { fileId: string; position: number; layer: number }) => unknown };
    };
    const { session, engine } = (window as unknown as { __zenvi: Debug }).__zenvi;
    const fileId = session.project.files[0]!.id;
    const layers = session.project.layers.map((l) => l.number).sort((a, b) => b - a).slice(0, 3);
    session.edit("Stress", (tx) => {
      for (let i = 0; i < 300; i += 1) engine.addClip(tx, { fileId, position: Math.floor(i / 3) * 18, layer: layers[i % 3]! });
    });
  });
  await expect(page.locator('[data-kind="clip"]').first()).toBeVisible();
  // The first clips on an empty timeline are fitted into view; then zoom in to ~100 s per screen.
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    (window as unknown as { __zenvi: { session: { ui: { setState: (s: unknown) => void } } } }).__zenvi.session.ui.setState({ pxPerSecond: 12 });
  });
  await page.waitForTimeout(1500);
  const rendered = await page.locator('[data-kind="clip"]').count();
  expect(rendered).toBeLessThan(120); // virtualized: only clips near the view are in the DOM

  // Scrub the ruler left to right.
  const ruler = page.getByRole("slider", { name: /Timeline ruler/ });
  const box = (await ruler.boundingBox())!;
  const scrub = await measure(page, 3000, async () => {
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i <= 120; i += 1) {
      await page.mouse.move(box.x + 10 + ((box.width - 20) * i) / 120, box.y + box.height / 2);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
  });

  // Scroll the whole timeline horizontally.
  const viewport = page.getByLabel("Timeline tracks");
  const scroll = await measure(page, 3000, async () => {
    await viewport.hover();
    for (let i = 0; i < 60; i += 1) {
      await page.mouse.wheel(400, 0);
      await page.waitForTimeout(30);
    }
  });

  await page.screenshot({ path: join(shots, "11-stress-300-clips.png") });
  const report = { clipsInProject: 300, clipsInDom: rendered, scrub, scroll };
  writeFileSync(join(shots, "perf.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));

  // Generous bounds for headless Chromium on a shared CI box; the report has the numbers.
  expect(scrub.p50).toBeLessThan(34);
  expect(scroll.p50).toBeLessThan(34);
  expect(Math.max(0, ...scrub.longTasks, ...scroll.longTasks)).toBeLessThan(400);
});
