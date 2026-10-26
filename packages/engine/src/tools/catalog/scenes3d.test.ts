import { describe, expect, it } from "vitest";
import { readBlenderLink } from "../../scenes3d/link.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { fixtureDoc, IDS, L1, L3 } from "../test-support/fixture.js";
import type { Scene3dRenderRequest } from "../types.js";

type Data = Record<string, unknown>;
const dataOf = (result: { data?: unknown }) => (result.data as { data: Data }).data;

/** A host whose Zenvi 3D "renders" instantly (or fails), recording each request. */
function scenesHost(fail?: string): { host: FakeHost; requests: Scene3dRenderRequest[] } {
  const host = fakeHost();
  const requests: Scene3dRenderRequest[] = [];
  host.scenes3d = {
    render: async (request) => {
      requests.push(request);
      if (fail) throw new Error(fail);
      return {
        path: `/cache/scenes3d/${request.scene}-${requests.length}.${request.params.background === "transparent" ? "mov" : "mp4"}`,
        codec: request.params.background === "transparent" ? "prores4444" : "h264",
        width: request.quality === "draft" ? request.width / 2 : request.width,
        height: request.quality === "draft" ? request.height / 2 : request.height,
        fps: request.fps,
        frames: request.frames,
        fingerprint: String(requests.length).repeat(64).slice(0, 64),
        cached: false,
        seconds: 1.5,
        renderedAt: "2026-10-26T12:00:00.000Z",
        blender: "5.2.3 LTS",
      };
    },
  };
  return { host, requests };
}

/** Keys the desktop rewrites as media paths on save, anywhere under a value. */
function pathLikeKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) pathLikeKeys(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (["path", "image", "resource", "protobuf_data_path", "lut_path"].includes(k.toLowerCase())) out.push(k);
      pathLikeKeys(v, out);
    }
  }
  return out;
}

describe("list_3d_scenes_tool", () => {
  it("lists every scene with its params schema and says whether this surface renders them", async () => {
    const { host } = scenesHost();
    const result = await runTool({ doc: fixtureDoc(), host }, "list_3d_scenes_tool", {});
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { available: boolean; scenes: { id: string; params: { properties: Record<string, unknown> } }[] };
    expect(data.available).toBe(true);
    expect(data.scenes.map((s) => s.id)).toEqual(["title_3d", "device_mockup", "floating_cards", "icon_cube", "cube_cut", "glass_hero", "particle_burst"]);
    expect(Object.keys(data.scenes[0]!.params.properties)).toContain("text");
    const elsewhere = await runTool({ doc: fixtureDoc(), host: fakeHost() }, "list_3d_scenes_tool", {});
    expect((dataOf(elsewhere) as { available: boolean }).available).toBe(false);
  });
});

describe("add_3d_scene_tool", () => {
  it("renders, imports and places a scene above the video in one undo step, with its spec on the file", async () => {
    const doc = fixtureDoc();
    const { host, requests } = scenesHost();
    const result = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "title_3d", params: { text: "Launch", style: "glass" }, position_seconds: 2 });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add 3D title_3d"]);
    // Defaults filled before rendering; 3 s at the project's 30 fps, its full 1280x720.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ scene: "title_3d", quality: "final", frames: 90, width: 1280, height: 720, media: {} });
    expect(requests[0]!.params).toMatchObject({ text: "Launch", style: "glass", animation: "tumble", background: "transparent", depth: 0.35 });
    const data = dataOf(result) as { file_id: string; timeline_clip_id: string; position: number; duration: number; layer: number; render: { alpha: boolean } };
    expect(data).toMatchObject({ position: 2, duration: 3 });
    expect(data.render.alpha).toBe(true);
    // The logo is on the third track from 2 s to 5 s: the title goes above it.
    expect(data.layer).toBeGreaterThan(L3);
    const clip = doc.project.clips.find((c) => c.id === data.timeline_clip_id)!;
    expect(clip.title).toBe("3D Launch");
    const file = doc.project.files.find((f) => f.id === data.file_id)!;
    const link = readBlenderLink(file)!;
    expect(link.scene).toBe("title_3d");
    expect(link.props).toMatchObject({ text: "Launch", style: "glass" });
    expect(link.link).toMatchObject({ kind: "blender", version: 1, state: "fresh", render: { codec: "prores4444", duration_frames: 90, fingerprint: "1".repeat(64) }, scenes3d: { quality: "final" } });
    expect(pathLikeKeys(file.zenvi_link)).toEqual([]);
    doc.undo();
    expect(doc.project.files.some((f) => f.id === data.file_id)).toBe(false);
    expect(doc.project.clips.some((c) => c.id === data.timeline_clip_id)).toBe(false);
  });

  it("passes bin media to the scene by slot", async () => {
    const doc = fixtureDoc();
    const { host, requests } = scenesHost();
    const result = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "floating_cards", params: { file_ids: [IDS.broll, IDS.logo], background: "dark" }, quality: "draft" });
    expect(result.ok, result.text).toBe(true);
    expect(Object.keys(requests[0]!.media)).toEqual(["card0", "card1"]);
    expect(requests[0]!.media.card0).toMatchObject({ fileId: IDS.broll, kind: "video", path: "/media/broll.mp4", start: 0 });
    expect(requests[0]!.media.card1).toMatchObject({ fileId: IDS.logo, kind: "image" });
    expect((dataOf(result) as { render: { alpha: boolean; quality: string } }).render).toMatchObject({ alpha: false, quality: "draft" });
  });

  it("refuses bad params and unknown media before rendering, leaving history untouched", async () => {
    const doc = fixtureDoc();
    const { host, requests } = scenesHost();
    const noText = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "title_3d", params: { style: "neon" } });
    expect(noText.ok).toBe(false);
    expect(noText.text).toContain("text:");
    expect(noText.text).toContain("style:");
    const unknown = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "device_mockup", params: { file_id: "NOPE000000" } });
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toContain("unknown file id NOPE000000");
    const audio = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "device_mockup", params: { file_id: IDS.music } });
    expect(audio.ok).toBe(false);
    expect(requests).toHaveLength(0);
    expect(doc.undoLabels).toEqual([]);
  });

  it("a failed render is an error and adds nothing", async () => {
    const doc = fixtureDoc();
    const { host } = scenesHost("Blender exited (code 1)");
    const before = doc.project.files.length;
    const result = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "glass_hero" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Blender exited (code 1)");
    expect(doc.undoLabels).toEqual([]);
    expect(doc.project.files).toHaveLength(before);
  });

  it("puts cube_cut over the cut, with each side's footage where it is at the start and end", async () => {
    const doc = fixtureDoc();
    const { host, requests } = scenesHost();
    // CLIPINTV01 plays 0-10 s, CLIPBROL01 10-15 s (from its media's start), both on the first track.
    const result = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "cube_cut", params: { from_clip_id: IDS.clipA, to_clip_id: IDS.clipB, direction: "up" } });
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { position: number; duration: number; layer: number };
    expect(data.position).toBeCloseTo(9.6, 6);
    expect(data.duration).toBeCloseTo(0.8, 6);
    expect(data.layer).toBeGreaterThan(L1);
    expect(requests[0]!.frames).toBe(24);
    expect(requests[0]!.media.from).toMatchObject({ fileId: IDS.interview, start: 9.6 });
    // B starts at its media's first frame, so its face holds that frame until the cut.
    expect(requests[0]!.media.to).toMatchObject({ fileId: IDS.broll, start: 0 });
    expect(JSON.parse(result.text).warnings.join(" ")).toContain("holds the first frame");
    expect(requests[0]!.params).toMatchObject({ background: "dark", direction: "up" });
  });

  it("refuses cube_cut away from a cut or with a transparent background", async () => {
    const doc = fixtureDoc();
    const { host, requests } = scenesHost();
    const apart = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "cube_cut", params: { from_clip_id: IDS.clipA, to_clip_id: IDS.clipTail } });
    expect(apart.ok).toBe(false);
    expect(apart.text).toContain("goes on a cut");
    const clear = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "cube_cut", params: { from_clip_id: IDS.clipA, to_clip_id: IDS.clipB, background: "transparent" } });
    expect(clear.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("is not offered where the host cannot render 3D", async () => {
    const result = await runTool({ doc: fixtureDoc(), host: fakeHost() }, "add_3d_scene_tool", { scene: "glass_hero" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Zenvi 3D");
  });
});

describe("rerender_3d_scene_tool", () => {
  it("renders with merged params and swaps the movie into the same file in one undo step", async () => {
    const doc = fixtureDoc();
    const { host, requests } = scenesHost();
    const added = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "title_3d", params: { text: "Launch" }, quality: "draft" });
    const { file_id: fileId, timeline_clip_id: clipId } = dataOf(added) as { file_id: string; timeline_clip_id: string };
    const oldPath = doc.project.files.find((f) => f.id === fileId)!.path;
    const result = await runTool({ doc, host }, "rerender_3d_scene_tool", { timeline_clip_id: clipId, params: { style: "plastic" }, quality: "final" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add 3D title_3d", "Re-render 3D title_3d"]);
    expect(requests[1]!.params).toMatchObject({ text: "Launch", style: "plastic" });
    expect(requests[1]!.quality).toBe("final");
    const file = doc.project.files.find((f) => f.id === fileId)!;
    expect(file.path).not.toBe(oldPath);
    expect(doc.project.clips.find((c) => c.id === clipId)!.reader).toMatchObject({ path: file.path });
    expect(readBlenderLink(file)!.link).toMatchObject({ props: { style: "plastic" }, scenes3d: { quality: "final" } });
    doc.undo();
    expect(doc.project.files.find((f) => f.id === fileId)!.path).toBe(oldPath);
  });

  it("follows a new length on clips that showed the whole render", async () => {
    const doc = fixtureDoc();
    const { host } = scenesHost();
    const added = await runTool({ doc, host }, "add_3d_scene_tool", { scene: "particle_burst" });
    const { file_id: fileId, timeline_clip_id: clipId } = dataOf(added) as { file_id: string; timeline_clip_id: string };
    const result = await runTool({ doc, host }, "rerender_3d_scene_tool", { file_id: fileId, duration_seconds: 3 });
    expect(result.ok, result.text).toBe(true);
    expect(Number(doc.project.clips.find((c) => c.id === clipId)!.end)).toBeCloseTo(3, 6);
  });

  it("refuses files that are not 3D renders", async () => {
    const { host, requests } = scenesHost();
    const result = await runTool({ doc: fixtureDoc(), host }, "rerender_3d_scene_tool", { file_id: IDS.broll });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("not a Zenvi 3D render");
    expect(requests).toHaveLength(0);
  });
});
