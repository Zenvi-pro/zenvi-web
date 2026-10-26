import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineRegistry } from "./engine/registry.js";
import { testEnv, zenvi } from "./test-support/harness.js";

let home: string;
let work: string;
const registry = engineRegistry();
const run = (args: string[]) => zenvi(args, { cwd: work, env: testEnv(home), registry });

beforeAll(async () => {
  home = await makeTempDir("zenvi-review-home-");
  work = await makeTempDir("zenvi-review-work-");
  await makeVideo(path.join(work, "footage"), "a.mp4", { duration: 1, width: 160, height: 90 });
  await makeVideo(path.join(work, "footage"), "b.mp4", { duration: 1, width: 160, height: 90, audioHz: 440 });
  await run(["new", "cut.zvn"]);
  await run(["add", "footage/a.mp4", "--at", "0"]);
  await run(["add", "footage/b.mp4", "--at", "1"]);
  await run(["add", "footage/a.mp4", "--at", "2"]);
}, 90_000);

afterAll(async () => {
  await removeDir(home);
  await removeDir(work);
});

describe("zenvi review", () => {
  it("writes the contact sheet and prints the numbers and problems", async () => {
    const r = await run(["review", "sheet.jpg", "--pace", "fast"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Reviewed 0\.00-3\.00 s: 3 shots/);
    expect(r.stdout).toMatch(/slow-pace/);
    expect(r.stdout).toMatch(/silent-stretch/);
    expect(r.stdout).toMatch(/fix: /);
    expect(r.stdout).toContain(`Wrote ${path.join(work, "sheet.jpg")}`);
    const bytes = await readFile(path.join(work, "sheet.jpg"));
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(bytes.length).toBeGreaterThan(1000);
  }, 60_000);

  it("is read-only: the project and its history are untouched", async () => {
    const before = (await stat(path.join(work, "cut.zvn"))).mtimeMs;
    const r = await run(["review", "--no-image", "--no-audio", "--json", "--pace", "slow"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ status: "applied", tool: "review_edit_tool", data: { pace: "slow", shots: { count: 3 } } });
    expect((await stat(path.join(work, "cut.zvn"))).mtimeMs).toBe(before);
  }, 60_000);

  it("refuses a backwards range with a clear error", async () => {
    const r = await run(["review", "--start", "2", "--end", "1"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/end must be after start/);
  }, 30_000);
});
