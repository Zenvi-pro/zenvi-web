import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// The motion capabilities from the editor's own UI (Transitions, Sound,
// Motion & 3D, clip menu, palette, Make it snappy), each a tool call and
// one undo step. ZENVI_E2E_VIDEO_DIR=<dir> keeps the Make it snappy recording.

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
const toastWith = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const undoButton = (page: Page) => page.getByRole("button", { name: /^Undo/ }).first();

async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "Dismiss" });
  while ((await close.count()) > 0) await close.first().click();
}

test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });

/** A new 1080p project with the 4 s test pattern double-clicked onto the timeline three times (a frame apart). */
async function projectWithThreeClips(page: Page): Promise<void> {
  await page.goto("/editor/");
  await page.getByRole("button", { name: /HD 1080p/ }).click();
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  await page.locator('input[type="file"][multiple][accept*="video"]').first().setInputFiles(fixture("pattern.webm"));
  const tile = page.getByRole("button", { name: "pattern.webm", exact: true });
  for (let i = 1; i <= 3; i += 1) {
    await tile.dblclick();
    await expect(clips(page)).toHaveCount(i);
  }
  await page.getByRole("button", { name: "Zoom to fit" }).click();
}

test("transitions, sound and motion panels, clip menu and palette call the tools", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await projectWithThreeClips(page);
  const rail = page.getByRole("navigation", { name: "Library sections" });

  // Transitions open on Motion; hovering a tile plays it.
  await rail.getByRole("button", { name: "Transitions" }).click();
  const whip = page.getByRole("button", { name: "Whip pan motion transition" });
  await expect(whip).toBeVisible();
  await shot(page, "13-transitions-motion");
  await whip.hover();
  await page.waitForTimeout(650);
  await shot(page, "13b-transition-hover");

  // Double-clicked clips sit a frame apart: the panel offers to close the gaps first.
  await clips(page).first().click();
  await whip.click();
  const notTouching = toastWith(page, "The clips do not touch");
  await expect(notTouching).toBeVisible();
  await notTouching.getByRole("button", { name: "Close gaps" }).click();
  await expect(toastWith(page, "Gaps closed")).toBeVisible();

  // Now the whip goes on the first clip's cut, as one undo step.
  const beforeWhip = await undoButton(page).getAttribute("aria-label");
  await clips(page).first().click();
  await whip.click();
  await expect(toastWith(page, /Added whip left on the cut/)).toBeVisible();
  await expect(undoButton(page)).not.toHaveAttribute("aria-label", beforeWhip!);
  await page.waitForTimeout(300);
  await shot(page, "13c-transition-applied");
  await page.keyboard.press(`${mod}+Z`);
  await expect(undoButton(page)).toHaveAttribute("aria-label", beforeWhip!);

  // Sound: audition, place one effect, sound-design the edit, undo each.
  await rail.getByRole("button", { name: "Sound" }).click();
  const library = page.getByRole("list", { name: "Sound effects" });
  await library.getByRole("button", { name: /^Play / }).first().click();
  await expect(library.getByRole("button", { name: /^Stop / })).toHaveCount(1);
  await shot(page, "14-sound");
  await page.keyboard.press("Home");
  await library.getByRole("button", { name: /at the playhead$/ }).first().click();
  await expect(toastWith(page, /with its peak on 0.00 s/)).toBeVisible();
  await expect(clips(page)).toHaveCount(4);
  await page.keyboard.press(`${mod}+Z`);
  await expect(clips(page)).toHaveCount(3);
  await page.getByRole("radio", { name: "Hype" }).click();
  await page.getByRole("button", { name: "Add sound design" }).click();
  await expect(toastWith(page, "Sound design added")).toBeVisible();
  const designed = await clips(page).count();
  expect(designed).toBeGreaterThan(3);
  await page.waitForTimeout(300);
  await shot(page, "14b-sound-designed");
  await page.keyboard.press(`${mod}+Z`);
  await expect(clips(page)).toHaveCount(3);

  // Motion & 3D: listed, marked as needing desktop or CLI in the browser.
  await rail.getByRole("button", { name: "Motion and 3D" }).click();
  await expect(page.getByRole("region", { name: "3D scenes" })).toBeVisible();
  await expect(page.getByText("Needs desktop or CLI").first()).toBeVisible();
  await shot(page, "15-motion-3d");

  // Clip menu: the motion entries.
  await dismissToasts(page);
  await clips(page).nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Speed Ramp" }).hover();
  await expect(page.getByRole("menuitem", { name: "Hero slow-mo" })).toBeVisible();
  await shot(page, "16-clip-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Palette: Make it snappy is one search away.
  await page.keyboard.press(`${mod}+Shift+P`);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  if (!(await palette.isVisible())) await page.getByRole("button", { name: /Command palette/ }).first().click();
  await expect(palette).toBeVisible();
  await page.keyboard.type("snappy");
  await expect(palette.getByText(/Make it snappy/)).toBeVisible();
  await shot(page, "17-palette-snappy");
  await page.keyboard.press("Escape");

  expect(errors).toEqual([]);
});

test("make it snappy runs as separate undo steps with one summary toast", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await projectWithThreeClips(page);
  await page.waitForTimeout(800);
  const before = await undoButton(page).getAttribute("aria-label");

  await page.getByRole("button", { name: "Make it snappy" }).first().click();
  // 3 steps here (gaps, transitions, sound); 4 once master_audio_tool is in the catalog.
  const summary = toastWith(page, /Made it snappy: \d undo steps/);
  await expect(summary).toBeVisible({ timeout: 60_000 });
  const steps = Number(/Made it snappy: (\d)/.exec((await summary.textContent()) ?? "")?.[1]);
  expect(steps).toBeGreaterThanOrEqual(3);
  await expect(summary).toContainText("Close frame gaps");
  await expect(summary).toContainText("Motion transitions");
  await expect(summary).toContainText("Sound design");
  expect(await clips(page).count()).toBeGreaterThan(3);
  await page.waitForTimeout(600);
  await shot(page, "18-snappy-done");

  // Step across the first cut (4 s) frame by frame, then play over it, for the recording.
  const dir = process.env.ZENVI_E2E_VIDEO_DIR;
  const ruler = (await page.getByRole("slider", { name: /Timeline ruler/ }).boundingBox())!;
  const first = (await clips(page).filter({ hasText: "pattern.webm" }).first().boundingBox())!;
  const at = (seconds: number) => page.mouse.click(first.x + (first.width / 4) * seconds, ruler.y + ruler.height / 2);
  await at(3.8);
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(350);
    if (dir) await page.getByLabel("Video preview").screenshot({ path: join(dir, "whip-frames", `${String(i).padStart(2, "0")}.png`) });
  }
  await at(2.8);
  await page.keyboard.press("Space");
  await page.waitForTimeout(2500);
  await page.keyboard.press("Space");

  // Each step is its own undo step, newest first.
  const labels: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const label = (await undoButton(page).getAttribute("aria-label"))!;
    labels.push(label);
    await page.keyboard.press(`${mod}+Z`);
    await expect(undoButton(page)).not.toHaveAttribute("aria-label", label);
  }
  expect(new Set(labels).size).toBe(steps);
  await expect(undoButton(page)).toHaveAttribute("aria-label", before!);
  await expect(clips(page)).toHaveCount(3);
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
  const video = page.video();
  await page.close();
  if (dir && video) await video.saveAs(join(dir, "make-it-snappy.webm"));
});
