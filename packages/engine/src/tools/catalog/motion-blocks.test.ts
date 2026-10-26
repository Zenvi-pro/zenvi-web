import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { decodeLinkProps, encodeLinkProps, readMotionLink } from "../../links/zenvi-link.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import { listTools, runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { media, videoInfo } from "../test-support/fixture.js";
import { FAKE_MOTION_BLOCK, fakeMotionHost, type FakeMotionHost } from "../test-support/fake-motion.js";
import type { ToolHost } from "../types.js";

function project(): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id: "MOTIONBLK1", profile: findProfile("FHD Vertical 1080p 30 fps")! }));
  doc.transaction("fixture", (tx) => {
    addFile(tx, media("/media/shot.mp4", videoInfo("/media/shot.mp4", 20)), { id: "SHOTXXXXXX" });
    addClip(tx, { fileId: "SHOTXXXXXX", position: 0, layer: 1_000_000, start: 0, end: 10, id: "SHOTCLIP01" });
  });
  return new ProjectDocument(doc.project);
}

type Data = Record<string, unknown>;
const dataOf = (result: { data?: unknown }): Data => (result.data as { data: Data }).data;

function host(motion: FakeMotionHost = fakeMotionHost()): ToolHost {
  return { ...fakeHost(), motion };
}

describe("motion block tools", () => {
  it("are listed only where the host can render", () => {
    const names = (h: ToolHost) => listTools({ surface: "cli", host: h }).map((t) => t.name);
    expect(names(host())).toEqual(expect.arrayContaining(["list_motion_blocks_tool", "add_motion_block_tool", "update_motion_block_tool"]));
    expect(names(fakeHost({ without: ["motion"] }))).not.toContain("add_motion_block_tool");
  });

  it("lists blocks and one block's params", async () => {
    const doc = project();
    const all = await runTool({ doc, host: host() }, "list_motion_blocks_tool", {});
    expect(all.ok).toBe(true);
    const summary = (r: { data?: unknown }): string => (r.data as { summary: string }).summary;
    expect(summary(all)).toContain("kinetic_headline");
    const one = await runTool({ doc, host: host() }, "list_motion_blocks_tool", { block: "kinetic_headline" });
    expect(summary(one)).toContain('text (string, default "Hello"): The headline.');
    expect((await runTool({ doc, host: host() }, "list_motion_blocks_tool", { block: "nope" })).ok).toBe(false);
  });

  it("renders and places a block over the video as one undo step, with its spec on the file", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    const result = await runTool({ doc, host: host(motion) }, "add_motion_block_tool", { block: "kinetic_headline", params: '{"text": "Big *news*"}', position_seconds: "2" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add motion block kinetic_headline"]);
    expect(motion.requests[0]).toMatchObject({ width: 1080, height: 1920, fps: { num: 30, den: 1 }, seconds: 3, alpha: true, motionBlurSamples: 1, draft: false });
    const data = dataOf(result);
    expect(data).toMatchObject({ position: 2, duration: 3, codec: "prores4444", alpha: true });
    const file = doc.project.files.find((f) => f.id === data.file_id)!;
    expect(file.path).toBe("/links/kinetic_headline-1.mov");
    expect(file.zenvi_link).toMatchObject({ kind: "zenvi-motion", version: 1, state: "fresh", source: { composition: "kinetic_headline" }, render: { codec: "prores4444", width: 1080, height: 1920, duration_frames: 90 } });
    expect(readMotionLink(file)).toMatchObject({ block: "kinetic_headline", params: { text: "Big *news*" }, seconds: 3, alpha: true });
    const clip = doc.project.clips.find((c) => c.id === data.timeline_clip_id)!;
    expect(clip).toMatchObject({ position: 2, start: 0, end: 3 });
    expect(Number(clip.layer)).toBeGreaterThan(1_000_000);
  });

  it("refuses bad requests before rendering, leaving history untouched", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    const h = host(motion);
    for (const args of [
      { block: "nope" },
      { block: "kinetic_headline", params: { colour: "red" } },
      { block: "kinetic_headline", params: "not json" },
      { block: "kinetic_headline", duration_seconds: 30 },
      { block: "kinetic_headline", params: { background: "MISSINGXXX" } },
    ]) {
      const result = await runTool({ doc, host: h }, "add_motion_block_tool", args);
      expect(result.ok, JSON.stringify(args)).toBe(false);
      expect(result.text).toContain("Error");
    }
    expect(motion.requests).toHaveLength(0);
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("refuses a media param of the wrong kind before rendering", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    const photoOnly = { ...FAKE_MOTION_BLOCK, params: FAKE_MOTION_BLOCK.params.map((p) => (p.type === "media" ? { ...p, accept: ["image"] } : p)) };
    motion.blocks = () => [photoOnly];
    const result = await runTool({ doc, host: host(motion) }, "add_motion_block_tool", { block: "kinetic_headline", params: { background: "SHOTXXXXXX" } });
    expect(result.text).toContain("background takes a photo, and SHOTXXXXXX is a video");
    expect(motion.requests).toHaveLength(0);
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("renders whole frames, so the clip never outruns its media", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    const data = dataOf(await runTool({ doc, host: host(motion) }, "add_motion_block_tool", { block: "kinetic_headline", duration_seconds: 3.31 }));
    expect(motion.requests[0]!.seconds).toBeCloseTo(3.3, 9);
    const clip = doc.project.clips.find((c) => c.id === data.timeline_clip_id)!;
    const file = doc.project.files.find((f) => f.id === data.file_id)!;
    expect(Number(clip.end)).toBeLessThanOrEqual(Number(file.duration));
  });

  it("passes media params as project paths and renders full frame when asked", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    const result = await runTool({ doc, host: host(motion) }, "add_motion_block_tool", { block: "kinetic_headline", params: { background: "SHOTXXXXXX" }, placement: "full_frame", motion_blur: 4 });
    expect(result.ok, result.text).toBe(true);
    expect(motion.requests[0]).toMatchObject({ media: { background: "/media/shot.mp4" }, alpha: false, motionBlurSamples: 4 });
  });

  it("reports a failed render without an undo step", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    motion.render = async () => {
      throw new Error("Zenvi Motion needs headless Chrome");
    };
    const result = await runTool({ doc, host: host(motion) }, "add_motion_block_tool", { block: "kinetic_headline" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("needs headless Chrome");
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("updates a block: merges params, re-renders, swaps every clip in one undo step", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    const h = host(motion);
    const added = dataOf(await runTool({ doc, host: h }, "add_motion_block_tool", { block: "kinetic_headline", params: { text: "One" } }));
    const result = await runTool({ doc, host: h }, "update_motion_block_tool", { clip_id: added.timeline_clip_id, params: { text: "Two" }, duration_seconds: 5 });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add motion block kinetic_headline", "Update motion block kinetic_headline"]);
    const file = doc.project.files.find((f) => f.id === added.file_id)!;
    expect(file.path).toBe("/links/kinetic_headline-2.mov");
    expect(readMotionLink(file)).toMatchObject({ params: { text: "Two" }, seconds: 5 });
    const clip = doc.project.clips.find((c) => c.id === added.timeline_clip_id)!;
    expect((clip.reader as { path: string }).path).toBe("/links/kinetic_headline-2.mov");
    expect(clip.end).toBe(5);
    doc.undo(1);
    expect(doc.project.files.find((f) => f.id === added.file_id)!.path).toBe("/links/kinetic_headline-1.mov");
  });

  it("refuses a length that would leave a trimmed clip empty", async () => {
    const doc = project();
    const motion = fakeMotionHost();
    const h = host(motion);
    const added = dataOf(await runTool({ doc, host: h }, "add_motion_block_tool", { block: "kinetic_headline" }));
    doc.transaction("trim", (tx) => patchClip(tx, String(added.timeline_clip_id), { start: 2 }));
    const result = await runTool({ doc, host: h }, "update_motion_block_tool", { file_id: added.file_id, duration_seconds: 1.5 });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("starts 2s into the block");
    expect(motion.requests).toHaveLength(1);
    expect(doc.undoLabels).toEqual(["Add motion block kinetic_headline", "trim"]);
  });

  it("answers unchanged when the new spec renders the same", async () => {
    const doc = project();
    const h = host();
    const added = dataOf(await runTool({ doc, host: h }, "add_motion_block_tool", { block: "kinetic_headline", params: { text: "Same" } }));
    const result = await runTool({ doc, host: h }, "update_motion_block_tool", { file_id: added.file_id, params: { text: "Same" } });
    expect(result.ok).toBe(true);
    expect((result.data as { status: string }).status).toBe("unchanged");
    expect(doc.undoLabels).toHaveLength(1);
    expect((await runTool({ doc, host: h }, "update_motion_block_tool", { file_id: "SHOTXXXXXX" })).text).toContain("not a Zenvi Motion block");
  });
});

type Receipt = { status: string; summary: string; warnings: string[]; undoSteps: number; data?: Data };
const receiptOf = (result: { data?: unknown }): Receipt => result.data as Receipt;

describe("the motion runtime (headless Chrome)", () => {
  it("is named in the block list when it is missing, with the size of the download", async () => {
    const doc = project();
    for (const args of [{}, { block: "kinetic_headline" }]) {
      const listed = receiptOf(await runTool({ doc, host: host(fakeMotionHost({ installed: false })) }, "list_motion_blocks_tool", args));
      expect(listed.summary).toContain("Warning: Headless Chrome is not installed");
      expect(listed.summary).toContain("about 90 MB");
      expect(listed.warnings).toHaveLength(1);
      expect(listed.data?.runtime).toMatchObject({ ready: false, downloadMb: 90 });
    }
    const ready = receiptOf(await runTool({ doc, host: host() }, "list_motion_blocks_tool", {}));
    expect(ready.summary).not.toContain("Warning");
    expect(ready.warnings).toEqual([]);
    expect(ready.data?.runtime).toMatchObject({ ready: true });
  });

  it("is silent on a host that renders elsewhere", async () => {
    const listed = receiptOf(await runTool({ doc: project(), host: host(fakeMotionHost({ remote: true })) }, "list_motion_blocks_tool", {}));
    expect(listed.warnings).toEqual([]);
    expect(listed.data?.runtime).toBeUndefined();
  });

  it("is installed by setup_motion_runtime_tool, once, with no undo step", async () => {
    const doc = project();
    const motion = fakeMotionHost({ installed: false });
    const done = receiptOf(await runTool({ doc, host: host(motion) }, "setup_motion_runtime_tool", {}));
    expect(done).toMatchObject({ status: "applied", undoSteps: 0 });
    expect(done.summary).toMatch(/^Installed headless Chrome\./);
    expect(motion.setups).toBe(1);
    expect(doc.undoLabels).toEqual([]);
    const again = receiptOf(await runTool({ doc, host: host(motion) }, "setup_motion_runtime_tool", {}));
    expect(again.status).toBe("unchanged");
    expect(motion.setups).toBe(1);
    expect(receiptOf(await runTool({ doc, host: host(motion) }, "list_motion_blocks_tool", {})).warnings).toEqual([]);
  });

  it("is never installed by anything but that call", async () => {
    const motion = fakeMotionHost({ installed: false });
    const h = host(motion);
    const doc = project();
    await runTool({ doc, host: h }, "list_motion_blocks_tool", {});
    await runTool({ doc, host: h }, "mcp_health_tool", {});
    expect(motion.setups).toBe(0);
  });

  it("is refused with a reason where the host renders for itself (cloud)", async () => {
    const result = await runTool({ doc: project(), host: host(fakeMotionHost({ remote: true })) }, "setup_motion_runtime_tool", {});
    expect(result.ok).toBe(false);
    expect(receiptOf(result).summary).toMatch(/^Error: setup_motion_runtime_tool is not available in this Zenvi surface: this host renders motion blocks itself/);
  });

  it("reports a failed install and how to retry", async () => {
    const motion = fakeMotionHost({ installed: false, setupError: "getaddrinfo ENOTFOUND storage.googleapis.com" });
    const result = await runTool({ doc: project(), host: host(motion) }, "setup_motion_runtime_tool", {});
    expect(result.ok).toBe(false);
    expect(receiptOf(result).summary).toMatch(/^Error: the motion runtime could not be installed: getaddrinfo ENOTFOUND.*zenvi motion setup/);
  });

  it("is in mcp_health_tool", async () => {
    const doc = project();
    const missing = receiptOf(await runTool({ doc, host: host(fakeMotionHost({ installed: false })) }, "mcp_health_tool", {}));
    expect(missing.summary).toMatch(/^Zenvi is up\. Zenvi Motion blocks: Headless Chrome is not installed/);
    expect(missing.warnings).toHaveLength(1);
    expect(missing.data).toMatchObject({ ok: true, motion: { available: true, runtime: { ready: false } } });
    const none = receiptOf(await runTool({ doc, host: fakeHost({ without: ["motion"] }) }, "mcp_health_tool", {}));
    expect(none.summary).toBe("Zenvi is up. Zenvi Motion blocks: not available on this host.");
    expect(none.data).toMatchObject({ ok: true, motion: { available: false } });
  });
});

describe("params taken as a near miss", () => {
  it("are named in the receipt's warnings, on add and on update", async () => {
    const note = 'style "scale pop" was taken as "pop"; the options are rise, blur, pop, wipe.';
    const motion = fakeMotionHost({ warnings: [note] });
    const doc = project();
    const added = await runTool({ doc, host: host(motion) }, "add_motion_block_tool", { block: "kinetic_headline" });
    expect(receiptOf(added).warnings).toEqual([note]);
    const updated = await runTool({ doc, host: host(motion) }, "update_motion_block_tool", { file_id: dataOf(added).file_id, params: { text: "Changed" } });
    expect(receiptOf(updated).warnings).toEqual([note]);
  });
});

describe("zenvi_link props", () => {
  it("JSON-encodes props with keys the desktop rewrites as paths", () => {
    const stored = encodeLinkProps({ image: "a.png", n: 1 });
    expect(Object.keys(stored)).toEqual(["$zenvi_json"]);
    expect(decodeLinkProps(stored)).toEqual({ image: "a.png", n: 1 });
    expect(encodeLinkProps({ text: "hi" })).toEqual({ text: "hi" });
  });
});
