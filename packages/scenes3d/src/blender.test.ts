import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findBlender, versionAtLeast } from "./blender.js";

describe("findBlender", () => {
  it("takes ZENVI_BLENDER when it exists, else blender on PATH, else nothing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-find-"));
    const exe = path.join(dir, "blender");
    await writeFile(exe, "#!/bin/sh\n");
    await chmod(exe, 0o755);
    expect(findBlender({ ZENVI_BLENDER: exe }, "linux")).toBe(exe);
    expect(findBlender({ ZENVI_BLENDER: path.join(dir, "nope") }, "linux")).toBeUndefined();
    expect(findBlender({ PATH: dir }, "linux")).toBe(exe);
    expect(findBlender({ PATH: path.join(dir, "empty") }, "freebsd")).toBeUndefined();
  });
});

describe("versionAtLeast", () => {
  it("compares Blender version strings", () => {
    expect(versionAtLeast("5.2.3 LTS", "4.2")).toBe(true);
    expect(versionAtLeast("4.2.0", "4.2")).toBe(true);
    expect(versionAtLeast("4.1.1", "4.2")).toBe(false);
    expect(versionAtLeast("10.0", "4.2")).toBe(true);
  });
});
