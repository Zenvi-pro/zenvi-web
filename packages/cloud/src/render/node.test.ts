import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeAssetResolver } from "./node.js";

describe("nodeAssetResolver", () => {
  const previous = process.env.ZENVI_ASSETS_DIR;
  let dir = "";
  afterEach(async () => {
    if (previous === undefined) delete process.env.ZENVI_ASSETS_DIR;
    else process.env.ZENVI_ASSETS_DIR = previous;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("maps portable prefixes and desktop install paths into the asset folder, and nothing else", async () => {
    dir = await mkdtemp(join(tmpdir(), "zenvi-assets-"));
    await mkdir(join(dir, "transitions", "common"), { recursive: true });
    await writeFile(join(dir, "transitions", "common", "fade.svg"), "<svg/>");
    await mkdir(join(dir, "emojis"), { recursive: true });
    await writeFile(join(dir, "emojis", "1F600.svg"), "<svg/>");
    process.env.ZENVI_ASSETS_DIR = dir;
    const resolve = nodeAssetResolver();
    expect(resolve).toBeDefined();
    expect(resolve?.("@transitions/common/fade.svg")).toBe(join(dir, "transitions", "common", "fade.svg"));
    expect(resolve?.("@emojis/1F600.svg")).toBe(join(dir, "emojis", "1F600.svg"));
    expect(resolve?.("/Applications/Zenvi.app/Contents/Resources/transitions/common/fade.svg")).toBe(join(dir, "transitions", "common", "fade.svg"));
    expect(resolve?.("C:\\Program Files\\Zenvi\\transitions\\common\\fade.svg")).toBe(join(dir, "transitions", "common", "fade.svg"));
    expect(resolve?.("@transitions/../../etc/passwd")).toBeUndefined();
    expect(resolve?.("@transitions/common/missing.svg")).toBeUndefined();
    expect(resolve?.("@assets/logo.png")).toBeUndefined();
    expect(resolve?.("/Users/me/Videos/clip.mp4")).toBeUndefined();
  });
});
