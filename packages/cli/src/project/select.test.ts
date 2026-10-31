import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProject } from "./select.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function folder(...names: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zenvi-select-"));
  dirs.push(dir);
  for (const name of names) await writeFile(path.join(dir, name), "{}");
  return dir;
}

describe("findProject", () => {
  it("says how to pick one in the error line itself when a folder has two projects", async () => {
    // Regression (sk2-product-brand): a wrapper that kept only the error line never saw the -p hint.
    const cwd = await folder("p.zvn", "p_backup.zvn");
    // An empty ZENVI_PROJECT, so a developer's exported one does not answer the question.
    await expect(findProject({ cwd, env: { ZENVI_PROJECT: "" } })).rejects.toThrow(
      "This folder has 2 projects (p.zvn, p_backup.zvn): name one with -p, e.g. `zenvi -p p.zvn <command>`, or `export ZENVI_PROJECT=p.zvn`.",
    );
    expect(await findProject({ cwd, env: { ZENVI_PROJECT: "" }, flag: "p_backup.zvn" })).toBe(path.join(cwd, "p_backup.zvn"));
    expect(await findProject({ cwd, env: { ZENVI_PROJECT: "p.zvn" } })).toBe(path.join(cwd, "p.zvn"));
  });
});
