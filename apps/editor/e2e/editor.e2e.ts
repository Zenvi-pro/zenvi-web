import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const shots = join(fileURLToPath(new URL(".", import.meta.url)), "__screenshots__");
const mod = process.platform === "darwin" ? "Meta" : "Control";

function fixture(name: string): string {
  const dir = process.env.ZENVI_E2E_FIXTURES;
  if (!dir) throw new Error("fixtures not generated (global setup)");
  return join(dir, name);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const clips = (page: Page) => page.locator('[data-kind="clip"]');
const timecode = (page: Page) => page.getByRole("region", { name: "Timeline" }).locator("span.font-mono").first();

test("new project → import → arrange → split → undo → play → export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Projects home.
  await page.goto("/editor/");
  await expect(page.getByRole("heading", { name: "Make something." })).toBeVisible();
  await shot(page, "01-home");

  // New 1080p project.
  await page.getByRole("button", { name: /HD 1080p/ }).click();
  await expect(page).toHaveURL(/\/editor\/p\/[a-z0-9]{12}$/);
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  await shot(page, "02-editor-empty");

  // Import a VP9 WebM through the file picker.
  await page.locator('input[type="file"][multiple][accept*="video"]').first().setInputFiles(fixture("pattern.webm"));
  const tile = page.getByRole("button", { name: "pattern.webm", exact: true });
  await expect(tile).toBeVisible();

  // Add it to the timeline.
  await tile.dblclick();
  await expect(clips(page)).toHaveCount(1);
  await expect(page.getByText("Your video appears here")).toBeHidden();
  await page.waitForTimeout(1500);
  await shot(page, "03-editor-clip");

  // Select the clip, move the playhead to 2 s, slice (Ctrl/⌘+K).
  await clips(page).first().click();
  const ruler = page.getByRole("slider", { name: /Timeline ruler/ });
  const box = (await ruler.boundingBox())!;
  const pps = await page.evaluate(() => {
    const el = document.querySelector('[data-kind="clip"]') as HTMLElement | null;
    return el ? el.getBoundingClientRect().width / 4 : 0;
  });
  await page.mouse.click(box.x + pps * 2, box.y + box.height / 2);
  await page.keyboard.press(`${mod}+K`);
  await expect(clips(page)).toHaveCount(2);
  await shot(page, "04-split");

  // Undo restores one clip.
  await page.keyboard.press(`${mod}+Z`);
  await expect(clips(page)).toHaveCount(1);

  // Play for a moment: the playhead moves.
  await page.keyboard.press("Home");
  const before = await timecode(page).textContent();
  await page.keyboard.press("Space");
  // Playback start time varies with machine load: wait for the playhead to move.
  await expect.poll(() => timecode(page).textContent(), { timeout: 15_000 }).not.toBe(before);
  await page.keyboard.press("Space");

  // Properties of the selected clip.
  await clips(page).first().click();
  await expect(page.getByText("Transform", { exact: true })).toBeVisible();
  await shot(page, "05-properties");

  // Transform handles on the preview: drag the clip, then undo.
  const handles = page.getByRole("group", { name: "Transform handles" });
  await expect(handles).toBeVisible();
  const box2 = (await handles.locator("polygon").boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 + 120, box2.y + box2.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const locationX = page.getByRole("spinbutton", { name: "Location X" });
  await expect(locationX).not.toHaveAttribute("aria-valuenow", "0");
  await shot(page, "05b-transform");
  await page.keyboard.press(`${mod}+Z`);
  await expect(locationX).toHaveAttribute("aria-valuenow", "0");

  // Drop an effect from the library onto the clip.
  const rail = page.getByRole("navigation", { name: "Library sections" });
  await rail.getByRole("button", { name: "Effects" }).click();
  const blur = page.getByRole("button", { name: /^Blur/ }).first();
  await expect(blur).toBeVisible();
  await blur.dragTo(clips(page).first());
  await expect(page.getByText("Parameters")).toBeVisible();
  await shot(page, "05c-effect");

  // Fade the clip in with a transition from the library (double-click applies it to the selection).
  await clips(page).first().click();
  await rail.getByRole("button", { name: "Transitions" }).click();
  await page.getByRole("button", { name: "Fade", exact: true }).first().dblclick();
  await expect(page.locator('[data-kind="transition"]')).toHaveCount(1);
  await shot(page, "05d-transition");

  // A title from a template, over the picture on its own track.
  await page.keyboard.press("Home");
  await rail.getByRole("button", { name: "Titles" }).click();
  await page.getByRole("button", { name: "Bar 1", exact: true }).click();
  const titleDialog = page.getByRole("dialog", { name: "Title" });
  await expect(titleDialog).toBeVisible();
  const line = titleDialog.getByRole("textbox").first();
  await line.fill("Made in the browser");
  await expect(titleDialog.getByRole("img", { name: "Title preview" })).toBeVisible();
  await shot(page, "05e-title-dialog");
  await titleDialog.getByRole("button", { name: "Add to timeline" }).click();
  await expect(titleDialog).toBeHidden();
  await expect(clips(page)).toHaveCount(2);
  const layersOf = await page.evaluate(() => Array.from(document.querySelectorAll('[data-kind="clip"]')).map((el) => (el as HTMLElement).dataset.track ?? ""));
  expect(new Set(layersOf).size).toBe(2);
  await page.waitForTimeout(800);
  await shot(page, "05f-title");
  await rail.getByRole("button", { name: "Project files" }).click();

  // The one-shot reel dialog opens on the project's media (looked at, not run: its build has its own tests).
  await page.getByRole("button", { name: "Make a reel" }).click();
  const reelDialog = page.getByRole("dialog", { name: "Make a reel" });
  await expect(reelDialog).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "05g-reel-dialog");
  await page.keyboard.press("Escape");
  await expect(reelDialog).toBeHidden();

  // Export in the browser and receive the file.
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Export video" });
  await expect(dialog).toBeVisible();
  await shot(page, "06-export-dialog");
  const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(statSync(path).size).toBeGreaterThan(10_000);
  await expect(dialog.getByText(/Saved /)).toBeVisible();
  await shot(page, "07-export-done");

  expect(errors).toEqual([]);
});

test("assistant, shortcuts and login screens", async ({ page }) => {
  await page.goto("/editor/");
  await page.getByRole("button", { name: /Vertical/ }).click();
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  await page.getByRole("tab", { name: /Assistant/ }).click();
  await expect(page.getByText(/Edit by asking|sign-in, which is off/)).toBeVisible();
  await shot(page, "08-assistant-signed-out");
  await page.keyboard.press("Shift+/");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await shot(page, "09-shortcuts");
  await page.keyboard.press("Escape");
  await page.goto("/editor/login");
  await page.waitForTimeout(500);
  await shot(page, "10-login");
});

test("open a desktop .zvn with media on another computer, then relink it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("zenvi.debug", "1"));
  await page.goto("/editor/");
  await page.getByRole("button", { name: /HD 720p/ }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { __zenvi?: unknown }).__zenvi));

  // A desktop-style project: absolute macOS path, no cloud hash, one clip.
  const zvn = await page.evaluate(() => {
    type Engine = {
      createProject: (o: { profile: string }) => unknown;
      ProjectDocument: new (p: unknown) => { transaction: (l: string, fn: (tx: unknown) => void) => void; project: unknown };
      addFile: (tx: unknown, media: unknown) => { id: string };
      addClip: (tx: unknown, input: unknown) => unknown;
      serializeProject: (p: unknown) => string;
    };
    const { engine } = (window as unknown as { __zenvi: { engine: Engine } }).__zenvi;
    const doc = new engine.ProjectDocument(engine.createProject({ profile: "HD 720p 30 fps" }));
    const info = {
      type: "FFmpegReader", path: "/Users/editor/Footage/pattern.webm", has_video: true, has_audio: true, has_single_image: false,
      duration: 4, width: 640, height: 360, fps: { num: 30, den: 1 }, video_length: "120", pixel_ratio: { num: 1, den: 1 },
      display_ratio: { num: 16, den: 9 }, sample_rate: 48000, channels: 2, channel_layout: 3, vcodec: "vp9", acodec: "opus",
    };
    doc.transaction("build", (tx) => {
      const file = engine.addFile(tx, { path: info.path, info, name: "pattern.webm" });
      engine.addClip(tx, { fileId: file.id, position: 0, layer: 1000000 });
    });
    return engine.serializeProject(doc.project);
  });

  await page.goto("/editor/");
  await page.locator('input[type="file"][accept*=".zvn"]').setInputFiles({ name: "Desktop edit.zvn", mimeType: "application/json", buffer: Buffer.from(zvn) });
  const relink = page.getByRole("dialog", { name: "Find missing media" });
  await expect(relink).toBeVisible();
  await expect(relink.getByText("/Users/editor/Footage/pattern.webm")).toBeVisible();
  await shot(page, "12-relink");
  await relink.locator('input[type="file"]').setInputFiles(fixture("pattern.webm"));
  await expect(relink.getByText("Every file is linked.")).toBeVisible();
  await relink.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/files? (is|are) missing/)).toBeHidden();
  await expect(page.locator('[data-kind="clip"]')).toHaveCount(1);
});
