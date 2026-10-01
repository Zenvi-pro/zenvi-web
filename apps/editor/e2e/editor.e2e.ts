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
  await page.waitForTimeout(1200);
  await page.keyboard.press("Space");
  const after = await timecode(page).textContent();
  expect(after).not.toBe(before);

  // Properties of the selected clip.
  await clips(page).first().click();
  await expect(page.getByText("Transform")).toBeVisible();
  await shot(page, "05-properties");

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
