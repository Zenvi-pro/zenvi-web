import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { readMotionEvents, readSceneLink } from "../../links/zenvi-link.js";
import { readScene, SCENES_KEY } from "../../links/scene-store.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { listTools, runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { fakeMotionHost } from "../test-support/fake-motion.js";
import { fakeSceneHost, type FakeSceneHost } from "../test-support/fake-scenes.js";
import { media, videoInfo } from "../test-support/fixture.js";
import type { ToolHost } from "../types.js";

function project(): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id: "SCENEPROJ1", profile: findProfile("FHD 1080p 30 fps")! }));
  doc.transaction("fixture", (tx) => {
    addFile(tx, media("/media/shot.mp4", videoInfo("/media/shot.mp4", 20)), { id: "SHOTXXXXXX" });
    addClip(tx, { fileId: "SHOTXXXXXX", position: 0, layer: 1_000_000, start: 0, end: 10, id: "SHOTCLIP01" });
  });
  return new ProjectDocument(doc.project);
}

type Data = Record<string, unknown>;
const dataOf = (result: { data?: unknown }): Data => (result.data as { data: Data }).data;
const said = (result: { data?: unknown; text: string }): string => (result.data as { summary?: string } | undefined)?.summary ?? result.text;

function host(scenes: FakeSceneHost = fakeSceneHost()): ToolHost {
  return { ...fakeHost(), motion: { ...fakeMotionHost(), scenes } };
}

const CODE = "export const fps = 60; // seconds=2\nexport const duration = 120;\nexport function draw(ctx, t, api) { api.text('Hi', { x: 100, y: 100 }); }";

async function created(doc: ProjectDocument, h: ToolHost, code = CODE, more: Data = {}): Promise<string> {
  const r = await runTool({ doc, host: h }, "create_scene_tool", { code, ...more });
  expect(r.ok, r.text).toBe(true);
  return String(dataOf(r).scene_id);
}

describe("scene tools", () => {
  it("are listed where the host can sandbox scenes, and refused cleanly where it cannot", async () => {
    const names = (h: ToolHost) => listTools({ surface: "cli", host: h }).map((t) => t.name);
    expect(names(host())).toEqual(expect.arrayContaining(["create_scene_tool", "update_scene_tool", "render_scene_tool", "scene_cues_tool"]));
    const bare = fakeHost({ without: ["motion"] });
    expect(names(bare)).not.toContain("create_scene_tool");
    expect(names(bare)).toContain("scene_cues_tool");
    const noSandbox = await runTool({ doc: project(), host: { ...fakeHost(), motion: fakeMotionHost({ scenes: false }) } }, "create_scene_tool", { code: CODE });
    expect(noSandbox.ok).toBe(false);
    expect(said(noSandbox)).toMatch(/not available.*sandboxed headless Chrome/);
  });

  it("checks a scene and keeps it in the project as one undo step, with its contact sheet", async () => {
    const doc = project();
    const scenes = fakeSceneHost();
    const r = await runTool({ doc, host: host(scenes) }, "create_scene_tool", { code: `${CODE} EDGE`, params: '{"headline": "Ship", "image": "/not/a/path"}', name: "Opener" });
    expect(r.ok, r.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Create scene Opener"]);
    expect(r.images).toEqual([{ mimeType: "image/jpeg", data: "AAAA" }]);
    expect(scenes.drafts[0]).toMatchObject({ width: 1920, height: 1080, fps: { num: 30, den: 1 }, params: { headline: "Ship" }, allowStrobe: false });
    const data = dataOf(r);
    expect(data).toMatchObject({ name: "Opener", fps: 60, duration_frames: 120, seconds: 2, errors: 0, warnings: 1 });
    expect((data.cues as Data[])[1]).toMatchObject({ name: "land", seconds: 1, kind: "land" });
    expect(said(r)).toContain("safe-area");
    const stored = readScene(doc.project, String(data.scene_id))!;
    expect(stored).toMatchObject({ name: "Opener", params: { headline: "Ship", image: "/not/a/path" } });
    // A params key the desktop would rewrite as a path is stored escaped.
    const raw = (doc.project.settings as Data)[SCENES_KEY] as Record<string, Data>;
    expect(raw[String(data.scene_id)]!.params).toEqual({ $zenvi_json: expect.any(String) });
  });

  it("refuses a scene that does not run, and bad media, without touching the project", async () => {
    const doc = project();
    const broken = await runTool({ doc, host: host() }, "create_scene_tool", { code: "BROKEN" });
    expect(broken.ok).toBe(false);
    expect(said(broken)).toMatch(/did not run[\s\S]*ERROR lint \(line 3\): Math.random/);
    const media = await runTool({ doc, host: host() }, "create_scene_tool", { code: CODE, media: { hero: "NOPE" } });
    expect(said(media)).toMatch(/unknown file id NOPE/);
    const named = await runTool({ doc, host: host() }, "create_scene_tool", { code: CODE, media: { image: "SHOTXXXXXX" } });
    expect(said(named)).toMatch(/media name "image"/);
    const proto = await runTool({ doc, host: host() }, "create_scene_tool", { code: CODE, params: '{"__proto__": {"x": 1}}' });
    expect(said(proto)).toMatch(/cannot have a key named __proto__/);
    const huge = await runTool({ doc, host: host() }, "create_scene_tool", { code: CODE, params: { words: "x".repeat(20_001) } });
    expect(said(huge)).toMatch(/params is too large/);
    expect(doc.undoLabels).toEqual([]);
  });

  it("patches a scene with exact edits and merged params, one step each; the same scene is a no-op", async () => {
    const doc = project();
    const h = host();
    const id = await created(doc, h, CODE, { params: { headline: "A", sub: "B" } });
    const edited = await runTool({ doc, host: h }, "update_scene_tool", { scene_id: id, edits: [{ find: "x: 100", replace: "x: 240" }], params: { sub: null, cta: "Go" } });
    expect(edited.ok, edited.text).toBe(true);
    expect(readScene(doc.project, id)).toMatchObject({ params: { headline: "A", cta: "Go" } });
    expect(readScene(doc.project, id)!.code).toContain("x: 240");
    expect(doc.undoLabels).toEqual(["Create scene Fake scene", "Update scene Fake scene"]);
    const twice = await runTool({ doc, host: h }, "update_scene_tool", { scene_id: id, edits: [{ find: "e", replace: "E" }] });
    expect(said(twice)).toMatch(/occurs more than once/);
    const missing = await runTool({ doc, host: h }, "update_scene_tool", { scene_id: id, edits: [{ find: "nowhere", replace: "x" }] });
    expect(said(missing)).toMatch(/not in the code/);
    const same = await runTool({ doc, host: h }, "update_scene_tool", { scene_id: id, params: { headline: "A" } });
    expect(same.ok).toBe(true);
    expect(said(same)).toMatch(/nothing changed/);
    expect(doc.undoLabels.length).toBe(2);
  });

  it("renders a scene onto the timeline as a linked clip whose cues are its picture events", async () => {
    const doc = project();
    const scenes = fakeSceneHost();
    const h = host(scenes);
    const id = await created(doc, h, `${CODE} ALPHA`);
    const r = await runTool({ doc, host: h }, "render_scene_tool", { scene_id: id, position_seconds: "1.5", motion_blur: 4 });
    expect(r.ok, r.text).toBe(true);
    expect(doc.undoLabels.at(-1)).toBe("Render scene Fake scene");
    expect(scenes.renders[0]).toMatchObject({ alpha: true, motionBlurSamples: 4, draft: false });
    const data = dataOf(r);
    expect(data).toMatchObject({ position: 1.5, duration: 2, codec: "prores4444", events: 2 });
    const file = doc.project.files.find((f) => f.id === data.file_id)!;
    expect(file.zenvi_link).toMatchObject({ kind: "zenvi-scene", version: 1, state: "fresh", source: { composition: "Fake scene", composition_key: id }, render: { codec: "prores4444", duration_frames: 60 } });
    expect(readSceneLink(file)).toMatchObject({ sceneId: id, code: `${CODE} ALPHA`, motionBlurSamples: 4, seconds: 2 });
    expect(readMotionEvents(file)).toEqual([expect.objectContaining({ t: 0.5, kind: "click" }), expect.objectContaining({ t: 1, kind: "land" })]);
    const clip = doc.project.clips.find((c) => c.id === data.timeline_clip_id)!;
    expect(clip).toMatchObject({ position: 1.5, start: 0, end: 2 });

    const cues = await runTool({ doc, host: fakeHost({ without: ["motion"] }) }, "scene_cues_tool", { scene_id: id });
    expect(cues.ok, cues.text).toBe(true);
    expect((dataOf(cues).cues as Data[]).map((c) => c.timeline)).toEqual([[{ clip_id: clip.id, seconds: 2 }], [{ clip_id: clip.id, seconds: 2.5 }], [{ clip_id: clip.id, seconds: 3 }]]);
    expect(said(cues)).toContain("beat: frame 90 (1.500 s) (silent beat)");
  });

  it("re-renders a placed scene in place, and leaves an identical render alone", async () => {
    const doc = project();
    const h = host();
    const id = await created(doc, h);
    const first = await runTool({ doc, host: h }, "render_scene_tool", { scene_id: id });
    const fileId = dataOf(first).file_id;
    const same = await runTool({ doc, host: h }, "render_scene_tool", { scene_id: id });
    expect(said(same)).toMatch(/already rendered/);
    await runTool({ doc, host: h }, "update_scene_tool", { scene_id: id, code: CODE.replace("seconds=2", "seconds=3 (longer)") });
    const again = await runTool({ doc, host: h }, "render_scene_tool", { scene_id: id });
    expect(again.ok, again.text).toBe(true);
    expect(dataOf(again)).toMatchObject({ file_id: fileId, seconds: 3 });
    const file = doc.project.files.find((f) => f.id === fileId)!;
    expect(file.path).toBe("/links/zenvi-scene/scene-3.mp4");
    // The clip showed the whole scene, so it follows the longer one.
    expect(doc.project.clips.filter((c) => c.file_id === fileId).map((c) => c.end)).toEqual([3]);
    expect(doc.project.clips.filter((c) => c.file_id === fileId)).toHaveLength(1);
  });

  it("refuses to render a scene that flashes unless the user asked for a strobe", async () => {
    const doc = project();
    const h = host();
    const id = await created(doc, h, `${CODE} FLASH`);
    const before = doc.undoLabels.length;
    const r = await runTool({ doc, host: h }, "render_scene_tool", { scene_id: id });
    expect(r.ok).toBe(false);
    expect(said(r)).toMatch(/not rendered[\s\S]*ERROR flashing/);
    expect(doc.undoLabels.length).toBe(before);
    await runTool({ doc, host: h }, "update_scene_tool", { scene_id: id, allow_strobe: true });
    expect((await runTool({ doc, host: h }, "render_scene_tool", { scene_id: id })).ok).toBe(true);
  });

  it("lists the project's scenes", async () => {
    const doc = project();
    const h = host();
    expect((await runTool({ doc, host: h }, "scene_cues_tool", {})).text).toMatch(/no scenes/);
    await created(doc, h);
    const all = await runTool({ doc, host: h }, "scene_cues_tool", {});
    expect(said(all)).toMatch(/1 scene\(s\):\n\w+ Fake scene: 2 s, 3 cue\(s\)/);
  });
});
