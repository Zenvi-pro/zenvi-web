/**
 * `zenvi call` with tools that answer status=running (ingest_web_video_tool's
 * long poll): a terminal command follows the job to the end. And
 * ingest_web_video_tool for real through the CLI with a stand-in yt-dlp: the
 * video lands in the project's assets folder, named after the page.
 */

import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { addMarker } from "@zenvi/engine";
import { applied, unchanged, type ToolReceipt } from "@zenvi/engine/tools";
import { makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRegistry, engineRegistry, type RegistryTool } from "../engine/registry.js";
import { testEnv, zenvi } from "../test-support/harness.js";
import { runningJobId } from "./context.js";
import type { CallOutcome } from "../engine/executor.js";

let home: string;
let work: string;

beforeAll(async () => {
  home = await makeTempDir("zenvi-jobs-home-");
  work = await makeTempDir("zenvi-jobs-work-");
});

afterAll(async () => {
  await removeDir(home);
  await removeDir(work);
});

function outcome(receipt: Partial<ToolReceipt>, ok = true): CallOutcome {
  return { engine: "portable", ok, receipt: receipt as ToolReceipt, text: "", images: [] };
}

describe("runningJobId", () => {
  it("reads status=running from the receipt's data, or from the desktop app's JSON summary", () => {
    expect(runningJobId(outcome({ data: { status: "running", job_id: "j1" } }))).toBe("j1");
    expect(runningJobId(outcome({ summary: JSON.stringify({ ok: true, status: "running", job_id: "j2" }) }))).toBe("j2");
    expect(runningJobId(outcome({ data: { status: "completed", job_id: "j1" } }))).toBeUndefined();
    expect(runningJobId(outcome({ data: { status: "running", job_id: "j1" } }, false))).toBeUndefined();
    expect(runningJobId(outcome({ summary: "Added clip to timeline" }))).toBeUndefined();
  });
});

describe("zenvi call on a job", () => {
  it("calls again with the job_id until the job is done, then prints the final receipt", async () => {
    const asked: unknown[] = [];
    let polls = 0;
    const slow: RegistryTool = {
      name: "slow_job_tool",
      title: "slow job",
      description: "A job that runs for two polls.",
      inputSchema: { type: "object", properties: { job_id: { type: "string" } }, additionalProperties: false },
      surfaces: ["mcp", "cli", "editor"],
      run(ctx, input) {
        asked.push(input);
        const running = (input as { job_id?: string }).job_id === undefined || polls < 2;
        polls += 1;
        const receipt = running
          ? unchanged("slow_job_tool", "still downloading", { data: { ok: true, status: "running", job_id: "job-7" } })
          : (ctx.doc.transaction("Finish", (tx) => addMarker(tx, 1, "done")), applied("slow_job_tool", "done", { data: { ok: true, status: "completed", job_id: "job-7" } }));
        return { ok: true, text: JSON.stringify(receipt), data: receipt };
      },
    };
    const dir = path.join(work, "slow");
    await mkdir(dir, { recursive: true });
    const registry = createRegistry([slow]);
    expect((await zenvi(["new", "edit.zvn"], { cwd: dir, env: testEnv(home), registry })).code).toBe(0);
    const r = await zenvi(["call", "slow_job_tool", "--json"], { cwd: dir, env: testEnv(home), registry });
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ status: "applied", data: { status: "completed", job_id: "job-7" } });
    expect(asked).toEqual([{}, { job_id: "job-7" }, { job_id: "job-7" }]);
    expect(r.stderr).toContain("still running (job job-7)");
    const saved = JSON.parse(await readFile(path.join(dir, "edit.zvn"), "utf8")) as { markers: Array<{ label: string }> };
    expect(saved.markers.map((m) => m.label)).toEqual(["done"]);
  });
});

const FAKE_YT_DLP = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const out = args[args.indexOf("--output") + 1];
const url = args[args.indexOf("--") + 1];
const file = out.replace("%(title).80B", "Surf Day").replace("%(id)s", "sd1").replace("%(ext)s", "mp4");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.copyFileSync(process.env.FAKE_YTDLP_MEDIA, file);
process.stdout.write(JSON.stringify({ id: "sd1", title: "Surf Day", duration: 1, extractor: "generic", webpage_url: url, width: 160, height: 90, ext: "mp4", filepath: file }) + "\\n");
`;

describe.skipIf(process.platform === "win32")("ingest_web_video_tool through the CLI", () => {
  it("fetches with the person's yt-dlp, copies the video into the project and places it", async () => {
    const dir = path.join(work, "ingest");
    const bin = path.join(work, "bin", "yt-dlp");
    await mkdir(path.dirname(bin), { recursive: true });
    await writeFile(bin, FAKE_YT_DLP);
    await chmod(bin, 0o755);
    const clip = await makeVideo(path.join(work, "src"), "surf.mp4", { duration: 1, width: 160, height: 90 });
    await mkdir(dir, { recursive: true });
    const env = testEnv(home, { ZENVI_YT_DLP: bin, FAKE_YTDLP_MEDIA: clip, ZENVI_CACHE_DIR: path.join(home, "cache") });
    const registry = engineRegistry();
    expect((await zenvi(["new", "edit.zvn"], { cwd: dir, env, registry })).code).toBe(0);
    // A public address literal: the CLI refuses links to private or local addresses, and needs no DNS for this one.
    const url = "https://93.184.216.34/watch?v=sd1";
    const r = await zenvi(["call", "ingest_web_video_tool", `url=${url}`, "intent=timeline", "--json"], { cwd: dir, env, registry });
    expect(r.code, r.stderr).toBe(0);
    const receipt = r.json<ToolReceipt & { data: Record<string, unknown> }>();
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { ok: true, status: "completed", placed: true, title: "Surf Day", intent: "timeline" } });
    expect(await readdir(path.join(dir, "edit_assets", "media"))).toEqual(["Surf Day [sd1].mp4"]);
    const saved = JSON.parse(await readFile(path.join(dir, "edit.zvn"), "utf8")) as { files: Array<{ id: string; path: string; name: string; tags: string }>; clips: Array<{ file_id: string }> };
    expect(saved.files[0]).toMatchObject({ path: "@assets/media/Surf Day [sd1].mp4", name: "Surf Day", tags: "web_video, timeline, web" });
    expect(saved.clips.map((c) => c.file_id)).toEqual([saved.files[0]!.id]);

    const local = await zenvi(["call", "ingest_web_video_tool", "url=http://127.0.0.1:9/watch", "--json"], { cwd: dir, env, registry });
    expect(local.code).toBe(1);
    expect(local.json()).toMatchObject({ status: "error", summary: "Error: That URL points at a private or local network address, which cannot be fetched." });
  });
});
