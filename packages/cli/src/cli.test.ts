import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProject, parseProjectText, PROJECT_FORMAT_VERSION } from "@zenvi/engine";
import { makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { placementWindow } from "./commands/edit.js";
import { exportOptionsFrom } from "./commands/render.js";
import { testEnv, zenvi } from "./test-support/harness.js";
import { testRegistry } from "./test-support/registry.js";

let home: string;
let work: string;
const registry = testRegistry();
const run = (args: string[], cwd = work) => zenvi(args, { cwd, env: testEnv(home), registry });

beforeAll(async () => {
  home = await makeTempDir("zenvi-cli-home-");
  work = await makeTempDir("zenvi-cli-work-");
});

afterAll(async () => {
  await removeDir(home);
  await removeDir(work);
});

describe("zenvi CLI", () => {
  it("creates a project in the desktop format", async () => {
    const r = await run(["new", "trip", "--profile", "HD 1080p 30 fps", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ status: "applied", project: path.join(work, "trip.zvn"), width: 1920, height: 1080, fps: { num: 30, den: 1 } });
    const saved = JSON.parse(await readFile(path.join(work, "trip.zvn"), "utf8")) as Record<string, unknown>;
    expect(saved).toMatchObject({ width: 1920, height: 1080, clips: [], history: { undo: [], redo: [] } });
    expect(String(saved.profile)).toMatch(/1080p 30 fps/);
    expect(await readFile(path.join(work, "trip.zvn"), "utf8")).toMatch(/^\{\n "/);
    const again = await run(["new", "trip.zvn"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/already exists/);
    const bad = await run(["new", "x.zvn", "--profile", "Not A Profile"]);
    expect(bad.code).toBe(2);
  });

  it("imports media, adds it to the timeline and stores paths relative to the project", async () => {
    await makeVideo(path.join(work, "footage"), "beach.mp4", { duration: 1, width: 160, height: 90 });
    const added = await run(["add", "footage/beach.mp4", "--at", "0:02", "--json"]);
    expect(added.code).toBe(0);
    expect(added.json()).toMatchObject({ contract: 3, status: "applied", tool: "add_clip_to_timeline_tool", engine: "portable" });
    const saved = JSON.parse(await readFile(path.join(work, "trip.zvn"), "utf8")) as { files: Array<{ path: string; media_type: string }>; clips: Array<{ position: number; reader: { path: string } }> };
    expect(saved.files[0]).toMatchObject({ path: "footage/beach.mp4", media_type: "video" });
    expect(saved.clips[0]).toMatchObject({ position: 2, reader: { path: "footage/beach.mp4" } });
  });

  it("writes projects the desktop reopens unchanged: version stamp kept, clip alpha stays 1", async () => {
    const text = await readFile(path.join(work, "trip.zvn"), "utf8");
    const raw = JSON.parse(text) as { version: Record<string, string>; clips: Array<{ alpha: { Points: Array<{ co: { Y: number } }> } }> };
    expect(raw.version).toMatchObject(PROJECT_FORMAT_VERSION);
    expect(raw.version["openshot-qt"]).not.toBe("0.0.0");
    // A "0.0.0" stamp would make the desktop (and parseProject) flip every clip's alpha.
    const reopened = parseProjectText(text);
    expect(reopened.clips).toHaveLength(1);
    expect(reopened.clips[0]!.alpha.Points.map((p) => p.co.Y)).toEqual([1]);
    expect(raw.clips[0]!.alpha.Points.map((p) => p.co.Y)).toEqual([1]);
  });

  it("keeps undo history in the file across invocations", async () => {
    expect((await run(["marker", "add", "1.5", "intro"])).code).toBe(0);
    expect((await run(["marker", "add", "3", "drop"])).code).toBe(0);
    const before = JSON.parse(await readFile(path.join(work, "trip.zvn"), "utf8")) as { markers: unknown[]; history: { undo: unknown[] } };
    expect(before.markers).toHaveLength(2);
    expect(before.history.undo.length).toBeGreaterThanOrEqual(3);
    const undo = await run(["undo", "--json"]);
    expect(undo.json()).toMatchObject({ status: "applied", tool: "undo_tool" });
    const after = JSON.parse(await readFile(path.join(work, "trip.zvn"), "utf8")) as { markers: Array<{ label: string }> };
    expect(after.markers.map((m) => m.label)).toEqual(["intro"]);
    const listed = await run(["markers"]);
    expect(listed.stdout).toMatch(/intro/);
    expect(listed.stdout).not.toMatch(/drop/);
  });

  it("runs any tool with `call` (key=value and --args)", async () => {
    const r = await run(["call", "add_marker_tool", "position_seconds=4", "--args", '{"label":"outro"}', "--json"]);
    expect(r.json()).toMatchObject({ status: "applied", markers: [{ position: 4 }] });
    const unknown = await run(["call", "no_such_tool", "--json"]);
    expect(unknown.code).toBe(1);
    expect(unknown.json()).toMatchObject({ status: "refused", summary: "Error: no_such_tool is not available in this Zenvi surface" });
    const badArgs = await run(["call", "add_marker_tool", "--args", "[1]"]);
    expect(badArgs.code).toBe(2);
  });

  it("removes a marker by name with `marker rm`", async () => {
    const r = await run(["marker", "rm", "outro", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ status: "applied", tool: "remove_marker_tool", summary: "Removed 1 marker(s)" });
    const saved = JSON.parse(await readFile(path.join(work, "trip.zvn"), "utf8")) as { markers: Array<{ label: string }> };
    expect(saved.markers.map((m) => m.label)).toEqual(["intro"]);
  });

  it("lists the catalog", async () => {
    const r = await run(["tools", "--json"]);
    const names = r.json<{ tools: Array<{ name: string; available: boolean }> }>().tools.map((t) => t.name);
    expect(names).toContain("import_files_tool");
    expect(names).toContain("add_marker_tool");
  });

  it("finds the project: -p, ZENVI_PROJECT, or the only .zvn here", async () => {
    const empty = await makeTempDir("zenvi-cli-empty-");
    try {
      const none = await run(["info"], empty);
      expect(none.code).toBe(2);
      expect(none.stderr).toMatch(/No project given/);
      const viaEnv = await zenvi(["info", "--json"], { cwd: empty, env: testEnv(home, { ZENVI_PROJECT: path.join(work, "trip.zvn") }), registry });
      expect(viaEnv.json()).toMatchObject({ status: "applied", project: path.join(work, "trip.zvn") });
      await writeFile(path.join(empty, "a.zvn"), "{ this is not json");
      await writeFile(path.join(empty, "b.zvn"), "{}");
      const many = await run(["info"], empty);
      expect(many.code).toBe(2);
      expect(many.stderr).toMatch(/has 2 projects/);
      const broken = await run(["-p", "a.zvn", "info", "--json"], empty);
      expect(broken.code).toBe(1);
      expect(broken.json()).toMatchObject({ status: "error" });
    } finally {
      await removeDir(empty);
    }
  });

  it("honours -p for every command and never touches the folder's own project", async () => {
    const elsewhere = await makeTempDir("zenvi-cli-elsewhere-");
    const decoyDir = await makeTempDir("zenvi-cli-decoy-");
    try {
      // The current folder has its own project; -p must win everywhere.
      expect((await run(["new", "decoy.zvn"], decoyDir)).code).toBe(0);
      const decoy = await readFile(path.join(decoyDir, "decoy.zvn"), "utf8");
      const target = path.join(elsewhere, "target.zvn");
      const created = await run(["-p", target, "new", "--json"], decoyDir);
      expect(created.json()).toMatchObject({ project: target });
      await makeVideo(path.join(elsewhere, "media"), "clip.mp4", { duration: 1, width: 64, height: 48 });
      const media = path.join(elsewhere, "media", "clip.mp4");
      const commands: string[][] = [
        ["info"], ["files"], ["clips"], ["tracks"], ["markers"], ["import", media], ["add", media],
        ["marker", "add", "1", "x"], ["undo"], ["redo"], ["call", "get_project_info_tool"], ["save"],
      ];
      for (const args of commands) {
        const r = await run(["-p", target, ...args, "--json"], decoyDir);
        expect(r.json<{ project?: string }>().project, args.join(" ")).toBe(target);
      }
      // ZENVI_PROJECT works for `new` too, and conflicting files are refused.
      const viaEnv = path.join(elsewhere, "env.zvn");
      const envNew = await zenvi(["new", "--json"], { cwd: decoyDir, env: testEnv(home, { ZENVI_PROJECT: viaEnv }), registry });
      expect(envNew.json()).toMatchObject({ project: viaEnv });
      const conflict = await run(["-p", target, "new", "other.zvn"], decoyDir);
      expect(conflict.code).toBe(2);
      expect(await readFile(path.join(decoyDir, "decoy.zvn"), "utf8")).toBe(decoy);
      expect((await import("node:fs")).existsSync(path.join(decoyDir, "untitled.zvn"))).toBe(false);
    } finally {
      await removeDir(elsewhere);
      await removeDir(decoyDir);
    }
  });

  it("never lets a new untitled project overwrite the open file", async () => {
    const before = await readFile(path.join(work, "trip.zvn"), "utf8");
    const r = await run(["call", "new_project_tool", "--json"]);
    expect(r.code).toBe(0);
    expect(await readFile(path.join(work, "trip.zvn"), "utf8")).toBe(before);
  });

  it("prints MCP configs and rejects unknown hosts", async () => {
    const codex = await run(["mcp-config", "codex"]);
    expect(codex.code).toBe(0);
    expect(codex.stdout).toMatch(/\[mcp_servers\.zenvi\]/);
    const bad = await run(["mcp-config", "vim"]);
    expect(bad.code).toBe(2);
  });

  it("reports usage errors with exit code 2", async () => {
    expect((await run(["split", "C1"])).code).toBe(2);
    expect((await run(["nope"])).code).toBe(2);
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/Usage: zenvi/);
  });
});

describe("zenvi add windows", () => {
  it("asks for exactly what the person typed: whole file, a window, or the rest from --start", () => {
    expect(placementWindow({})).toEqual({ full_file: "true" });
    expect(placementWindow({ duration: 2 })).toEqual({ start_seconds: 0, end_seconds: 2, full_file: "true" });
    expect(placementWindow({ start: 1, duration: 2 })).toEqual({ start_seconds: 1, end_seconds: 3, full_file: "true" });
    expect(placementWindow({ start: 1, end: 4 })).toEqual({ start_seconds: 1, end_seconds: 4, full_file: "true" });
    expect(placementWindow({ start: 1 }, 6)).toEqual({ start_seconds: 1, end_seconds: 6, full_file: "true" });
    // Unknown length (the desktop app's project): the tool keeps the rest itself.
    expect(placementWindow({ start: 1 })).toEqual({ start_seconds: 1 });
    expect(() => placementWindow({ start: 3, end: 2 })).toThrow(/after --start/);
    expect(() => placementWindow({ end: 2, duration: 1 })).toThrow(/not both/);
  });
});

describe("zenvi render options", () => {
  it("maps flags onto ExportOptions: format from the name, quality, crf, encoder preset, range", () => {
    const project = createProject({ profile: "HD 720p 30 fps" });
    expect(exportOptionsFrom(project, "/tmp/a.webm", {})).toMatchObject({ format: "webm", width: 1280, height: 720, quality: "high" });
    expect(exportOptionsFrom(project, undefined, { width: "640", crf: "18", encoderPreset: "medium" })).toMatchObject({
      format: "mp4",
      width: 640,
      height: 360,
      crf: 18,
      encoderPreset: "medium",
    });
    expect(() => exportOptionsFrom(project, undefined, { crf: "x" })).toThrow(/--crf/);
    expect(() => exportOptionsFrom(project, undefined, { encoderPreset: "warp" })).toThrow(/--encoder-preset/);
    expect(() => exportOptionsFrom(project, undefined, { quality: "ultra" })).toThrow(/--quality/);
  });
});

