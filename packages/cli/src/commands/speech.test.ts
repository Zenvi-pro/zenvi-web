import path from "node:path";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testEnv, zenvi } from "../test-support/harness.js";

let home: string;

beforeAll(async () => {
  home = await makeTempDir("zenvi-cli-speech-");
});

afterAll(async () => {
  await removeDir(home);
});

describe("zenvi speech", () => {
  it("status says nothing is downloaded in an empty cache, and where tools transcribe", async () => {
    const env = testEnv(home, { ZENVI_CACHE_DIR: path.join(home, "cache") });
    const run = await zenvi(["--json", "speech", "status"], { cwd: home, env });
    expect(run.code, run.stderr).toBe(0);
    const status = run.json<{ ready: boolean; mode: string; model: string; models: { model: string; present: boolean }[] }>();
    expect(status.mode).toBe("auto");
    expect(status.model).toBe("base");
    expect(status.models).toEqual([
      { model: "base", present: false },
      { model: "small", present: false },
    ]);
    expect(status.ready).toBe(false);
  });

  it("transcribe refuses before setup, naming the command to run", async () => {
    const env = testEnv(home, { ZENVI_CACHE_DIR: path.join(home, "cache"), ZENVI_SPEECH_MODEL: "small" });
    const run = await zenvi(["speech", "transcribe", "talk.wav"], { cwd: home, env });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("zenvi speech setup --model small");
  });
});
