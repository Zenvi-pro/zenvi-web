import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { DEFAULT_PROFILE_DESCRIPTION, findProfile } from "../../model/profiles.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { fakeShotHost, type FakeShotHost, type Script } from "../test-support/fake-shots.js";
import { L1, media, videoInfo } from "../test-support/fixture.js";

const SCRIPTS: Record<string, Script> = {
  "/media/desk.mp4": [[0, "face"], [3, "hands"], [5, "cup"]],
  "/media/street.mp4": [[0, "city"], [4, "car"]],
  "/media/street2.mp4": [[0, "city"]],
  "/media/beach.jpg": [[0, "beach"]],
};

function doc(): ProjectDocument {
  const d = new ProjectDocument(createProject({ id: "SHOTSPRJ01", profile: findProfile(DEFAULT_PROFILE_DESCRIPTION)! }));
  d.transaction("fixture", (tx) => {
    addFile(tx, media("/media/desk.mp4", videoInfo("/media/desk.mp4", 8)), { id: "DESKFILE01" });
    addFile(tx, media("/media/street.mp4", videoInfo("/media/street.mp4", 8)), { id: "STRTFILE01" });
    addFile(tx, media("/media/street2.mp4", videoInfo("/media/street2.mp4", 8)), { id: "STRTFILE02" });
    addFile(tx, media("/media/beach.jpg"), { id: "BEACHFILE1" });
    addFile(tx, media("/media/song.mp3"), { id: "SONGFILE01" });
    addClip(tx, { fileId: "STRTFILE01", position: 0, layer: L1, start: 0, end: 2, id: "CLIPSTRT01" });
    addClip(tx, { fileId: "STRTFILE02", position: 2, layer: L1, start: 1, end: 3, id: "CLIPSTRT02" });
    addClip(tx, { fileId: "DESKFILE01", position: 4, layer: L1, start: 3, end: 5, id: "CLIPDESK01" });
  });
  return d;
}

function hosts(options: Parameters<typeof fakeShotHost>[1] = {}): { host: FakeHost; shots: FakeShotHost } {
  const host = fakeHost();
  const shots = fakeShotHost(SCRIPTS, { tints: { "/media/street2.mp4": 0.2 }, ...options });
  host.shots = shots;
  return { host, shots };
}

async function run(d: ProjectDocument, host: FakeHost, tool: string, args: Record<string, unknown>): Promise<ToolReceipt> {
  return (await runTool({ doc: d, host }, tool, args)).data as ToolReceipt;
}

type Moments = { moments: { file_id: string; start_seconds: number; end_seconds: number; peak_seconds: number; match: number; still?: boolean }[] };

describe("find_shots_tool", () => {
  it("finds the moment that shows the query, embedding the bin first, and changes nothing", async () => {
    const d = doc();
    const { host, shots } = hosts();
    const before = d.project;
    const r = await run(d, host, "find_shots_tool", { query: "close-up of hands typing" });
    expect(r.status).toBe("unchanged");
    const { moments } = r.data as Moments;
    expect(moments[0]).toMatchObject({ file_id: "DESKFILE01", start_seconds: 2.75, end_seconds: 4.75, peak_seconds: 3 });
    expect(moments[0]!.match).toBeGreaterThan(moments[1]!.match);
    // The audio file is not looked at; every picture file is embedded once.
    expect(shots.calls.filter((c) => c.startsWith("embed")).sort()).toEqual(["embed /media/beach.jpg 0.5", "embed /media/desk.mp4 0.5", "embed /media/street.mp4 0.5", "embed /media/street2.mp4 0.5"]);
    expect(d.project).toBe(before);
  });

  it("returns one moment a file by default, more with per_file, and only the files asked for", async () => {
    const d = doc();
    const { host } = hosts();
    const one = (await run(d, host, "find_shots_tool", { query: "city street", limit: 3 })).data as Moments;
    expect(new Set(one.moments.map((m) => m.file_id)).size).toBe(one.moments.length);
    const r = (await run(d, host, "find_shots_tool", { query: "a cup", file_ids: ["DESKFILE01"], per_file: 3, limit: 3 })).data as Moments;
    expect(r.moments.every((m) => m.file_id === "DESKFILE01")).toBe(true);
    expect(r.moments[0]).toMatchObject({ start_seconds: 4.75, end_seconds: 7.75, peak_seconds: 5 });
    const still = (await run(d, host, "find_shots_tool", { query: "beach", limit: 1 })).data as Moments;
    expect(still.moments[0]).toMatchObject({ file_id: "BEACHFILE1", still: true });
  });

  it("asks before the model download and downloads only with download=true", async () => {
    const d = doc();
    const { host, shots } = hosts({ ready: false });
    const refused = await run(d, host, "find_shots_tool", { query: "hands" });
    expect(refused.status).toBe("refused");
    expect(refused.summary).toMatch(/^Error: the shot model is not downloaded yet: ask the person/);
    expect(shots.calls).toEqual([]);
    const ok = await run(d, host, "find_shots_tool", { query: "hands", download: true });
    expect(ok.status).toBe("unchanged");
    expect(shots.calls[0]).toBe("setup");
  });

  it("refuses files without picture and unknown ids, and hosts without the model", async () => {
    const d = doc();
    const { host } = hosts();
    expect((await run(d, host, "find_shots_tool", { query: "x", file_ids: ["SONGFILE01"] })).summary).toMatch(/song\.mp3 has no picture/);
    expect((await run(d, host, "find_shots_tool", { query: "x", file_ids: ["NOPE"] })).summary).toMatch(/no project file with id='NOPE'/);
    const bare = fakeHost();
    const r = await runTool({ doc: d, host: bare }, "find_shots_tool", { query: "x" });
    expect(r.text).toMatch(/not available in this Zenvi surface.*shot embeddings/);
  });
});

describe("embed_media_tool", () => {
  it("embeds every picture file once; a second call reads the cache", async () => {
    const d = doc();
    const { host, shots } = hosts();
    const before = d.project;
    const first = await run(d, host, "embed_media_tool", {});
    expect(first.status).toBe("applied");
    expect(first.undoSteps).toBe(0);
    expect((first.data as { embedded: unknown[] }).embedded).toHaveLength(4);
    const second = await run(d, host, "embed_media_tool", { file_ids: ["DESKFILE01"] });
    expect(second.status).toBe("unchanged");
    expect((second.data as { embedded: { cached: boolean; keyframes: number }[] }).embedded).toEqual([expect.objectContaining({ cached: true, keyframes: 16 })]);
    expect(shots.calls.filter((c) => c.startsWith("embed"))).toHaveLength(4);
    expect(d.project).toBe(before);
  });

  it("stops starting files when its time budget is spent and says how many are left", async () => {
    const d = doc();
    const { host, shots } = hosts();
    const slow = shots.embedFile.bind(shots);
    shots.embedFile = async (path, request) => {
      const out = await slow(path, request);
      if (!request.cachedOnly) await new Promise((resolve) => setTimeout(resolve, 5_100));
      return out;
    };
    const r = await run(d, host, "embed_media_tool", { max_seconds: 5 });
    expect((r.data as { remaining: string[] }).remaining).toHaveLength(3);
    expect(r.summary).toMatch(/3 left: call again/);
  }, 20_000);
});

describe("shot_similarity_tool", () => {
  it("scores timeline clips, flags near-duplicates and orders them by look", async () => {
    const d = doc();
    const { host } = hosts();
    const r = await run(d, host, "shot_similarity_tool", { clip_ids: ["CLIPDESK01", "CLIPSTRT01", "CLIPSTRT02"] });
    expect(r.status).toBe("unchanged");
    const data = r.data as { similarity: number[][]; near_duplicates: { a: string; b: string }[]; look_order: string[] };
    expect(data.similarity[1]![2]).toBeGreaterThan(0.9);
    expect(data.near_duplicates).toEqual([expect.objectContaining({ a: "CLIPSTRT01", b: "CLIPSTRT02" })]);
    expect(data.look_order[0]).toBe("CLIPDESK01");
  });

  it("takes clip_ids or file_ids, not both", async () => {
    const d = doc();
    const { host } = hosts();
    expect((await run(d, host, "shot_similarity_tool", { clip_ids: ["CLIPDESK01", "CLIPSTRT01"], file_ids: ["DESKFILE01", "STRTFILE01"] })).summary).toMatch(/one of them/);
    const files = await run(d, host, "shot_similarity_tool", { file_ids: ["STRTFILE01", "DESKFILE01", "STRTFILE02"] });
    expect((files.data as { look_order: string[] }).look_order).toEqual(["STRTFILE01", "STRTFILE02", "DESKFILE01"]);
  });
});
