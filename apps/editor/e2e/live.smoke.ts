import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * After each deploy: the public editor loads, every library panel opens,
 * stock search answers (and the stock CDN serves the browser byte ranges),
 * local media imports and plays through "Make it snappy", and nothing logs
 * an error, fails a request or leaves one hanging. Signed out and read-only:
 * the only writes are to this test browser's storage.
 */

const API = process.env.ZENVI_LIVE_API || "https://api.zenvi.pro";
/** Requests that may fail without the editor being broken (analytics, aborted media previews). */
const NOISE = /sentry|google-analytics|googletagmanager|favicon|videos\.pexels\.com|cdn\.freesound\.org/;
const HANG_MS = 20_000;

interface Watch {
  problems: string[];
  hanging(): string[];
}

function watch(page: Page): Watch {
  const problems: string[] = [];
  const started = new Map<object, { at: number; url: string }>();
  page.on("pageerror", (e) => problems.push(`page error: ${String(e).slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.location().url ?? "")) problems.push(`console error: ${m.text().slice(0, 300)}`);
  });
  page.on("request", (r) => started.set(r, { at: Date.now(), url: r.url() }));
  page.on("requestfinished", (r) => started.delete(r));
  page.on("requestfailed", (r) => {
    started.delete(r);
    // ERR_ABORTED: the editor cancelled it (a search replaced by a newer one).
    const error = r.failure()?.errorText ?? "";
    if (!NOISE.test(r.url()) && !error.includes("ERR_ABORTED")) problems.push(`request failed: ${r.method()} ${r.url().slice(0, 160)} (${error})`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !NOISE.test(r.url())) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().slice(0, 160)}`);
  });
  return {
    problems,
    hanging: () => [...started.values()].filter((s) => Date.now() - s.at > HANG_MS && !NOISE.test(s.url)).map((s) => `hanging ${Math.round((Date.now() - s.at) / 1000)} s: ${s.url.slice(0, 160)}`),
  };
}

function fixture(): { dir: string; video: string } | null {
  const dir = mkdtempSync(join(tmpdir(), "zenvi-live-smoke-"));
  const video = join(dir, "smoke.webm");
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libvpx-vp9", "-b:v", "400k", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-shortest", video]);
    return { dir, video };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
}

const library = (page: Page) => page.getByRole("navigation", { name: "Library sections" });

test("the live editor works for a signed-out visitor", async ({ page, request }) => {
  const seen = watch(page);

  await test.step("backend is up", async () => {
    expect((await request.get(`${API}/health`)).status()).toBe(200);
  });

  await test.step("editor opens a new vertical project", async () => {
    await page.goto("", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Vertical/ }).first().click();
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  });

  await test.step("every library panel opens", async () => {
    for (const [tab, heading] of [
      [/Effects/, "Effects"],
      [/Transitions/, "Transitions"],
      [/^Sound/, "Sound"],
      [/Titles/, "Titles"],
      [/Motion and 3D/, "Motion & 3D"],
      [/Generate with AI/, "Generate"],
      [/Stock media/, "Stock"],
    ] as const) {
      await library(page).getByRole("button", { name: tab }).click();
      await expect(page.getByRole("complementary", { name: "Library" }).getByText(heading, { exact: true }).first()).toBeVisible();
    }
  });

  await test.step("stock video search answers", async () => {
    const search = page.getByLabel("Search stock media");
    await search.fill("ocean waves");
    await search.press("Enter");
    await expect(page.getByTitle("Import to Project Files").first()).toBeVisible();
  });

  await test.step("stock music search answers and its CDN serves byte ranges to the page", async () => {
    await page.getByText("Music & sound", { exact: true }).click();
    const search = page.getByLabel("Search stock media");
    await search.fill("piano");
    await search.press("Enter");
    await expect(page.getByRole("button", { name: /^Play / }).first()).toBeVisible();
    // What a stock import downloads first (apps/editor/src/lib/download.ts): a CORS ranged GET.
    const probe = await page.evaluate(async (api) => {
      const found = await (await fetch(`${api}/api/v1/freesound/search?query=piano&page_size=1&page=1`)).json();
      const url = found.sounds?.[0]?.previews?.hq_mp3;
      if (!url) return "no preview url";
      const response = await fetch(url, { headers: { Range: "bytes=0-1023" } });
      return `${response.status} ${(await response.arrayBuffer()).byteLength}`;
    }, API);
    expect(probe).toBe("206 1024");
  });

  const media = fixture();
  await test.step("local media imports and Make it snappy runs", async () => {
    test.skip(!media, "ffmpeg is not installed");
    await library(page).getByRole("button", { name: /Project files/ }).click();
    await page.locator("input[type=file]").first().setInputFiles(media!.video);
    const card = page.locator("[role=button][aria-pressed]").first();
    await expect(card).toBeVisible();
    await card.dblclick();
    await card.dblclick();
    await page.getByRole("button", { name: /Make it snappy/ }).click();
    await expect(page.getByText(/Made it snappy|Nothing to make snappy/).first()).toBeVisible({ timeout: 60_000 });
  });
  if (media) rmSync(media.dir, { recursive: true, force: true });

  await test.step("the Assistant asks a visitor to sign in", async () => {
    await page.getByRole("tab", { name: /Assistant/ }).or(page.getByRole("button", { name: /^Assistant/ })).first().click();
    await expect(page.getByRole("button", { name: /Sign in/ }).last()).toBeVisible();
  });

  await test.step("no errors, failed or hanging requests", async () => {
    expect([...seen.problems, ...seen.hanging()]).toEqual([]);
  });
});
