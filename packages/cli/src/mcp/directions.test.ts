import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { briefSchema } from "@zenvi/engine";
import { afterEach, describe, expect, it } from "vitest";
import { drawText, lastDirection, recordDirection } from "./directions.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

const brief = (pick: string) =>
  briefSchema.parse({ goal: "g", platform: "p", aspect: "9:16", length_seconds: 5, style: "hype-reel", hook: "h", beats: [{ start: 0, end: 5, name: "all" }], direction: [{ axis: "Art style", pick, why: "w" }, { axis: "rhythm", pick: "countdown", why: "w" }] });

describe("the creative-direction history", () => {
  it("records each brief's picks, says which repeat the last edit's, and draws away from them", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-directions-"));
    dirs.push(dir);
    expect(await lastDirection(dir)).toEqual({});
    expect(await recordDirection(dir, brief("Swiss grid"), "EDITONEXXX")).toEqual([]);
    expect(await lastDirection(dir)).toEqual({ "art style": "Swiss grid", rhythm: "countdown" });
    expect(await recordDirection(dir, brief("neon night"), "EDITTWOXXX")).toEqual(["rhythm"]);
    expect((await readFile(path.join(dir, "brief-directions.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
    const text = await drawText(dir, undefined, 3);
    expect(text).toMatch(/^Creative-direction draw for this edit/);
    expect(text).toContain("(last edit: neon night)");
    expect(text).not.toMatch(/- art style: neon night/);
  });

  it("a revised brief replaces its own edit's line and is compared with the edit before it, not with itself", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-directions-"));
    dirs.push(dir);
    await recordDirection(dir, brief("Swiss grid"), "EDITONEXXX");
    await recordDirection(dir, brief("neon night"), "EDITTWOXXX");
    expect(await recordDirection(dir, brief("paper collage"), "EDITTWOXXX")).toEqual(["rhythm"]);
    expect(await recordDirection(dir, brief("Swiss grid"), "EDITTWOXXX")).toEqual(["Art style", "rhythm"]);
    expect((await readFile(path.join(dir, "brief-directions.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
    expect(await lastDirection(dir, "EDITTWOXXX")).toEqual({ "art style": "Swiss grid", rhythm: "countdown" });
    expect(await drawText(dir, "EDITTWOXXX", 3)).toContain("(last edit: Swiss grid)");
  });
});
