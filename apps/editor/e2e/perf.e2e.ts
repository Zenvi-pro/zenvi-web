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

interface PlaybackStats {
  /** Whether the preview composited in a Worker. */
  worker: boolean;
  /** Main-thread animation frames: count and intervals, ms. */
  raf: { frames: number; p50: number; p95: number; worst: number };
  /** Main-thread tasks over 50 ms. */
  longTasks: { count: number; worst: number; totalMs: number };
  /** Frames the preview drew per second of playback. */
  presentedFps: number;
  /** Resolution scale of the last playback frame (adaptive playback resolution). */
  playbackScale: number;
  /** Keydown → handler delays while typing during playback, ms. */
  inputDelay: { p50: number; p95: number; worst: number };
  /** Event Timing entries (keystroke → next paint) of 16 ms or more. */
  slowEvents: { count: number; worst: number };
}

/** Play `ms` of the open project while typing into a text field; main-thread numbers plus frames presented. */
async function playAndType(page: Page, ms: number): Promise<PlaybackStats> {
  type Debug = { __zenvi: { session: { play: () => void; pause: () => void; engine: { stats?: () => { presented: number; worker: boolean; scale: number } } } } };
  const recording = page.evaluate(async (duration) => {
    const intervals: number[] = [];
    const longTasks: number[] = [];
    const slowEvents: number[] = [];
    const delays: number[] = [];
    const field = document.createElement("input");
    field.setAttribute("aria-label", "perf typing field");
    field.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;width:200px";
    field.addEventListener("keydown", (e) => delays.push(performance.now() - e.timeStamp));
    document.body.appendChild(field);
    field.focus();
    let last = performance.now();
    let running = true;
    const loop = (t: number) => {
      intervals.push(t - last);
      last = t;
      if (running) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const tasks = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(Math.round(e.duration));
    });
    const events = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === "keydown" || e.name === "keypress" || e.name === "input") slowEvents.push(Math.round(e.duration));
    });
    try {
      tasks.observe({ entryTypes: ["longtask"] });
      events.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
    } catch {
      // not supported
    }
    const { session } = (window as unknown as Debug).__zenvi;
    const presentedBefore = session.engine.stats?.().presented ?? 0;
    const started = performance.now();
    session.play();
    await new Promise((r) => setTimeout(r, duration));
    // A busy main thread fires the timer late: rates use the time that really passed.
    const elapsed = performance.now() - started;
    const presented = (session.engine.stats?.().presented ?? 0) - presentedBefore;
    const worker = session.engine.stats?.().worker ?? false;
    const playbackScale = session.engine.stats?.().scale ?? 1;
    session.pause();
    running = false;
    tasks.disconnect();
    events.disconnect();
    field.remove();
    const q = (values: number[], at: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return Math.round((sorted[Math.min(sorted.length - 1, Math.floor(at * sorted.length))] ?? 0) * 10) / 10;
    };
    const frames = intervals.slice(2);
    return {
      worker,
      playbackScale,
      presentedFps: Math.round((presented / (elapsed / 1000)) * 10) / 10,
      raf: { frames: frames.length, p50: q(frames, 0.5), p95: q(frames, 0.95), worst: q(frames, 1) },
      longTasks: { count: longTasks.length, worst: Math.max(0, ...longTasks), totalMs: longTasks.reduce((a, b) => a + b, 0) },
      slowEvents: { count: slowEvents.length, worst: Math.max(0, ...slowEvents) },
      inputDelay: { p50: q(delays, 0.5), p95: q(delays, 0.95), worst: q(delays, 1) },
    };
  }, ms);
  // Type while it plays (letters only: Space would toggle playback).
  await page.waitForTimeout(300);
  await page.keyboard.type("thequickbrownfoxjumpsoverthelazydog".repeat(2), { delay: 60 });
  return recording;
}

test.describe("heavy effects preview", () => {
  test("a 1080p timeline with Blur + ColorShift + Glow on every clip plays without blocking typing", async ({ browser }) => {
    const report: Record<string, PlaybackStats> = {};
    // "main" composites on the main thread (the fallback); "auto" is what the editor picks (a Worker where supported).
    for (const mode of ["main", "auto"] as const) {
      const context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.addInitScript((m) => {
        localStorage.setItem("zenvi.debug", "1");
        if (m === "main") localStorage.setItem("zenvi.preview", "main");
      }, mode);
      await page.goto(`http://127.0.0.1:${process.env.ZENVI_E2E_PORT}/editor/`);
      await page.getByRole("button", { name: /HD 1080p/ }).click();
      await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
      await page.locator('input[type="file"][multiple][accept*="video"]').first().setInputFiles(fixture("hd.webm"));
      await expect(page.getByRole("button", { name: "hd.webm", exact: true })).toBeVisible();
      await page.waitForFunction(() => Boolean((window as unknown as { __zenvi?: unknown }).__zenvi));

      // Four 6 s clips back to back, each with Blur, ColorShift and Glow: 24 s.
      await page.evaluate(() => {
        type Debug = {
          session: { project: { files: { id: string }[]; layers: { number: number }[] }; edit: (l: string, fn: (tx: unknown) => void) => void; seek: (t: number) => void };
          engine: {
            addClip: (tx: unknown, input: { fileId: string; position: number; layer: number }) => { id: string };
            addEffect: (tx: unknown, clipId: string, type: string, params?: Record<string, number>) => unknown;
          };
        };
        const { session, engine } = (window as unknown as { __zenvi: Debug }).__zenvi;
        const fileId = session.project.files[0]!.id;
        const layer = Math.max(...session.project.layers.map((l) => l.number));
        session.edit("Heavy", (tx) => {
          for (let i = 0; i < 4; i += 1) {
            const clip = engine.addClip(tx, { fileId, position: i * 6, layer });
            engine.addEffect(tx, clip.id, "Blur");
            engine.addEffect(tx, clip.id, "ColorShift", { red_x: 0.02, blue_y: -0.02 });
            engine.addEffect(tx, clip.id, "Glow");
          }
        });
        session.seek(0);
      });
      await expect(page.locator('[data-kind="clip"]')).toHaveCount(4);
      await page.waitForTimeout(1500);
      report[mode] = await playAndType(page, 6000);
      await context.close();
    }
    writeFileSync(join(shots, "perf-heavy.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    // The Worker path must keep the main thread free and present at least as many frames
    // (a little slack: the two runs share one loaded machine).
    const main = report.main!;
    const auto = report.auto!;
    expect(main.worker).toBe(false);
    expect(auto.worker).toBe(true);
    expect(auto.longTasks.worst).toBeLessThan(100);
    expect(auto.presentedFps).toBeGreaterThanOrEqual(main.presentedFps * 0.8);
  });
});
