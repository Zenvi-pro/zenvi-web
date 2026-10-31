import { rmSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { videoFixture, watch } from "./support/live";

/**
 * After each deploy: the public editor loads, every library panel opens,
 * stock search answers (and the stock CDN serves the browser byte ranges),
 * local media imports and plays through "Make it snappy", and nothing logs
 * an error, fails a request or leaves one hanging. Signed out and read-only:
 * the only writes are to this test browser's storage.
 */

/** The editor's backend; another editor (ZENVI_LIVE_URL) skips the health check unless this is set too. */
const API = process.env.ZENVI_LIVE_API || (process.env.ZENVI_LIVE_URL ? "" : "https://api.zenvi.pro");

const library = (page: Page) => page.getByRole("navigation", { name: "Library sections" });

test("the live editor works for a signed-out visitor", async ({ page, request }) => {
  const seen = watch(page);

  if (API) {
    await test.step("backend is up", async () => {
      expect((await request.get(`${API}/health`)).status()).toBe(200);
    });
  }

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
    // The editor's own search (direct or through its same-origin proxy), so its CORS is the editor's.
    const searched = page.waitForResponse((r) => r.url().includes("/freesound/search") && r.url().includes("piano"));
    await search.press("Enter");
    const url: unknown = (await (await searched).json()).sounds?.[0]?.previews?.hq_mp3;
    expect(url, "a preview URL in the search results").toEqual(expect.any(String));
    await expect(page.getByRole("button", { name: /^Play / }).first()).toBeVisible();
    // What a stock import downloads first (apps/editor/src/lib/download.ts): a CORS ranged GET.
    const probe = await page.evaluate(async (preview) => {
      const response = await fetch(preview, { headers: { Range: "bytes=0-1023" } });
      return `${response.status} ${(await response.arrayBuffer()).byteLength}`;
    }, url as string);
    expect(probe).toBe("206 1024");
  });

  // Without ffmpeg only this step is skipped (test.skip would skip the checks after it too).
  const media = videoFixture("zenvi-live-smoke-");
  if (!media) test.info().annotations.push({ type: "skipped step", description: "local media import: ffmpeg is not installed" });
  else await test.step("local media imports and Make it snappy runs", async () => {
    await library(page).getByRole("button", { name: /Project files/ }).click();
    await page.locator("input[type=file]").first().setInputFiles(media.video);
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
