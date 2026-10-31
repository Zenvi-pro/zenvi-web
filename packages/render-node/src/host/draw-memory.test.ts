import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDrawMemory, DRAW_MEMORY_FILE } from "./draw-memory.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("draw memory", () => {
  it("remembers the last three films and replaces a film drawn again", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-draws-"));
    dirs.push(dir);
    const memory = createDrawMemory(dir);
    expect(await memory.recent()).toEqual([]);
    await memory.remember(["cin-a", "cin-b"], "P1");
    await memory.remember(["cin-c"], "P2");
    await memory.remember(["cin-d"], "P1");
    expect((await readFile(path.join(dir, DRAW_MEMORY_FILE), "utf8")).trim().split("\n")).toHaveLength(2);
    expect(await memory.recent()).toEqual(["cin-c", "cin-d"]);
    await memory.remember(["cin-e"], "P3");
    await memory.remember(["cin-f"], "P4");
    expect(await memory.recent()).toEqual(["cin-d", "cin-e", "cin-f"]);
  });
});
