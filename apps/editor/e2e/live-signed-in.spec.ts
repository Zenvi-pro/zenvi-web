import { statSync, rmSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { videoFixture, watch } from "./support/live";

/**
 * After each deploy, signed in: a voiceover, captions from the clip menu and
 * from the Assistant, the Assistant inspecting the timeline and generating
 * an image, AI video (opt-in), and an export. It spends the account's
 * credits (a voiceover, an image and a few Assistant turns; a video is
 * ~140 more), and writes only to the test browser's storage.
 *
 *   ZENVI_LIVE_SESSION="$(cat ~/zenvi-motion/bench/.state/config/auth.json)" \
 *     npx playwright test -c apps/editor/e2e/live.config.ts live-signed-in
 *
 * ZENVI_LIVE_SESSION is a Supabase session as JSON ({access_token,
 * refresh_token, expires_at?}), read at run time and never written anywhere.
 * ZENVI_LIVE_VIDEO=panel generates a video from the Generate panel,
 * ZENVI_LIVE_VIDEO=assistant asks the Assistant for one.
 */

// A retry would spend the credits again.
test.describe.configure({ retries: 0 });

interface Session {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

function jwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** The session as the editor's supabase-js stores it (`sb-<project ref>-auth-token`, src/lib/auth.ts). */
function storedSession(raw: string): { key: string; value: string } {
  const session = JSON.parse(raw) as Session;
  if (!session.access_token || !session.refresh_token) throw new Error("ZENVI_LIVE_SESSION needs access_token and refresh_token");
  const claims = jwtClaims(session.access_token);
  const ref = new URL(String(claims.iss)).hostname.split(".")[0];
  const expiresAt = Number(session.expires_at ?? claims.exp);
  const user = { id: claims.sub, email: claims.email, aud: claims.aud, role: claims.role, app_metadata: claims.app_metadata ?? {}, user_metadata: claims.user_metadata ?? {} };
  const value = { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: expiresAt, expires_in: expiresAt - Math.floor(Date.now() / 1000), token_type: "bearer", user };
  return { key: `sb-${ref}-auth-token`, value: JSON.stringify(value) };
}

const library = (page: Page) => page.getByRole("navigation", { name: "Library sections" });
const libraryPanel = (page: Page) => page.getByRole("complementary", { name: "Library" });
/** Open a library section; its button toggles, so an open section is left open. */
async function openSection(page: Page, button: RegExp, heading: string): Promise<void> {
  const title = libraryPanel(page).getByText(heading, { exact: true }).first();
  if (await title.isVisible()) return;
  await library(page).getByRole("button", { name: button }).click();
  await expect(title).toBeVisible();
}

const toast = (page: Page, text: RegExp) => page.locator("div[aria-live=polite].fixed").getByText(text).first();

/** Send one ask to the Assistant and wait for its reply; the text from the ask on. */
async function ask(page: Page, question: string, timeout = 240_000): Promise<string> {
  const box = page.getByPlaceholder(/Ask Zenvi/);
  await box.fill(question);
  await box.press("Enter");
  const stop = page.getByRole("button", { name: /Stop/ });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await expect(stop).toBeHidden({ timeout });
  const panel = await page.locator("[aria-live=polite]").filter({ hasText: question }).innerText();
  return panel.slice(panel.lastIndexOf(question) + question.length);
}

/** The result line under each run of the tool titled `title` in a reply. */
function toolResults(reply: string, title: string): string[] {
  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.flatMap((line, i) => (line === title && lines[i + 1] ? [lines[i + 1]!] : []));
}

test("the live editor works for a signed-in user", async ({ page }) => {
  // AI generation and an export.
  test.setTimeout(900_000);
  const raw = process.env.ZENVI_LIVE_SESSION;
  test.skip(!raw, "set ZENVI_LIVE_SESSION to a Supabase session (JSON)");
  const { key, value } = storedSession(raw!);
  await page.addInitScript(([k, v]) => {
    if (!localStorage.getItem(k)) localStorage.setItem(k, v);
  }, [key, value] as const);
  const seen = watch(page);
  const media = videoFixture("zenvi-live-signed-in-");
  test.skip(!media, "needs ffmpeg for the test video");

  try {
    await test.step("editor opens a new vertical project, signed in", async () => {
      await page.goto("", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Vertical/ }).first().click();
      await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
      await page.getByRole("tab", { name: /Assistant/ }).or(page.getByRole("button", { name: /^Assistant/ })).first().click();
      await expect(page.getByPlaceholder(/Ask Zenvi/)).toBeVisible();
    });

    await test.step("a video goes on the timeline", async () => {
      await page.locator("input[type=file]").first().setInputFiles(media!.video);
      await openSection(page, /Project files/, "Project files");
      const card = libraryPanel(page).locator("[role=button][aria-pressed]").first();
      await expect(card).toBeVisible();
      await card.dblclick();
      await expect(page.getByRole("region", { name: "Timeline" }).getByText("smoke.webm")).toBeVisible();
    });

    await test.step("Generate: a voiceover lands at the playhead", async () => {
      await openSection(page, /Generate with AI/, "Generate");
      await libraryPanel(page).getByLabel("Voiceover text").fill("Captions should follow every word of this voiceover.");
      await libraryPanel(page).getByRole("button", { name: "Generate voiceover" }).click();
      const outcome = toast(page, /Voiceover added|Voiceover failed/);
      await expect(outcome).toBeVisible({ timeout: 60_000 });
      expect(await outcome.innerText()).toMatch(/Voiceover added/);
    });

    await test.step("clip menu: captions on the voiceover", async () => {
      await page.getByRole("region", { name: "Timeline" }).getByText(/^Narration/).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Captions" }).hover();
      await page.getByRole("menuitem", { name: "Classic subtitles" }).click();
      // Wait for either outcome, so a failure shows the editor's reason.
      const outcome = toast(page, /Captions added|Could not add captions/);
      await expect(outcome).toBeVisible({ timeout: 60_000 });
      expect(await outcome.innerText()).toMatch(/Captions added/);
    });

    await test.step("Assistant: add captions", async () => {
      const reply = await ask(page, "Add captions to the narration clip");
      const results = toolResults(reply, "Add captions");
      expect(results.length, reply).toBeGreaterThan(0);
      expect(results.at(-1), reply).toMatch(/^Added \d+ caption/);
      expect(reply).not.toContain("Invalid arguments for add_captions_tool");
    });

    await test.step("Assistant: inspect the timeline", async () => {
      const reply = await ask(page, "Inspect the timeline visually and tell me what you see in the frames");
      const results = toolResults(reply, "Inspect timeline");
      expect(results[0], reply).toMatch(/^Rendered \d+ inspect image/);
      expect(reply).not.toContain("Invalid arguments for inspect_timeline_tool");
    });

    await test.step("Assistant: generate an image", async () => {
      const reply = await ask(page, "Generate an image of a lighthouse at dusk and put it on the timeline after the video");
      const results = toolResults(reply, "Generate image");
      expect(results.length, reply).toBeGreaterThan(0);
      expect(results.at(-1), reply).not.toMatch(/^Error/);
    });

    const video = process.env.ZENVI_LIVE_VIDEO;
    if (video === "panel") {
      await test.step("Generate: AI video lands on the timeline", async () => {
        await openSection(page, /Generate with AI/, "Generate");
        await libraryPanel(page).getByLabel("Video prompt").fill("Waves rolling onto a beach at dawn, soft golden light");
        await libraryPanel(page).getByRole("radio", { name: "9:16" }).click();
        await libraryPanel(page).getByRole("button", { name: "Generate video" }).click();
        const outcome = toast(page, /AI video added|Video generation failed/);
        await expect(outcome).toBeVisible({ timeout: 360_000 });
        expect(await outcome.innerText()).toMatch(/AI video added/);
      });
    } else if (video === "assistant") {
      await test.step("Assistant: generate a video", async () => {
        const reply = await ask(page, "Generate a 5 second video of waves at dawn", 420_000);
        const results = toolResults(reply, "Generate video");
        expect(results.length, reply).toBeGreaterThan(0);
        expect(results.at(-1), reply).not.toMatch(/^Error/);
      });
    }

    await test.step("export downloads a video", async () => {
      await page.getByRole("button", { name: "Export", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Export video" });
      await expect(dialog).toBeVisible();
      const download = page.waitForEvent("download", { timeout: 300_000 });
      await dialog.getByRole("button", { name: "Export", exact: true }).click();
      expect(statSync(await (await download).path()).size).toBeGreaterThan(10_000);
    });

    await test.step("no errors, failed or hanging requests", async () => {
      expect([...seen.problems, ...seen.hanging()]).toEqual([]);
    });
  } finally {
    rmSync(media!.dir, { recursive: true, force: true });
  }
});
