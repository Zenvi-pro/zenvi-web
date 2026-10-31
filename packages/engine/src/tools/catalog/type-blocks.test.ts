import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import type { Clip, Keyframe } from "../../model/types.js";
import { maskGrayTable } from "../../render/kernels/mask.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { snapshotOf } from "../test-support/fixture.js";
import { flashViolations, isFlashChange, relativeLuminance } from "../../review/flashing.js";
import { TYPE_BLOCK_KEY } from "./type-blocks.js";

const doc = () => new ProjectDocument(createProject({ id: "TYPEBLOCK1", profile: findProfile("HD 1080p 30 fps")! }));
const dataOf = (r: { data?: unknown }) => (r.data as { data: Record<string, unknown> }).data;
const tagged = (d: ProjectDocument) => d.project.clips.filter((c) => (c as Record<string, unknown>)[TYPE_BLOCK_KEY]);
const text = (v: Uint8Array | string) => (typeof v === "string" ? v : new TextDecoder().decode(v));
const values = (k: Keyframe | undefined) => (k?.Points ?? []).map((p) => p.co.Y);
const seconds = (c: Clip) => [Number(c.position), Number(c.position) + Number(c.end) - Number(c.start)];

describe("add_type_block_tool", () => {
  it("sets a ring of type as one clip that spins about its centre, in one undo step", async () => {
    const d = doc();
    const r = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "text_on_path", text: "SPIN · THE · RECORD ·", spin: 90, position_seconds: 1, duration_seconds: 2 });
    expect(r.ok, r.text).toBe(true);
    expect(d.undoLabels).toEqual(["Add type block (text on path)"]);
    const [ring] = tagged(d);
    expect(tagged(d)).toHaveLength(1);
    expect(seconds(ring!)[0]).toBeCloseTo(1, 6);
    // 90°/s for its last frames: about 180° turned by the end, from 25° behind.
    const turn = values(ring!.rotation as Keyframe);
    expect(turn[0]).toBeCloseTo(-25, 6);
    expect(turn.at(-1)!).toBeCloseTo((90 * 59) / 30, 1);
    expect(dataOf(r).created_clip_ids).toEqual([ring!.id]);
    d.undo();
    expect(d.project.clips).toHaveLength(0);
  });

  it("writes text on with a Mask time map that sweeps from all hidden to all shown, then fades the fill up", async () => {
    const d = doc();
    const h = fakeHost();
    const r = await runTool({ doc: d, host: h }, "add_type_block_tool", { block: "write_on", text: "hello", duration_seconds: 2 });
    expect(r.ok, r.text).toBe(true);
    const clips = tagged(d);
    expect(clips).toHaveLength(2);
    const strokes = clips.find((c) => (c.effects ?? []).length > 0)!;
    const mask = strokes.effects![0] as Record<string, unknown>;
    expect(mask.type).toBe("Mask");
    const reader = mask.mask_reader as { path: string };
    const map = text(h.written.get(reader.path)!);
    // Gray levels from black (drawn first) to white (drawn last).
    expect(map).toContain('"#000000"');
    expect(map).toContain('stroke="#ffffff"');
    const [from, to] = values(mask.brightness as Keyframe);
    const contrast = values(mask.contrast as Keyframe)[0]!;
    // libopenshot's Mask math: at the first key even black hides; at the last even white shows.
    expect(maskGrayTable(from!, contrast)[0]).toBe(255);
    expect(maskGrayTable(to!, contrast)[255]).toBe(0);
    const fill = clips.find((c) => c !== strokes)!;
    expect(values(fill.alpha as Keyframe)).toEqual([0, 1]);
  });

  it("writes SVG paths on in order without a fill, and refuses path data it cannot read", async () => {
    const d = doc();
    const h = fakeHost();
    const r = await runTool({ doc: d, host: h }, "add_type_block_tool", { block: "write_on", paths: ["M10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80", "M0 120 h200"], view_box: [0, 0, 200, 160] });
    expect(r.ok, r.text).toBe(true);
    expect(tagged(d)).toHaveLength(1);
    const before = snapshotOf(d.project);
    const bad = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "write_on", paths: ["M 10 10 L 20"] });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/Error: a write_on path is not valid SVG path data/);
    const both = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "write_on", text: "hi", paths: ["M0 0 L10 10"] });
    expect(both.text).toContain("Error: write_on takes text or paths, not both");
    expect(snapshotOf(d.project)).toEqual(before);
  });

  it("cuts the stencil's title out of one even-odd card and flies through a letter in sharp stages", async () => {
    const d = doc();
    const h = fakeHost();
    const r = await runTool({ doc: d, host: h }, "add_type_block_tool", { block: "stencil", text: "BLOOM", duration_seconds: 2.4 });
    expect(r.ok, r.text).toBe(true);
    const svgs = [...h.written.entries()].filter(([p]) => p.includes("type-stencil-card"));
    expect(svgs.length).toBeGreaterThan(3);
    for (const [, svg] of svgs) {
      expect(text(svg)).toContain('fill-rule="evenodd"');
      // Every stage is drawn at most 1.6x the frame: no giant rasters at the end of the zoom.
      const width = Number(/width="(\d+)"/.exec(text(svg))![1]);
      expect(width).toBeLessThanOrEqual(Math.ceil(1920 * 1.6) + 1);
    }
    const cards = tagged(d).filter((c) => String(c.title).includes("card-"));
    const layers = new Set(cards.map((c) => c.layer));
    expect(layers.size).toBe(1);
    // Back to back to the block's end, the last stage the frame many times over.
    const spans = cards.map(seconds).sort((a, b) => a[0]! - b[0]!);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]![0]).toBeCloseTo(spans[i - 1]![1]!, 6);
    expect(spans.at(-1)![1]).toBeCloseTo(2.4, 6);
    expect(dataOf(r).hits).toEqual([0, 1.9]);
  });

  it("builds an echo stack from the centre out and collapses it into the centre line", async () => {
    const d = doc();
    const r = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "echo_stack", text: "NO DAYS OFF", copies: 5 });
    expect(r.ok, r.text).toBe(true);
    const clips = tagged(d);
    expect(clips).toHaveLength(5);
    expect(new Set(clips.map((c) => c.layer)).size).toBe(5);
    const starts = clips.map((c) => Math.round(Number(c.position) * 30)).sort((a, b) => a - b);
    expect(starts).toEqual([0, 2, 2, 4, 4]);
    // Every echo ends where the centre line is, faded out.
    const centre = clips.find((c) => Number(c.position) === 0)!;
    const centreY = values(centre.location_y as Keyframe).at(-1)!;
    for (const echo of clips.filter((c) => c !== centre)) {
      expect(values(echo.location_y as Keyframe).at(-1)!).toBeCloseTo(centreY, 6);
      expect(values(echo.alpha as Keyframe).at(-1)).toBe(0);
    }
  });

  it("strobes a word every hold_frames on one track, then the lockup; or cuts on the beats", async () => {
    const d = doc();
    const r = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "strobe", text: "BUILD SHIP LEARN", hold_frames: 3, position_seconds: 2 });
    expect(r.ok, r.text).toBe(true);
    const clips = tagged(d).sort((a, b) => Number(a.position) - Number(b.position));
    expect(clips).toHaveLength(4);
    expect(new Set(clips.map((c) => c.layer)).size).toBe(1);
    expect(clips.map((c) => Math.round((Number(c.position) - 2) * 30))).toEqual([0, 3, 6, 9]);
    expect(seconds(clips.at(-1)!)[1]).toBeCloseTo(2 + 9 / 30 + 1.2, 6);

    const beats = runTool({ doc: doc(), host: fakeHost() }, "add_type_block_tool", { block: "strobe", words: ["ONE", "TWO"], beats: [0.5, 1, 1.5], lockup: "" });
    const b = await beats;
    expect(b.ok, b.text).toBe(true);
    expect(dataOf(b).hits).toEqual([0.5, 1]);
    // Words without text have no lockup: the last word holds 0.4 s, not the 1.2 s a lockup gets.
    const bare = doc();
    expect((await runTool({ doc: bare, host: fakeHost() }, "add_type_block_tool", { block: "strobe", words: ["ONE", "TWO"], hold_frames: 3 })).ok).toBe(true);
    expect(tagged(bare)).toHaveLength(2);
    expect(seconds(tagged(bare).sort((a, b) => Number(a.position) - Number(b.position)).at(-1)!)[1]).toBeCloseTo(6 / 30 + 0.4, 6);
    const few = await runTool({ doc: doc(), host: fakeHost() }, "add_type_block_tool", { block: "strobe", words: ["ONE", "TWO", "THREE"], beats: [0.5, 1] });
    expect(few.text).toMatch(/Error: strobe needs 4 beats/);
  });

  it("turns a drum of words to each in turn, squashing and blurring the lines as they turn away", async () => {
    const d = doc();
    const r = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "wheel", words: ["APPS", "SITES", "BRANDS"], hold_frames: 15 });
    expect(r.ok, r.text).toBe(true);
    const clips = tagged(d);
    expect(clips).toHaveLength(3);
    const first = clips.find((c) => String(c.title).endsWith("line-0"))!;
    const last = clips.find((c) => String(c.title).endsWith("line-2"))!;
    // The first word starts upright at the centre and ends turned up and away; the last ends upright.
    const sy = (c: Clip) => values(c.scale_y as Keyframe);
    expect(sy(first)[0]! / Math.max(...sy(first))).toBeCloseTo(1, 6);
    expect(sy(first).at(-1)!).toBeLessThan(sy(first)[0]! * 0.6);
    expect(sy(last).at(-1)! / Math.max(...sy(last))).toBeCloseTo(1, 2);
    const blur = (last.effects ?? []).find((e) => e.type === "Blur") as Record<string, unknown> | undefined;
    expect(values(blur?.vertical_radius as Keyframe).at(-1)).toBe(0);
    // Turns on 15 and 15 + 15 + a turn; a hit as each one lands.
    expect((dataOf(r).hits as number[]).length).toBe(2);
    // Lines half a turn apart are never in sight together: twelve words take six tracks.
    const long = doc();
    const twelve = await runTool({ doc: long, host: fakeHost() }, "add_type_block_tool", { block: "wheel", words: "A B C D E F G H I J K L".split(" "), hold_frames: 1 });
    expect(twelve.ok, twelve.text).toBe(true);
    expect(tagged(long)).toHaveLength(12);
    expect(new Set(tagged(long).map((c) => c.layer)).size).toBe(6);
    const few = await runTool({ doc: doc(), host: fakeHost() }, "add_type_block_tool", { block: "wheel", words: ["ONLY"] });
    expect(few.text).toContain("Error: wheel takes 2-12 words");
  });

  it("holds the strobe's ground past 3 flashes a second (WCAG 2.3.1) unless allow_strobe", async () => {
    const words = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];
    const run = async (extra: Record<string, unknown>) => {
      const d = doc();
      const h = fakeHost();
      const r = await runTool({ doc: d, host: h }, "add_type_block_tool", { block: "strobe", words, lockup: "", ...extra });
      expect(r.ok, r.text).toBe(true);
      const paths = new Map(d.project.files.map((f) => [f.id, String(f.path)]));
      const cards = tagged(d).sort((a, b) => Number(a.position) - Number(b.position));
      const grounds = cards.map((c) => /<rect[^>]*fill="([^"]+)"/.exec(text(h.written.get(paths.get(c.file_id)!)!))![1]!);
      const changes = cards.flatMap((c, i) => (i > 0 && isFlashChange(relativeLuminance(grounds[i - 1]!), relativeLuminance(grounds[i]!)) ? [Number(c.position)] : []));
      return { changes, warnings: (r.data as { warnings: string[] }).warnings };
    };
    const safe = await run({});
    expect(flashViolations(safe.changes)).toEqual([]);
    expect(safe.changes.length).toBeGreaterThan(3);
    expect(safe.warnings.join(" ")).toMatch(/the ground holds on \d+ of 12 cuts.*WCAG 2\.3\.1/);
    const strobe = await run({ allow_strobe: true });
    expect(strobe.changes).toHaveLength(11);
    expect(flashViolations(strobe.changes).length).toBeGreaterThan(0);
    expect(strobe.warnings.join(" ")).not.toMatch(/ground holds/);
  });

  it("counts the timeline's own flashes before it flips the strobe's ground", async () => {
    const words = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"];
    const run = async (cards: number[]) => {
      const project = createProject({ id: "TYPEBLOCK2", profile: findProfile("HD 1080p 30 fps")! });
      project.files.push({ id: "FLASH1", path: "/tmp/flash.svg", media_type: "image" } as (typeof project.files)[number]);
      for (const [i, at] of cards.entries()) project.clips.push({ id: `FC${i}`, file_id: "FLASH1", layer: project.layers[0]!.number, position: at, start: 0, end: 2 / 30 } as Clip);
      const d = new ProjectDocument(project);
      const h = fakeHost();
      // 10 frames a word: 3 cuts a second, safe on their own.
      const r = await runTool({ doc: d, host: h }, "add_type_block_tool", { block: "strobe", words, lockup: "", hold_frames: 10 });
      expect(r.ok, r.text).toBe(true);
      const paths = new Map(d.project.files.map((f) => [f.id, String(f.path)]));
      const strobe = tagged(d).sort((a, b) => Number(a.position) - Number(b.position));
      const grounds = strobe.map((c) => /<rect[^>]*fill="([^"]+)"/.exec(text(h.written.get(paths.get(c.file_id)!)!))![1]!);
      const flips = strobe.flatMap((c, i) => (i > 0 && isFlashChange(relativeLuminance(grounds[i - 1]!), relativeLuminance(grounds[i]!)) ? [Number(c.position)] : []));
      return { flips, warnings: (r.data as { warnings: string[] }).warnings };
    };
    const alone = await run([]);
    expect(alone.flips.length).toBe(5);
    expect(alone.warnings.join(" ")).not.toMatch(/ground holds/);
    // Two flash cards in the first second already make 4 changes there.
    const cards = [0.1, 0.5];
    const beside = await run(cards);
    const changes = [...cards.flatMap((t) => [t, t + 2 / 30]), ...beside.flips].sort((a, b) => a - b);
    expect(flashViolations(changes)).toEqual([]);
    expect(beside.warnings.join(" ")).toMatch(/the ground holds on \d+ of 6 cuts/);
  });

  it("boils paper-cut type on twos, the same boil for the same seed", async () => {
    const run = async (seed: number) => {
      const d = doc();
      const h = fakeHost();
      const r = await runTool({ doc: d, host: h }, "add_type_block_tool", { block: "paper", text: "BUY IT", duration_seconds: 1, seed });
      expect(r.ok, r.text).toBe(true);
      return { d, svgs: [...h.written.values()].map(text) };
    };
    const a = await run(7);
    const clips = tagged(a.d);
    // 30 frames on twos: 15 poses back to back on one track.
    expect(clips).toHaveLength(15);
    expect(new Set(clips.map((c) => c.layer)).size).toBe(1);
    expect(new Set(a.svgs).size).toBe(15);
    expect((await run(7)).svgs).toEqual(a.svgs);
    expect((await run(8)).svgs).not.toEqual(a.svgs);
  });

  it("boils a long paper block slower instead of drawing a pose per frame", async () => {
    // Regression (t4 review): 30 s on ones was 900 clips and about 5 MB of SVG.
    const d = doc();
    const r = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "paper", text: "BUY IT", duration_seconds: 30, hold_frames: 1 });
    expect(r.ok, r.text).toBe(true);
    expect(tagged(d).length).toBeLessThanOrEqual(120);
  });

  it("refuses arguments another block reads, without touching the project", async () => {
    const d = doc();
    const before = snapshotOf(d.project);
    const r = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "stencil", text: "HI", copies: 5 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Error: copies do not apply to stencil/);
    // Arguments a block would silently drop are refused too.
    const ink = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "stencil", text: "HI", ink: "#ff0000" });
    expect(ink.text).toMatch(/Error: ink do not apply to stencil/);
    const size = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "strobe", text: "A B", text_size: 0.2 });
    expect(size.text).toMatch(/Error: text_size do not apply to strobe/);
    const box = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "write_on", text: "Hi", width: 0.5 });
    expect(box.text).toMatch(/Error: width do not apply to write_on text/);
    const em = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "write_on", paths: ["M0 0 L10 0"], text_size: 0.2 });
    expect(em.text).toMatch(/Error: text_size do not apply to write_on paths/);
    const even = await runTool({ doc: d, host: fakeHost() }, "add_type_block_tool", { block: "echo_stack", text: "HI", copies: 4 });
    expect(even.text).toMatch(/Error: echo_stack copies must be odd/);
    expect(snapshotOf(d.project)).toEqual(before);
    expect(d.undoLabels).toEqual([]);
  });
});
