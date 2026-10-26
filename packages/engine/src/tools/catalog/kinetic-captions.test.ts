import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import type { Clip } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost, type FakeHostOptions } from "../test-support/fake-host.js";
import { L1, SPOKEN_WORDS, imageInfo, media, snapshotOf, videoInfo } from "../test-support/fixture.js";
import { KINETIC_KEY, emphasisArg, kineticTag } from "./kinetic-captions.js";

/** A fake host that probes the SVGs it wrote for their real size (the fake recognizer hears SPOKEN_WORDS). */
function host(options: FakeHostOptions = {}): FakeHost {
  const h = fakeHost(options);
  if (h.media) {
    const probe = h.media.probe;
    h.media.probe = async (path) => {
      const svg = h.written.get(path);
      if (svg === undefined) return probe(path);
      const text = typeof svg === "string" ? svg : new TextDecoder().decode(svg);
      const width = Number(/width="(\d+)"/.exec(text)?.[1]);
      const height = Number(/height="(\d+)"/.exec(text)?.[1]);
      return { ...imageInfo(path), width, height, display_ratio: { num: width, den: height } };
    };
  }
  return h;
}

/** A vertical project with a talking clip at 2 s (and optionally its subject matte in the bin). */
function talking(matte = false): { doc: ProjectDocument; clipId: string } {
  const scratch = new ProjectDocument(createProject({ id: "CAPTIONS01", profile: findProfile("FHD Vertical 1080p 30 fps")! }));
  const clipId = scratch.transaction("fixture", (tx) => {
    const file = addFile(tx, media("/media/talk.mp4", videoInfo("/media/talk.mp4", 10)), { id: "TALKXXXXXX" });
    if (matte) {
      const m = addFile(tx, media("/media/talk-matte.mp4", videoInfo("/media/talk-matte.mp4", 10)), { id: "MATTEXXXXX" });
      tx.update(["files", { id: m.id }], { zenvi_matte: { source_file_id: file.id, source_path: "/media/talk.mp4", subject: "person" } });
    }
    return addClip(tx, { fileId: file.id, position: 2, layer: L1, start: 0, end: 10, id: "TALKCLIP01" }).id;
  });
  return { doc: new ProjectDocument(scratch.project), clipId };
}

const dataOf = (r: { data?: unknown }) => (r.data as { data: Record<string, unknown> }).data;
const captionClips = (doc: ProjectDocument): Clip[] => doc.project.clips.filter((c) => kineticTag(c));

describe("kinetic_captions_tool", () => {
  it("captions the speech word by word in one undo step, on the words' frames", async () => {
    const { doc, clipId } = talking();
    const h = host();
    const r = await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "creator", avoid: [{ x: 0.5, y: 0.3, w: 0.4, h: 0.3 }] });
    expect(r.ok, r.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add kinetic captions (creator)"]);
    const clips = captionClips(doc);
    expect(clips.length).toBe(SPOKEN_WORDS.length);
    // The clip is at 2 s: each word's clip starts within a frame of 2 s + its source time.
    const starts = clips.map((c) => Number(c.position)).sort((a, b) => a - b);
    SPOKEN_WORDS.forEach((w, i) => expect(Math.abs(starts[i]! - (2 + w.startSec))).toBeLessThanOrEqual(1 / 30 + 1e-9));
    for (const c of clips) expect(kineticTag(c)).toMatchObject({ source_clip_ids: [clipId], style: "creator", role: "caption" });
    const tracks = new Set(clips.map((c) => c.layer));
    for (const t of tracks) expect(doc.project.layers.find((l) => Number(l.number) === t)?.label).toBe("Captions");
    expect(Math.min(...tracks)).toBeGreaterThan(L1);
    const data = dataOf(r);
    expect(data.emphasis).toEqual(expect.arrayContaining(["cameras"]));
    doc.undo();
    expect(captionClips(doc)).toHaveLength(0);
    expect(doc.project.files.filter((f) => kineticTag(f))).toHaveLength(0);
  });

  it("replaces its earlier captions of the same clip when run again", async () => {
    const { doc } = talking();
    const h = host();
    await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "creator" });
    const first = captionClips(doc).map((c) => c.id);
    const filesBefore = doc.project.files.length;
    const r = await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "documentary" });
    expect(r.ok, r.text).toBe(true);
    const second = captionClips(doc);
    expect(second.every((c) => !first.includes(c.id))).toBe(true);
    expect(second.every((c) => kineticTag(c)!.style === "documentary")).toBe(true);
    expect(dataOf(r).replaced_clips).toBe(first.length);
    // Old drawings left the bin with their clips: the bin holds only the new drawings.
    expect(doc.project.files.filter((f) => kineticTag(f)).length).toBe(new Set(second.map((c) => c.file_id)).size);
    expect(doc.project.files.length).toBeLessThan(filesBefore);
    expect(doc.undoLabels).toHaveLength(2);
    doc.undo();
    expect(captionClips(doc).map((c) => c.id).sort()).toEqual([...first].sort());
  });

  it("puts a matte cut-out of the speaker above the captions for behind_subject", async () => {
    const { doc, clipId } = talking(true);
    const r = await runTool({ doc, host: host() }, "kinetic_captions_tool", { style: "stack", behind_subject: true });
    expect(r.ok, r.text).toBe(true);
    const cutouts = doc.project.clips.filter((c) => kineticTag(c)?.role === "cutout");
    expect(cutouts).toHaveLength(1);
    const cut = cutouts[0]!;
    expect(cut.file_id).toBe("TALKXXXXXX");
    expect(cut.effects?.[0]).toMatchObject({ type: "Mask", mask_invert: true, mask_reader: { id: "MATTEXXXXX" } });
    expect(Number(cut.layer)).toBeGreaterThan(Math.max(...captionClips(doc).filter((c) => kineticTag(c)!.role === "caption").map((c) => Number(c.layer))));
    expect([cut.position, cut.start, cut.end]).toEqual([2, 0, 10]);
    expect(kineticTag(cut)!.source_clip_ids).toEqual([clipId]);
  });

  it("refuses what it cannot do, leaving the project as it was", async () => {
    const { doc } = talking();
    const before = snapshotOf(doc.project);
    const noMatte = await runTool({ doc, host: host() }, "kinetic_captions_tool", { behind_subject: true });
    expect(noMatte.ok).toBe(false);
    expect(noMatte.text).toContain("subject matte");
    const unknown = await runTool({ doc, host: host() }, "kinetic_captions_tool", { timeline_clip_ids: ["NOPE"] });
    expect(unknown.text).toContain("unknown timeline clip NOPE");
    const range = await runTool({ doc, host: host() }, "kinetic_captions_tool", { start_seconds: 5, end_seconds: 4 });
    expect(range.ok).toBe(false);
    const fonts = await runTool({ doc, host: host({ without: ["assets"] }) }, "kinetic_captions_tool", {});
    expect(fonts.text).toContain("not available");
    expect(snapshotOf(doc.project)).toEqual(before);
    // Nothing said in the range: refused after transcribing (the transcript is kept on the file, outside history).
    const empty = await runTool({ doc, host: host() }, "kinetic_captions_tool", { start_seconds: 100 });
    expect(empty.text).toContain("no words to caption");
    expect(doc.undoLabels).toHaveLength(0);
    expect(captionClips(doc)).toHaveLength(0);
  });

  it("takes an emphasis list and a range of the timeline", async () => {
    const { doc } = talking();
    const r = await runTool({ doc, host: host() }, "kinetic_captions_tool", { style: "editorial", emphasis: ["today"], start_seconds: 4.5 });
    expect(r.ok, r.text).toBe(true);
    const groups = dataOf(r).groups as { words: { text: string; start: number; emphasis?: boolean }[] }[];
    const words = groups.flatMap((g) => g.words);
    expect(words[0]!.text.toLowerCase()).toBe("um,");
    expect(words.filter((w) => w.emphasis).map((w) => w.text)).toEqual(["today"]);
    expect(captionClips(doc).every((c) => (c as Record<string, unknown>)[KINETIC_KEY])).toBe(true);
    expect(emphasisArg("Time, big idea")).toEqual(["Time", "big idea"]);
    expect(emphasisArg(" AUTO ")).toBe("auto");
    expect(emphasisArg("none")).toBe("none");
  });
});
