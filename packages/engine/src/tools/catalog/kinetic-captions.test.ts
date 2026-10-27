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
import { KINETIC_KEY, cueWords, emphasisArg, kineticTag } from "./kinetic-captions.js";

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

  it("re-run on one of two clips replaces only that clip's captions", async () => {
    const { doc, clipId } = talking();
    const other = doc.transaction("second take", (tx) => addClip(tx, { fileId: "TALKXXXXXX", position: 20, layer: L1, start: 0, end: 10, id: "TALKCLIP02" }).id);
    const h = host();
    await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "creator", timeline_clip_ids: [clipId, other] });
    const ofOther = captionClips(doc).filter((c) => kineticTag(c)!.source_clip_ids.includes(other)).map((c) => c.id).sort();
    expect(ofOther.length).toBe(SPOKEN_WORDS.length);
    const r = await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "documentary", timeline_clip_ids: [clipId] });
    expect(r.ok, r.text).toBe(true);
    expect(dataOf(r).replaced_clips).toBe(SPOKEN_WORDS.length);
    const after = captionClips(doc);
    expect(after.filter((c) => kineticTag(c)!.source_clip_ids.includes(other)).map((c) => c.id).sort()).toEqual(ofOther);
    expect(after.filter((c) => kineticTag(c)!.source_clip_ids.includes(clipId)).every((c) => kineticTag(c)!.style === "documentary")).toBe(true);
    // The kept clips' drawings stay in the bin.
    for (const c of after) expect(doc.project.files.some((f) => f.id === c.file_id)).toBe(true);
  });

  it("re-run on a range replaces only the captions said inside it", async () => {
    const { doc } = talking();
    const h = host();
    await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "documentary" });
    const before = captionClips(doc);
    const saidAt = (c: Clip) => kineticTag(c)!.said!;
    const early = before.filter((c) => saidAt(c)[0] < 4.5).map((c) => c.id).sort();
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(before.length);
    const r = await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "documentary", start_seconds: 4.5 });
    expect(r.ok, r.text).toBe(true);
    expect(dataOf(r).replaced_clips).toBe(before.length - early.length);
    const after = captionClips(doc);
    expect(after.filter((c) => before.some((b) => b.id === c.id)).map((c) => c.id).sort()).toEqual(early);
    expect(after.filter((c) => !early.includes(c.id)).every((c) => saidAt(c)[0] >= 4.5)).toBe(true);
  });

  it("keeps earlier captions that also show another clip's words, and says so", async () => {
    const { doc, clipId } = talking();
    const h = host();
    await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "creator" });
    // As tagged before captions knew their own words: the whole run's clips, no times.
    doc.transaction("old tags", (tx) => {
      for (const c of captionClips(doc)) tx.update(["clips", { id: c.id }], { [KINETIC_KEY]: { source_clip_ids: [clipId, "GONECLIP01"], style: "creator", role: "caption" } });
    });
    const kept = captionClips(doc).map((c) => c.id).sort();
    const r = await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "creator", timeline_clip_ids: [clipId] });
    expect(r.ok, r.text).toBe(true);
    expect(dataOf(r).replaced_clips).toBe(0);
    expect((dataOf(r).kept_clip_ids as string[]).sort()).toEqual(kept);
    expect(r.text).toContain(`kept ${kept.length} earlier caption clip(s)`);
    expect(captionClips(doc).filter((c) => kept.includes(c.id))).toHaveLength(kept.length);
  });

  it("deletes the drawings it wrote when it fails after writing them", async () => {
    const { doc } = talking();
    const h = host();
    const transaction = doc.transaction.bind(doc);
    doc.transaction = () => {
      throw new Error("history is full");
    };
    const r = await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "creator" });
    doc.transaction = transaction;
    expect(r.ok).toBe(false);
    expect(h.calls.some((c) => c.startsWith("writeGenerated captions-creator"))).toBe(true);
    expect([...h.written.keys()].filter((p) => p.includes("captions-"))).toEqual([]);

    // A drawing that cannot be written: the ones before it go too.
    const h2 = host();
    const write = h2.media!.writeGenerated!;
    let n = 0;
    h2.media!.writeGenerated = async (name, bytes, type) => {
      n += 1;
      if (n === 3) throw new Error("disk full");
      return write(name, bytes, type);
    };
    const r2 = await runTool({ doc, host: h2 }, "kinetic_captions_tool", { style: "creator" });
    expect(r2.text).toContain("disk full");
    expect([...h2.written.keys()].filter((p) => p.includes("captions-"))).toEqual([]);
    expect(h2.calls.filter((c) => c.startsWith("discardGenerated"))).toHaveLength(1);
    expect(captionClips(doc)).toHaveLength(0);
  });

  it("puts a matte cut-out of the speaker above the captions for behind_subject", async () => {
    const { doc, clipId } = talking(true);
    const r = await runTool({ doc, host: host() }, "kinetic_captions_tool", { style: "stack", behind_subject: "all" });
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

  it("puts the emphasis words behind the speaker by default when the footage has a matte (auto), else none", async () => {
    const matted = talking(true);
    const h = host();
    const r = await runTool({ doc: matted.doc, host: h }, "kinetic_captions_tool", { style: "creator", emphasis: ["cameras"] });
    expect(r.ok, r.text).toBe(true);
    expect(dataOf(r).behind_subject).toBe("emphasis");
    expect(r.text).toContain("the emphasis words behind the speaker");
    const doc = matted.doc;
    const cut = doc.project.clips.find((c) => kineticTag(c)?.role === "cutout")!;
    const captions = captionClips(doc).filter((c) => kineticTag(c)!.role === "caption");
    const svgOf = (c: Clip) => {
      const svg = h.written.get(String(doc.project.files.find((f) => f.id === c.file_id)?.path));
      return typeof svg === "string" ? svg : new TextDecoder().decode(svg);
    };
    // The emphasis word (the accent red drawing) is under the cut-out, the other words above it.
    const under = captions.filter((c) => Number(c.layer) < Number(cut.layer));
    expect(under.length).toBeGreaterThan(0);
    for (const c of under) expect(svgOf(c)).toContain("#ff2d2d");
    expect(captions.some((c) => Number(c.layer) > Number(cut.layer))).toBe(true);

    const plain = talking();
    const none = await runTool({ doc: plain.doc, host: host() }, "kinetic_captions_tool", { style: "creator" });
    expect(none.ok, none.text).toBe(true);
    expect(dataOf(none).behind_subject).toBe("none");
    expect(plain.doc.project.clips.some((c) => kineticTag(c)?.role === "cutout")).toBe(false);
    const asked = await runTool({ doc: plain.doc, host: host() }, "kinetic_captions_tool", { style: "creator", behind_subject: "emphasis" });
    expect(asked.ok).toBe(false);
    expect(asked.text).toContain("generate_subject_matte_tool");
  });

  it("reads the shots to place the captions (placement auto), not with placement style", async () => {
    const { doc } = talking(true);
    const h = host();
    const r = await runTool({ doc, host: h }, "kinetic_captions_tool", { style: "documentary" });
    expect(r.ok, r.text).toBe(true);
    expect(dataOf(r).placement).toMatchObject({ scenes: expect.any(Number) });
    expect(h.calls.filter((c) => c.startsWith("renderFrame")).length).toBeGreaterThan(0);
    const again = host();
    const fixed = await runTool({ doc, host: again }, "kinetic_captions_tool", { style: "documentary", placement: "style" });
    expect(dataOf(fixed).placement).toBe("style");
    expect(again.calls.some((c) => c.startsWith("renderFrame"))).toBe(false);
  });

  it("cuts out the footage as it plays: its effects (fresh ids) and alpha, the Mask last", async () => {
    const { doc, clipId } = talking(true);
    const grade = { id: "GRADE00001", type: "Saturation", class_name: "Saturation" };
    const fade = { Points: [{ co: { X: 1, Y: 0 }, interpolation: 1 }, { co: { X: 15, Y: 1 }, interpolation: 1 }] };
    doc.transaction("grade", (tx) => tx.update(["clips", { id: clipId }], { effects: [grade], alpha: fade }));
    const r = await runTool({ doc, host: host() }, "kinetic_captions_tool", { style: "stack", behind_subject: "all", timeline_clip_ids: [clipId, clipId] });
    expect(r.ok, r.text).toBe(true);
    const cut = doc.project.clips.find((c) => kineticTag(c)?.role === "cutout")!;
    expect(doc.project.clips.filter((c) => kineticTag(c)?.role === "cutout")).toHaveLength(1);
    expect(cut.effects?.map((e) => e.type)).toEqual(["Saturation", "Mask"]);
    expect(cut.effects?.[0]?.id).not.toBe("GRADE00001");
    expect((cut as Record<string, unknown>).alpha).toEqual(fade);
    expect(cut.title).toContain("Captions cut-out");
  });

  it("refuses what it cannot do, leaving the project as it was", async () => {
    const { doc } = talking();
    const before = snapshotOf(doc.project);
    const noMatte = await runTool({ doc, host: host() }, "kinetic_captions_tool", { behind_subject: "all" });
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

  it("captions script cues without speech, each word timed by its share of the cue and tagged with the clip on screen", async () => {
    const { doc, clipId } = talking();
    const cues = [
      { text: "Stop chasing", start: 2.5, end: 3.3 },
      { text: "DEADLINES", start: 3.4, end: 4.2 },
    ];
    const r = await runTool({ doc, host: host() }, "kinetic_captions_tool", { cues, emphasis: ["deadlines"] });
    expect(r.ok, r.text).toBe(true);
    expect(dataOf(r).words_from).toBe("cues");
    const words = (dataOf(r).groups as { words: { text: string; start: number }[] }[]).flatMap((g) => g.words);
    expect(words.map((w) => w.text.toLowerCase())).toEqual(["stop", "chasing", "deadlines"]);
    // "Stop" (5 of 13 characters with spaces) takes the first ~0.31 s of its cue.
    expect(words[1]!.start).toBeCloseTo(2.5 + (0.8 * 5) / 13, 1);
    for (const c of captionClips(doc)) expect(kineticTag(c)!.source_clip_ids).toEqual([clipId]);
    expect(cueWords([{ text: "a b", start: 0, end: 1 }], [], {})).toEqual([
      { text: "a", start: 0, end: 0.5 },
      { text: "b", start: 0.5, end: 1 },
    ]);
  });

  it("sets the size, height and entrance it is given, inside the safe area", async () => {
    const run = async (args: Record<string, unknown>) => {
      const { doc } = talking();
      const r = await runTool({ doc, host: host() }, "kinetic_captions_tool", { style: "documentary", ...args });
      expect(r.ok, r.text).toBe(true);
      return { data: dataOf(r), clips: captionClips(doc) };
    };
    const plain = await run({});
    const big = await run({ text_size: 0.086 });
    const box = (d: Record<string, unknown>) => (d.groups as { box: number[] }[])[0]!.box;
    // Twice the documentary size (0.043): about twice as tall.
    expect(box(big.data)[3]! / box(plain.data)[3]!).toBeGreaterThan(1.6);
    expect(big.data.text_size).toBe(0.086);
    // y: 0.4 centres the block there (documentary sits at 0.75 on 9:16 by default).
    const high = await run({ y: 0.4 });
    const [, y0, , h0] = box(high.data);
    expect(y0! + h0! / 2).toBeCloseTo(0.4, 1);
    // Below the safe area: kept out of the bottom 20 %.
    const low = await run({ y: 0.97 });
    const [, y1, , h1] = box(low.data);
    expect(y1! + h1!).toBeLessThanOrEqual(0.8 + 1e-3);
    // slam lands from 1.8x: the first scale key of a caption clip is above 1.
    const slam = await run({ animation: "slam" });
    expect(slam.data.animation).toBe("slam");
    const firstScale = (c: Clip) => Number((c.scale_x as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y);
    expect(Math.max(...slam.clips.map(firstScale))).toBeGreaterThan(Math.max(...plain.clips.map(firstScale)));
  });
});
