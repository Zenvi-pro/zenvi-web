import { describe, expect, it } from "vitest";
import type { Project } from "@zenvi/engine";
import { sampleProject } from "../testing/helpers.js";
import { projectPathResolver } from "./resolve.js";

const SHA = "a".repeat(64);

describe("projectPathResolver", () => {
  const project = sampleProject({
    files: [
      { id: "F1", path: "/Users/me/Videos/beach.mp4", media_type: "video", fingerprint: { sha256: SHA, size: 1 } },
      { id: "F2", path: "C:\\clips\\local.mov", media_type: "video" },
    ],
    clips: [{ id: "C1", file_id: "F1", position: 0, start: 0, end: 1, layer: 1, reader: { path: "../Videos/beach.mp4" } }],
  }) as unknown as Project;

  it("maps file paths and clip reader paths to the file's cloud bytes", async () => {
    const fetched: string[] = [];
    const resolve = projectPathResolver(project, { fetchFile: async (file, sha) => (fetched.push(`${file.id}:${sha}`), `/tmp/${sha}.mp4`) });
    expect(await resolve("/Users/me/Videos/beach.mp4")).toBe(`/tmp/${SHA}.mp4`);
    expect(await resolve("../Videos/beach.mp4")).toBe(`/tmp/${SHA}.mp4`);
    expect(fetched).toEqual([`F1:${SHA}`, `F1:${SHA}`]);
  });

  it("uses built-in assets for @ paths and names what is missing", async () => {
    const resolve = projectPathResolver(project, {
      fetchFile: async () => "/never",
      resolveAsset: (p) => (p === "@transitions/common/fade.svg" ? "/assets/transitions/common/fade.svg" : undefined),
    });
    expect(await resolve("@transitions/common/fade.svg")).toBe("/assets/transitions/common/fade.svg");
    await expect(resolve("C:\\clips\\local.mov")).rejects.toThrow('"local.mov" is not in Zenvi Cloud');
    await expect(resolve("/elsewhere/other.png")).rejects.toThrow('"other.png" is not in Zenvi Cloud');
  });
});
