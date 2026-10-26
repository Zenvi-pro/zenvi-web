import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { DEFAULT_PROFILE_DESCRIPTION, findProfile } from "../../model/profiles.js";
import type { Clip, Effect, Project } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { applyMask } from "../../render/kernels/mask.js";
import { planFrame } from "../../render/plan/frame-plan.js";
import type { RgbaImage } from "../../render/types.js";
import { COMPOSITE_KEY, MATTE_KEY } from "../mattes.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { L1, media, videoInfo } from "../test-support/fixture.js";
import type { MatteHost } from "../types.js";

const TALK = "/media/talk.mp4";
const MATTE = "/assets/mattes/talk.person-matte.mp4";

/** 720p 30 fps; talk.mp4 (8 s) on track 1 from 2 s, playing its 1-5 s. */
function doc(): ProjectDocument {
  const d = new ProjectDocument(createProject({ id: "MATTEPRJ01", profile: findProfile(DEFAULT_PROFILE_DESCRIPTION)! }));
  d.transaction("fixture", (tx) => {
    addFile(tx, media(TALK, videoInfo(TALK, 8)), { id: "TALKFILE01" });
    addFile(tx, media("/media/beach.jpg"), { id: "BEACHFILE1" });
    addClip(tx, { fileId: "TALKFILE01", position: 2, layer: L1, start: 1, end: 5, id: "TALKCLIP01" });
  });
  return d;
}

function matting(host: FakeHost): FakeHost {
  const mattes: MatteHost = {
    subjects: ["person"],
    async generate(path, request) {
      host.calls.push(`matte ${path} ${request.subject} ${request.scale}`);
      return { media: media(MATTE, videoInfo(MATTE, 8, { has_audio: false })), model: "test_matte", version: "0.1", license: "MIT", frames: 240, fps: 60 };
    },
  };
  host.mattes = mattes;
  return host;
}

async function run(d: ProjectDocument, host: FakeHost, tool: string, args: Record<string, unknown>): Promise<ToolReceipt> {
  return (await runTool({ doc: d, host }, tool, args)).data as ToolReceipt;
}

/** Text the fake host was given to write at `path`. */
function writtenText(host: FakeHost, path: unknown): string {
  const bytes = host.written.get(String(path));
  return typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
}

function clip(project: Project, id: string): Clip {
  return project.clips.find((c) => c.id === id)!;
}

function piece(project: Project, role: string): Clip {
  return project.clips.find((c) => (c as Record<string, { role?: string }>)[COMPOSITE_KEY]?.role === role)!;
}

function types(c: Clip): string[] {
  return (c.effects ?? []).map((e) => String(e.type));
}

function mask(c: Clip): Effect {
  return (c.effects ?? []).find((e) => e.type === "Mask")!;
}

describe("subject mattes", () => {
  it("refuses a composite when the file has no matte and the host cannot make one, recording nothing", async () => {
    const d = doc();
    const before = d.undoLabels.length;
    const receipt = await run(d, fakeHost(), "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "TIME" });
    expect(receipt.status).toBe("refused");
    expect(receipt.summary).toMatch(/^Error: text_behind_subject_tool is not available in this Zenvi surface: .*no person matte/);
    expect(d.undoLabels.length).toBe(before);
    expect(d.project.clips).toHaveLength(1);
  });

  it("generate_subject_matte_tool needs a matting host", async () => {
    const receipt = await run(doc(), fakeHost(), "generate_subject_matte_tool", { clip_id: "TALKCLIP01" });
    expect(receipt.summary).toMatch(/not available.*subject matting/);
  });

  it("generates a matte once, linked to its source", async () => {
    const d = doc();
    const host = matting(fakeHost());
    const first = await run(d, host, "generate_subject_matte_tool", { clip_id: "TALKCLIP01" });
    expect(first.status).toBe("applied");
    expect(first.undoSteps).toBe(1);
    const data = first.data as { matte_file_id: string; matting_fps: number };
    const file = d.project.files.find((f) => f.id === data.matte_file_id)!;
    expect(file.path).toBe(MATTE);
    expect(file.tags).toBe("matte");
    expect((file as Record<string, unknown>)[MATTE_KEY]).toMatchObject({ source_file_id: "TALKFILE01", source_path: TALK, subject: "person", model: "test_matte", scale: 1, frames: 240 });
    expect(data.matting_fps).toBe(60);
    const again = await run(d, host, "generate_subject_matte_tool", { file_id: "TALKFILE01" });
    expect(again.status).toBe("unchanged");
    expect(host.calls.filter((c) => c.startsWith("matte"))).toEqual([`matte ${TALK} person 1`]);
  });

  it("puts new text between the footage and the cut-out, in one undo step", async () => {
    const d = doc();
    const host = matting(fakeHost());
    const before = d.undoLabels.length;
    const receipt = await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "TIME", color: "#ff2020" });
    expect(receipt.status).toBe("applied");
    expect(d.undoLabels.length).toBe(before + 1);
    const p = d.project;
    const text = piece(p, "text");
    const cut = piece(p, "cutout");
    const source = clip(p, "TALKCLIP01");
    expect(source.layer).toBeLessThan(text.layer);
    expect(text.layer).toBeLessThan(cut.layer);
    // The cut-out is the footage clip again: same window, muted, Mask reading the matte with white kept.
    expect([cut.position, cut.start, cut.end, cut.file_id]).toEqual([source.position, source.start, source.end, source.file_id]);
    expect(cut.has_audio).toMatchObject({ Points: [{ co: { Y: 0 } }] });
    expect(types(cut)).toEqual(["Mask"]);
    expect(mask(cut)).toMatchObject({ mask_invert: true, mask_time_mode: 1, mask_reader: { path: MATTE, type: "FFmpegReader" } });
    expect([text.position, text.end - text.start]).toEqual([2, 4]);
    const svg = writtenText(host, p.files.find((f) => f.id === text.file_id)!.path);
    expect(svg).toContain(">TIME</tspan>");
    expect(svg).toContain('fill="#ff2020"');
    const data = receipt.data as { created_clip_ids: string[]; layers: { role: string; effect_ids: string[] }[]; matte_generated: boolean };
    expect(data.created_clip_ids).toEqual([text.id, cut.id]);
    expect(data.layers.map((l) => l.role)).toEqual(["text", "cutout"]);
    expect(data.layers[1]!.effect_ids).toEqual([mask(cut).id]);
    expect(data.matte_generated).toBe(true);
  });

  it("updates the stack on a re-run instead of stacking another, and a same re-run records nothing", async () => {
    const d = doc();
    const host = matting(fakeHost());
    await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "TIME" });
    const ids = [piece(d.project, "text").id, piece(d.project, "cutout").id];
    const firstText = piece(d.project, "text").file_id;
    const steps = d.undoLabels.length;

    const same = await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "TIME" });
    expect(same.status).toBe("unchanged");
    expect(d.undoLabels.length).toBe(steps);

    const changed = await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "IDEA" });
    expect(changed.status).toBe("applied");
    expect(d.undoLabels.length).toBe(steps + 1);
    expect(d.project.clips).toHaveLength(3);
    expect([piece(d.project, "text").id, piece(d.project, "cutout").id]).toEqual(ids);
    expect((changed.data as { updated_clip_ids: string[] }).updated_clip_ids).toEqual(ids);
    // The old text image left the bin; the matte was made once.
    expect(d.project.files.some((f) => f.id === firstText)).toBe(false);
    expect(host.calls.filter((c) => c.startsWith("matte"))).toHaveLength(1);
  });

  it("a same re-run records nothing after other edits, and keeps its tracks under a composite built later", async () => {
    const d = doc();
    const host = matting(fakeHost());
    await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "TIME" });
    d.transaction("other clip", (tx) => addClip(tx, { fileId: "BEACHFILE1", position: 20, layer: L1, start: 0, end: 3, id: "OTHERCLIP1" }));
    await run(d, host, "pop_out_tool", { clip_id: "TALKCLIP01" });
    const layers = d.project.clips.map((c) => [c.id, c.layer]);
    const steps = d.undoLabels.length;
    const same = await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "TIME" });
    expect(same.status).toBe("unchanged");
    expect(d.undoLabels.length).toBe(steps);
    expect(d.project.clips.map((c) => [c.id, c.layer])).toEqual(layers);
  });

  it("refuses to rebuild a stack with a piece on a locked track, recording nothing", async () => {
    const d = doc();
    const host = matting(fakeHost());
    await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "TIME" });
    const text = piece(d.project, "text");
    d.transaction("lock", (tx) => tx.update(["layers", { number: text.layer }], { lock: true }));
    const steps = d.undoLabels.length;
    const receipt = await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", text: "IDEA" });
    expect(receipt.summary).toMatch(/^Error: .*locked track/);
    expect(d.undoLabels.length).toBe(steps);
    expect(piece(d.project, "text").id).toBe(text.id);
  });

  it("refuses to matte a file longer than mattes cover, by file_id too", async () => {
    const d = doc();
    d.transaction("long", (tx) => addFile(tx, media("/media/long.mp4", videoInfo("/media/long.mp4", 900)), { id: "LONGFILE01" }));
    const host = matting(fakeHost());
    const receipt = await run(d, host, "generate_subject_matte_tool", { file_id: "LONGFILE01" });
    expect(receipt.summary).toMatch(/^Error: long\.mp4 is 900 s long/);
    expect(host.calls.filter((c) => c.startsWith("matte"))).toEqual([]);
  });

  it("slips an existing title between the footage and the cut-out", async () => {
    const d = doc();
    d.transaction("title", (tx) => addClip(tx, { fileId: "BEACHFILE1", position: 2, layer: L1 * 3, start: 0, end: 3, id: "TITLECLIP1" }));
    const host = matting(fakeHost());
    const receipt = await run(d, host, "text_behind_subject_tool", { clip_id: "TALKCLIP01", title_clip_id: "TITLECLIP1" });
    expect(receipt.status).toBe("applied");
    expect(piece(d.project, "cutout").layer).toBeGreaterThan(clip(d.project, "TITLECLIP1").layer);
    expect((clip(d.project, "TITLECLIP1") as Record<string, unknown>)[COMPOSITE_KEY]).toBeUndefined();
  });

  it("plans the cut-out with the matte frame of the clip's source frame", async () => {
    const d = doc();
    await run(d, matting(fakeHost()), "pop_out_tool", { clip_id: "TALKCLIP01" });
    const cut = piece(d.project, "cutout");
    // Timeline 3 s = source 2 s (the clip starts at 2 s playing from 1 s) = frame 61 at 30 fps.
    const plan = planFrame(d.project, 91);
    const layers = plan.layers.map((l) => l.clipId);
    expect(layers).toEqual(["TALKCLIP01", piece(d.project, "bars").id, cut.id]);
    const instance = plan.layers[2]!.effects.find((e) => e.type === "Mask")!;
    expect(instance.images).toEqual([MATTE]);
    expect(instance.imageFrames?.[MATTE]?.frame).toBe(61);
  });

  it("keeps the subject where the matte is white (Mask with mask_invert)", () => {
    const image = (rgba: number[], n: number): RgbaImage => ({ width: n, height: 1, data: new Uint8ClampedArray(Array.from({ length: n }, () => rgba).flat()) });
    const frame = image([200, 100, 50, 255], 2);
    const matte: RgbaImage = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) };
    applyMask(frame, matte, { brightness: 0, contrast: 0, replaceImage: false, invert: true });
    expect([...frame.data]).toEqual([200, 100, 50, 255, 0, 0, 0, 0]);
  });

  it("replaces the background with colour, a gradient, a file or the footage blurred", async () => {
    for (const [args, check] of [
      [{ background: "color", color: "#00ff00" }, (bg: Clip, host: FakeHost, p: Project) => expect(writtenText(host, p.files.find((f) => f.id === bg.file_id)!.path)).toContain('fill="#00ff00"')],
      [{ background: "gradient" }, (bg: Clip, host: FakeHost, p: Project) => expect(writtenText(host, p.files.find((f) => f.id === bg.file_id)!.path).match(/<rect /g)!.length).toBeGreaterThan(100)],
      [{ background: "file", file_id: "BEACHFILE1" }, (bg: Clip) => expect([bg.file_id, bg.scale]).toEqual(["BEACHFILE1", 0])],
      [{ background: "blur", blur: 30 }, (bg: Clip) => expect(bg.effects?.[0]).toMatchObject({ type: "Blur", horizontal_radius: { Points: [{ co: { Y: 30 } }] } })],
    ] as const) {
      const d = doc();
      const host = matting(fakeHost());
      const receipt = await run(d, host, "replace_background_tool", { clip_id: "TALKCLIP01", ...args });
      expect(receipt.status, JSON.stringify(receipt)).toBe("applied");
      const bg = piece(d.project, "background");
      expect(bg.layer).toBeLessThan(piece(d.project, "cutout").layer);
      check(bg, host, d.project);
    }
  });

  it("builds a glowing or thermal silhouette from ColorMap LUTs, the Mask and Glow", async () => {
    const d = doc();
    const host = matting(fakeHost());
    await run(d, host, "subject_glow_tool", { clip_id: "TALKCLIP01" });
    const glow = piece(d.project, "silhouette");
    expect(types(glow)).toEqual(["ColorMap", "Mask", "Glow"]);
    expect(writtenText(host, glow.effects![0]!.lut_path)).toMatch(/LUT_3D_SIZE 2\n1 1 1\n/);
    expect(piece(d.project, "background").alpha).toMatchObject({ Points: [{ co: { Y: 0.6 } }] });

    const t = doc();
    await run(t, host, "subject_glow_tool", { clip_id: "TALKCLIP01", look: "thermal" });
    expect(types(piece(t.project, "silhouette"))).toEqual(["ColorMap", "Mask"]);
    const cold = piece(t.project, "background");
    expect([types(cold), cold.file_id]).toEqual([["ColorMap"], "TALKFILE01"]);
  });

  it("refuses a letterbox band the frame already fits", async () => {
    const receipt = await run(doc(), matting(fakeHost()), "pop_out_tool", { clip_id: "TALKCLIP01", band_aspect: 1.5 });
    expect(receipt.summary).toMatch(/no bars/);
  });
});
