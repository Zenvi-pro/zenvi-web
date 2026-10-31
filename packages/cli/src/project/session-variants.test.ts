/**
 * Variants in a CLI session: forking keeps the session on its file, and the
 * tournament reads the variants without opening them, so the winner lands in
 * the file the session had open (open_project_tool would switch files).
 */

import path from "node:path";
import { createProject, WATCH_DIMENSION_NAMES, type CompareVerdict, type Project } from "@zenvi/engine";
import { readProjectFile, writeProjectFile } from "@zenvi/render-node";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineRegistry } from "../engine/registry.js";
import { ProjectSession } from "./session.js";

let dir: string;
beforeAll(async () => {
  dir = await makeTempDir("zenvi-session-variants-");
});
afterAll(async () => removeDir(dir));

const flat = (n: number) => Object.fromEntries(WATCH_DIMENSION_NAMES.map((d) => [d, n])) as CompareVerdict["scores"]["A"];

describe("variants in a CLI session", () => {
  it("forks without switching files and makes the winner the open file's edit", async () => {
    const base = path.join(dir, "trip.zvn");
    await writeProjectFile(base, createProject());
    const session = await ProjectSession.open(base, { registry: engineRegistry(), surface: "mcp" });

    const fork = await session.run("fork_project_tool", { name: "with-marker" });
    expect(fork.result.ok).toBe(true);
    expect(session.file).toBe(base);
    const variant = path.join(dir, "trip-with-marker.zvn");
    // The variant's own change, made as if it had been opened and edited.
    const edited: Project = { ...(await readProjectFile(variant)), markers: [{ id: "M1", position: 1, icon: "blue.png", vector: "blue" }] as Project["markers"] };
    await writeProjectFile(variant, edited);

    // A judge that prefers the variant's render in either slot.
    session.toolHost.watch = {
      watch: async () => {
        throw new Error("compare is used");
      },
      length: async () => 10,
      compare: async (first, second) => ({
        model: "test",
        durations: { A: 10, B: 10 },
        winner: first === "b.mp4" ? "A" : "B",
        why: "b",
        scores: { A: flat(first === "b.mp4" ? 7 : 5), B: flat(second === "b.mp4" ? 7 : 5) },
        fixes: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        via: "gemini",
      }),
    };
    const pick = await session.run("pick_best_variant_tool", {
      variants: [
        { name: "base", project: "trip.zvn", render: "a.mp4" },
        { name: "marker", project: "trip-with-marker.zvn", render: "b.mp4" },
      ],
    });
    expect(pick.result.ok).toBe(true);
    expect(pick.result.text).toContain("\"summary\":\"Best of 2: marker");
    expect(session.file).toBe(base);
    expect(pick.savedTo).toBe(base);
    expect((await readProjectFile(base)).markers).toHaveLength(1);
    expect(session.doc.undoLabels).toEqual(["Pick best variant: marker"]);
  });

  it("keeps the variant beside the project, so relative paths mean the same in the variant and the base", async () => {
    const base = path.join(dir, "reel.zvn");
    await writeProjectFile(base, createProject());
    const session = await ProjectSession.open(base, { registry: engineRegistry(), surface: "mcp" });
    expect((await session.run("fork_project_tool", { name: "fast" })).result.ok).toBe(true);
    // The skill's flow: open the variant, work on it, then open the base again by the name it was given.
    expect((await session.run("open_project_tool", { file_path: "reel-fast.zvn" })).result.ok).toBe(true);
    expect(session.file).toBe(path.join(dir, "reel-fast.zvn"));
    expect((await session.run("open_project_tool", { file_path: "reel.zvn" })).result.ok).toBe(true);
    expect(session.file).toBe(base);
  });
});
