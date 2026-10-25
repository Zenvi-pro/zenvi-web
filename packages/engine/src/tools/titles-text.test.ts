/**
 * The titles-and-text tools through runTool with string arguments, the way
 * the Zenvi Assistant sends them: captions (list / edit / remove), timers,
 * emoji, title templates, title edits and animated titles. Ported from
 * zenvi-core develop tests/test_editor_tools_titles_text*.py; desktop
 * fixtures are 1920x1080 at 30 fps with five tracks, like these.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { toStoredPaths } from "../io/paths.js";
import { createProject } from "../model/defaults.js";
import type { Clip, Effect, Keyframe } from "../model/types.js";
import { addClip } from "../ops/clips.js";
import { createEffect } from "../effects/registry.js";
import { addFile } from "../ops/files.js";
import { setTrackLocked } from "../ops/tracks.js";
import { parseTitleSvg, lineTexts, setFieldText, textColor, titleFields, titleSvgText } from "../titles/title-svg.js";
import { buildCaptionText, parseCaptionText, displayText, type Cue } from "./caption-cues.js";
import type { ToolReceipt } from "./receipt.js";
import { runTool } from "./registry.js";
import { fakeHost, type FakeHost, type FakeHostOptions } from "./test-support/fake-host.js";
import { media, videoInfo } from "./test-support/fixture.js";

const L1 = 1_000_000;
const L2 = 2_000_000;

const ASSETS = new URL("../../assets/", import.meta.url);

/** The engine's real bundled assets, read on demand (title templates, emoji). */
const realAssets = new Proxy({} as Record<string, string>, {
  get: (_target, key) => {
    if (typeof key !== "string") return undefined;
    try {
      return readFileSync(new URL(key, ASSETS), "utf8");
    } catch {
      return undefined;
    }
  },
});

/** A fake host with the real assets whose storage also reads back what tools wrote. */
function host(options: FakeHostOptions = {}): FakeHost {
  const h = fakeHost({ assets: realAssets, ...options });
  const texts = options.texts ?? {};
  if (h.storage) {
    h.storage.readText = async (path) => {
      h.calls.push(`readText ${path}`);
      if (texts[path] !== undefined) return texts[path]!;
      const bytes = h.written.get(path);
      if (bytes !== undefined) return typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
      throw new Error(`No such file: ${path}`);
    };
  }
  return h;
}

let txCounter = 0;
function newDoc(profile = "FHD 1080p 30 fps"): ProjectDocument {
  return new ProjectDocument(createProject({ id: "PROJECT001", profile }), { newTransactionId: () => `tx-${(txCounter += 1)}` });
}

/** A video clip (22.7 s file) placed with ops; returns its id. */
function addVideo(doc: ProjectDocument, opts: { position?: number; start?: number; end?: number; layer?: number; duration?: number; id?: string } = {}): string {
  const path = `/media/video-${doc.project.files.length}.mp4`;
  return doc.transaction("setup", (tx) => {
    const file = addFile(tx, media(path, videoInfo(path, opts.duration ?? 22.7)));
    return addClip(tx, { fileId: file.id, position: opts.position ?? 0, layer: opts.layer ?? L1, start: opts.start ?? 0, end: opts.end ?? opts.duration ?? 22.7, id: opts.id }).id;
  });
}

function clip(doc: ProjectDocument, id: string): Clip | undefined {
  return doc.project.clips.find((c) => c.id === id);
}

function y(kf: unknown, i = 0): number {
  return (kf as Keyframe).Points[i]!.co.Y;
}

async function call(doc: ProjectDocument, h: FakeHost, name: string, args: Record<string, unknown> = {}): Promise<ToolReceipt> {
  return (await runTool({ doc, host: h }, name, args)).data!;
}

function data(receipt: ToolReceipt): Record<string, unknown> {
  return receipt.data as Record<string, unknown>;
}

/** Run a call that must be refused with `needle` and leave the project and history as they were. */
async function expectRefusal(doc: ProjectDocument, h: FakeHost, name: string, args: Record<string, unknown>, needle: string | RegExp): Promise<void> {
  const before = JSON.stringify(doc.project);
  const undo = doc.undoLabels.length;
  const r = await call(doc, h, name, args);
  expect(r.summary, JSON.stringify(args)).toMatch(/^Error/);
  if (typeof needle === "string") expect(r.summary, JSON.stringify(args)).toContain(needle);
  else expect(r.summary, JSON.stringify(args)).toMatch(needle);
  expect(doc.undoLabels.length).toBe(undo);
  expect(JSON.stringify(doc.project)).toBe(before);
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

function captionsOf(doc: ProjectDocument, clipId: string): Effect[] {
  return (clip(doc, clipId)?.effects ?? []).filter((e) => e.class_name === "Caption");
}

/** A speaker clip at 10 s with three cues (timeline 11-12, 13-14, 15-16), like the desktop's `_captioned`. */
function captioned(): { doc: ProjectDocument; clipId: string } {
  const doc = newDoc();
  const clipId = addVideo(doc, { position: 10 });
  const cues: Cue[] = [
    { start: 1, end: 2, text: "one" },
    { start: 3, end: 4, text: "two" },
    { start: 5, end: 6, text: "three Tokio" },
  ];
  doc.transaction("captions", (tx) => {
    const effect = createEffect("Caption", { caption_text: buildCaptionText(cues) }, { id: "CAPTION001" });
    tx.update(["clips", { id: clipId }], { effects: [effect] });
  });
  return { doc, clipId };
}

describe("list_captions_tool", () => {
  it("lists every caption track with numbered cues in timeline and source time, read-only", async () => {
    const { doc, clipId } = captioned();
    const undo = doc.undoLabels.length;
    const r = await call(doc, host(), "list_captions_tool");
    expect(r.summary).toBe("1 caption track(s), 3 cue(s).");
    const [track] = data(r).caption_tracks as Record<string, unknown>[];
    expect(track).toMatchObject({ timeline_clip_id: clipId, effect_id: "CAPTION001", overlay: false, track: 1, clip_start: 10, clip_end: 32.7 });
    expect((track!.cues as unknown[])[0]).toEqual({ index: 1, start: 11, end: 12, source_start: 1, source_end: 2, text: "one", visible: true });
    expect(Object.keys(track!.look as object)).toEqual(["text_size", "font", "text_color", "stroke_color", "stroke_width", "background_color", "background_opacity", "position", "fade"]);
    expect(doc.undoLabels.length).toBe(undo);
    expect(r.status).toBe("applied");
  });

  it("filters by clip and refuses an unknown clip", async () => {
    const { doc } = captioned();
    const other = addVideo(doc, { position: 40 });
    expect((await call(doc, host(), "list_captions_tool", { timeline_clip_id: other })).summary).toBe("0 caption track(s), 0 cue(s).");
    await expectRefusal(doc, host(), "list_captions_tool", { timeline_clip_id: "NOPE" }, "no timeline clip with id='NOPE'");
  });
});

describe("edit_captions_tool", () => {
  it("edits text, timing, adds, finds and shifts in one undo step", async () => {
    const { doc, clipId } = captioned();
    const undo = doc.undoLabels.length;
    const r = await call(doc, host(), "edit_captions_tool", {
      timeline_clip_id: clipId,
      cue_edits: JSON.stringify([{ index: 1, text: "ONE" }, { index: 2, start: 12.5, end: 14.5 }, { index: 3, delete: false }]),
      add_cues: JSON.stringify([{ start: 20, end: 21, text: "four" }]),
      find: "Tokio",
      replace: "Tokyo",
      shift_seconds: "0.5",
    });
    expect(r.summary).toBe("Updated captions on " + clipId + ": cue 1 text, cue 2 timing, added a cue, replaced 1 x 'Tokio', shifted +0.50s (4 cue(s)).");
    const rows = data(r).cues as { text: string; start: number }[];
    expect(rows.map((c) => c.text)).toEqual(["ONE", "two", "three Tokyo", "four"]);
    expect(rows.map((c) => c.start)).toEqual([11.5, 13, 15.5, 20.5]);
    expect(doc.undoLabels.length).toBe(undo + 1);
    doc.undo();
    expect(parseCaptionText(String(captionsOf(doc, clipId)[0]!.caption_text)).map((c) => c.text)).toEqual(["one", "two", "three Tokio"]);
    const deleted = await call(doc, host(), "edit_captions_tool", { cue_edits: [{ index: "2", delete: "true" }] });
    expect((data(deleted).cues as { text: string }[]).map((c) => c.text)).toEqual(["one", "three Tokio"]);
  });

  it("restyles without touching the cues, and moves them to the top", async () => {
    const { doc, clipId } = captioned();
    const before = captionsOf(doc, clipId)[0]!.caption_text;
    const r = await call(doc, host(), "edit_captions_tool", { effect_id: "CAPTION001", text_color: "#ffe14d", text_size: "0.08" });
    expect(r.status).toBe("applied");
    const e = captionsOf(doc, clipId)[0]!;
    expect(e.caption_text).toBe(before);
    expect(y((e.color as Record<string, unknown>).green)).toBe(225);
    // 0.08 of the 1080 px short side = 86.4 px; Caption scales by width / 600.
    expect(y(e.font_size)).toBe(27);
    await call(doc, host(), "edit_captions_tool", { timeline_clip_id: clipId, position: "TOP" });
    expect(y(captionsOf(doc, clipId)[0]!.top)).toBeLessThan(0.12);
    expect(data(r).look).toMatchObject({ text_color: "#ffe14d", text_size: 0.08 });
  });

  it("keeps ':' between digits and one-letter lines drawable", async () => {
    const { doc, clipId } = captioned();
    await call(doc, host(), "edit_captions_tool", { cue_edits: [{ index: 1, text: "Meet at 10:30" }] });
    const cues = parseCaptionText(String(captionsOf(doc, clipId)[0]!.caption_text));
    expect(cues[0]!.text).toBe("Meet at 10​:30");
    expect(displayText(cues[0]!.text)).toBe("Meet at 10:30");
  });

  it.each([
    [{}, "nothing to change"],
    [{ cue_edits: [{ index: 9, text: "x" }] }, "there is no cue 9"],
    [{ cue_edits: [{ index: 1, text: "" }] }, "empty text"],
    [{ cue_edits: [{ index: 1, start: 12, end: 11 }] }, "end must be after start"],
    [{ find: "absent", replace: "x" }, "no caption contains"],
    [{ replace: "x" }, "replace needs find"],
    [{ add_cues: [{ start: 50, end: 51, text: "x" }] }, "outside clip"],
    [{ cue_edits: [{ index: 1, delete: true }, { index: 2, delete: true }, { index: 3, delete: true }] }, "remove_captions_tool"],
    [{ effect_id: "NOPE", shift_seconds: 1 }, "no Caption effect with id='NOPE'"],
    [{ style: "comic" }, "'comic' is not one of"],
  ])("refuses %j before anything changes", async (args, needle) => {
    const { doc } = captioned();
    await expectRefusal(doc, host(), "edit_captions_tool", args, needle);
  });

  it("asks which captions when several clips have them", async () => {
    const { doc } = captioned();
    const other = addVideo(doc, { position: 40, layer: L2 });
    doc.transaction("captions", (tx) => tx.update(["clips", { id: other }], { effects: [createEffect("Caption", { caption_text: buildCaptionText([{ start: 1, end: 2, text: "x" }]) }, { id: "CAPTION002" })] }));
    await expectRefusal(doc, host(), "edit_captions_tool", { shift_seconds: 1 }, "which captions? pass effect_id or timeline_clip_id: CAPTION001 on");
    expect((await call(doc, host(), "edit_captions_tool", { shift_seconds: 1, timeline_clip_id: other })).summary).toMatch(/^Updated captions/);
  });

  it("refuses a clip on a locked track", async () => {
    const { doc, clipId } = captioned();
    doc.transaction("lock", (tx) => setTrackLocked(tx, L1, true));
    await expectRefusal(doc, host(), "edit_captions_tool", { timeline_clip_id: clipId, shift_seconds: 1 }, "is on a locked track");
  });
});

describe("remove_captions_tool", () => {
  it("removes caption tracks, never clips, in one undo step", async () => {
    const { doc, clipId } = captioned();
    const clips = doc.project.clips.length;
    const undo = doc.undoLabels.length;
    const r = await call(doc, host(), "remove_captions_tool", { timeline_clip_id: clipId });
    expect(r.summary).toBe("Removed 1 caption track(s) from 1 clip(s).");
    expect(data(r)).toEqual({ removed_effect_ids: ["CAPTION001"], timeline_clip_ids: [clipId] });
    expect(captionsOf(doc, clipId)).toEqual([]);
    expect(doc.project.clips.length).toBe(clips);
    expect(doc.undoLabels.length).toBe(undo + 1);
    doc.undo();
    expect(captionsOf(doc, clipId)).toHaveLength(1);
    expect((await call(doc, host(), "remove_captions_tool", { all_captions: "true" })).summary).toMatch(/^Removed 1/);
    await expectRefusal(doc, host(), "remove_captions_tool", { all_captions: "yes" }, "there are no captions in the project");
  });

  it("undo of a caption removal reads as a change, not 'the timeline did not change'", async () => {
    const { doc, clipId } = captioned();
    await call(doc, host(), "remove_captions_tool", { timeline_clip_id: clipId });
    const undo = await call(doc, host(), "undo_tool");
    expect(undo.summary).toBe(`Undid 1 action: changed effects/properties of 1 clip(s) (${clipId}). 2 undo steps remain.`);
  });

  it("names the overlay clip that carried the captions", async () => {
    const { doc, clipId } = captioned();
    doc.transaction("role", (tx) => tx.update(["clips", { id: clipId }], { zenvi_role: "captions" }));
    const r = await call(doc, host(), "remove_captions_tool", { effect_id: "CAPTION001" });
    expect(r.summary).toContain("delete_from_timeline_tool");
    expect(data(r).empty_overlay_clip_ids).toEqual([clipId]);
    expect(clip(doc, clipId)).toBeDefined();
  });

  it("refuses a clip without captions", async () => {
    const { doc } = captioned();
    const other = addVideo(doc, { position: 40 });
    await expectRefusal(doc, host(), "remove_captions_tool", { timeline_clip_id: other }, `clip ${other} has no captions`);
  });
});

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

function timerOf(doc: ProjectDocument, clipId: string): Effect {
  return clip(doc, clipId)!.effects.find((e) => e.class_name === "Timer")!;
}

describe("add_timer_tool", () => {
  it("adds a countdown overlay above the video, one undo step", async () => {
    const doc = newDoc();
    addVideo(doc, { duration: 30 });
    const h = host();
    const undo = doc.undoLabels.length;
    const r = await call(doc, h, "add_timer_tool", { mode: "count_down", countdown_from_seconds: "10", position_seconds: "5", screen_position: "center", text_size: "0.15" });
    expect(r.summary).toBe("Added a count down timer on track 2 at 5.00-15.00s (center).");
    const d = data(r);
    const c = clip(doc, String(d.timeline_clip_id))!;
    expect([c.zenvi_role, c.title, c.layer]).toEqual(["timer", "Timer", L2]);
    const t = timerOf(doc, c.id);
    expect([t.mode, t.time_source, t.gravity, t.apply_before_clip]).toEqual([1, 0, 4, false]);
    expect([y(t.end_time), y(t.x_offset), y(t.y_offset)]).toEqual([10, 0, 0]);
    expect(y(t.font_size)).toBe(Math.round(((0.15 * 1080 * 600) / 1920) * 1000) / 1000);
    const carrier = doc.project.files.find((f) => f.id === c.file_id)!;
    expect([carrier.zenvi_role, carrier.name]).toEqual(["text_overlay", "Text Overlay.svg"]);
    expect(h.calls).toContain("writeGenerated Text Overlay 1920x1080.svg");
    expect(d).toMatchObject({ overlay: true, duration: 10, end: 15, countdown_from: 10, new_track: false, track: 2 });
    expect(doc.undoLabels.length).toBe(undo + 1);
    doc.undo();
    expect(clip(doc, c.id)).toBeUndefined();
    // The second timer reuses the carrier image.
    await call(doc, h, "add_timer_tool", { mode: "count_down" });
    await call(doc, h, "add_timer_tool", { mode: "count_up", position_seconds: "12" });
    expect(doc.project.files.filter((f) => f.zenvi_role === "text_overlay")).toHaveLength(1);
  });

  it("runs a stopwatch in a corner until the end of the timeline", async () => {
    const doc = newDoc();
    addVideo(doc, { duration: 30, end: 24 });
    const r = await call(doc, host(), "add_timer_tool", { mode: "COUNT_UP", screen_position: "top_right", format: "HH:MM:SS", prefix: "T+", margin_percent: "4" });
    expect(data(r).duration).toBe(24);
    const t = timerOf(doc, String(data(r).timeline_clip_id));
    expect([t.mode, t.format, t.gravity, t.prefix]).toEqual([0, 1, 2, "T+"]);
    expect([y(t.x_offset), y(t.y_offset)]).toEqual([-4, 4]);
  });

  it("counts a trimmed clip's time from its first visible frame", async () => {
    const doc = newDoc();
    const clipId = addVideo(doc, { position: 3, start: 6, end: 16, duration: 30 });
    const clips = doc.project.clips.length;
    const r = await call(doc, host(), "add_timer_tool", { mode: "count_up", timeline_clip_id: clipId, screen_position: "bottom_left" });
    expect(r.summary).toBe(`Added a count up timer to clip ${clipId} (bottom left).`);
    expect(data(r)).toMatchObject({ overlay: false, duration: 10, position: 3, track: 1 });
    const t = timerOf(doc, clipId);
    expect([t.time_source, y(t.start_time), t.gravity]).toEqual([1, -6, 6]);
    expect(doc.project.clips.length).toBe(clips);
  });

  it("starts a clock at a time of day", async () => {
    const doc = newDoc();
    const r = await call(doc, host(), "add_timer_tool", { mode: "clock", start_at_seconds: "34200", duration_seconds: "8s" });
    const t = timerOf(doc, String(data(r).timeline_clip_id));
    expect([t.mode, y(t.start_time), data(r).duration]).toEqual([2, 34200, 8]);
  });

  it.each([
    [{ mode: "sideways" }, "'sideways' is not one of"],
    [{ text_color: "nope" }, "text_color: unrecognised color 'nope'"],
    [{ timeline_clip_id: "missing" }, "no timeline clip with id='missing'"],
    [{ screen_position: "middle" }, "'middle' is not one of"],
    [{ format: "seconds" }, "'seconds' is not one of"],
  ])("refuses %j", async (args, needle) => {
    await expectRefusal(newDoc(), host(), "add_timer_tool", args, needle);
  });

  it("refuses locked tracks", async () => {
    const doc = newDoc();
    const clipId = addVideo(doc, { duration: 30 });
    doc.transaction("lock", (tx) => setTrackLocked(tx, L1, true));
    await expectRefusal(doc, host(), "add_timer_tool", { timeline_clip_id: clipId }, "locked");
    await expectRefusal(doc, host(), "add_timer_tool", { track: "1" }, "track 1 is locked; unlock it first");
  });
});

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------

describe("search_emojis_tool", () => {
  it("finds emoji by name, filtered by group", async () => {
    const doc = newDoc();
    const r = await call(doc, host(), "search_emojis_tool", { query: "cake", group: "FOOD-DRINK", limit: "3" });
    const matches = data(r).matches as { group: string; code: string; emoji: string; score: number }[];
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(3);
    expect(matches.every((m) => m.group === "food-drink")).toBe(true);
    expect(r.summary).toMatch(/^\d emoji match 'cake': /);
    const fire = await call(doc, host(), "search_emojis_tool", { query: "🔥" });
    expect((data(fire).matches as { code: string; score: number }[])[0]).toMatchObject({ code: "1F525", emoji: "🔥", name: "Fire", score: 100, source: "bundled" });
    await expectRefusal(doc, host(), "search_emojis_tool", {}, "pass a query (e.g. 'fire') or a group");
    await expectRefusal(doc, host(), "search_emojis_tool", { query: "zzqqxxjj" }, "no emoji matches 'zzqqxxjj'");
  });

  it("is not available without the bundled assets", async () => {
    const r = await call(newDoc(), fakeHost({ without: ["assets"] }), "search_emojis_tool", { query: "fire" });
    expect(r.summary).toMatch(/not available in this Zenvi surface/);
  });
});

describe("add_emoji_tool", () => {
  it("puts an emoji top right, scaled, above the video, one undo step", async () => {
    const doc = newDoc();
    addVideo(doc, { duration: 30 });
    const undo = doc.undoLabels.length;
    const r = await call(doc, host(), "add_emoji_tool", { emoji: "fire", screen_position: "top_right", size: "0.15", position_seconds: "2", duration_seconds: "3" });
    expect(r.summary).toBe("Added 🔥 Fire on track 2 at 2.00-5.00s (top right, size 0.15).");
    const d = data(r);
    const c = clip(doc, String(d.timeline_clip_id))!;
    expect(c.gravity).toBe(2);
    expect([y(c.scale_x), y(c.scale_y)]).toEqual([0.15, 0.15]);
    expect(y(c.location_x)).toBe(Math.round(((-0.04 * 1080) / 1920) * 1e5) / 1e5);
    expect(y(c.location_y)).toBe(0.04);
    const f = doc.project.files.find((x) => x.id === d.file_id)!;
    expect([f.media_type, f.name, f.path, f.width, f.height, f.type]).toEqual(["image", "Fire", "@emojis/1F525.svg", 72, 72, "QtImageReader"]);
    expect((d.alternatives as unknown[]).length).toBeGreaterThan(0);
    expect(d.emoji).toEqual({ code: "1F525", emoji: "🔥", name: "Fire", group: "travel-places", source: "bundled" });
    expect(doc.undoLabels.length).toBe(undo + 1);
    doc.undo();
    expect(clip(doc, c.id)).toBeUndefined();
    expect(doc.project.files.find((x) => x.id === d.file_id)).toBeUndefined();
  });

  it("reuses the emoji's file and the default image length", async () => {
    const doc = newDoc();
    const a = data(await call(doc, host(), "add_emoji_tool", { emoji: "❤️", screen_position: "bottom_left" }));
    const b = data(await call(doc, host(), "add_emoji_tool", { emoji: "red heart", position_seconds: "20" }));
    expect(a.file_id).toBe(b.file_id);
    expect(a.duration).toBe(10);
    expect(clip(doc, String(a.timeline_clip_id))!.gravity).toBe(6);
  });

  it.each([
    [{ emoji: "zzqqxxjj" }, "no emoji matches 'zzqqxxjj'"],
    [{ emoji: "thumbs up" }, "no emoji matches"],
    [{ emoji: "" }, "add_emoji_tool: missing required argument(s) emoji"],
    [{ emoji: "fire", size: "3" }, /^Error: Invalid arguments for add_emoji_tool: .*\(at size\)\.$/],
    [{ emoji: "fire", track: "9" }, "Unknown track or layer '9'"],
  ])("refuses %j", async (args, needle) => {
    await expectRefusal(newDoc(), host(), "add_emoji_tool", args, needle);
  });
});

// ---------------------------------------------------------------------------
// Title templates and title edits
// ---------------------------------------------------------------------------

/** A title from the real Standard_1 template with "Day 1" / "Tokyo", stored at `path`, on two clips (0 s and 10 s). */
function twoClipTitle(): { doc: ProjectDocument; h: FakeHost; fileId: string; clipA: string; clipB: string; path: string } {
  const template = readFileSync(new URL("titles/Standard_1.svg", ASSETS), "utf8");
  const doc0 = parseTitleSvg(template);
  const [title, sub] = titleFields(doc0);
  setFieldText(title!, "Day 1");
  setFieldText(sub!, "Tokyo");
  const path = "/titles/Day 1.svg";
  const h = host({ texts: { [path]: titleSvgText(doc0) } });
  const doc = newDoc();
  const ids = doc.transaction("setup", (tx) => {
    const file = addFile(tx, media(path, { ...videoInfo(path, 3600), type: "QtImageReader", has_audio: false, has_single_image: true, width: 1920, height: 1080 }), { mediaType: "image" });
    const a = addClip(tx, { fileId: file.id, position: 0, layer: L2, start: 0, end: 5 });
    const b = addClip(tx, { fileId: file.id, position: 10, layer: L2, start: 0, end: 5 });
    return { fileId: file.id, clipA: a.id, clipB: b.id };
  });
  return { doc, h, path, ...ids };
}

function svgOf(h: FakeHost, path: string): string {
  const bytes = h.written.get(path);
  return typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
}

describe("list_title_templates_tool", () => {
  it("lists the 50 templates with their fields, and filters by look", async () => {
    const doc = newDoc();
    const r = await call(doc, host(), "list_title_templates_tool");
    const templates = data(r).templates as { name: string; zone: string; fields: { role: string }[]; label: string; source: string }[];
    expect(templates).toHaveLength(50);
    expect(r.summary).toBe("Found 50 title template(s).");
    const gray = templates.find((t) => t.name === "Gray_Box_4")!;
    expect([gray.zone, gray.label, gray.source, gray.fields.map((f) => f.role)]).toEqual(["bottom", "Gray box 4", "bundled", ["title", "subtitle"]]);
    const lower = await call(doc, host(), "list_title_templates_tool", { query: "lower third" });
    expect(new Set((data(lower).templates as { name: string }[]).map((t) => t.name))).toEqual(new Set(["Bar_3", "Gray_Box_3", "Gray_Box_4"]));
    expect(lower.summary).toBe("Found 3 title template(s) matching 'lower third'.");
  });

  it("lists the animated titles and which render here", async () => {
    const r = await call(newDoc(), host(), "list_title_templates_tool", { kind: "Animated" });
    const rows = data(r).animated as { name: string; title: string; params: { name: string }[]; renders_here: boolean }[];
    expect(rows).toHaveLength(19);
    const fly = rows.find((a) => a.name === "fly_by_1")!;
    expect(fly.title).toBe("Fly Towards Camera");
    expect(fly.params.some((p) => p.name === "title")).toBe(true);
    expect(fly.params.some((p) => ["start_frame", "end_frame", "file_name", "length_multiplier"].includes(p.name))).toBe(false);
    expect(rows.filter((a) => !a.renders_here).map((a) => a.name)).toEqual(["earth", "magic_wand", "picture_frames_4", "snow"]);
    expect(r.summary).toBe("Found 19 animated title(s) (15 render here as 2D keyframed titles).");
  });

  it("lists the project's titles with their clips, read-only", async () => {
    const { doc, h, fileId, clipA, clipB } = twoClipTitle();
    const undo = doc.undoLabels.length;
    const r = await call(doc, h, "list_title_templates_tool", { kind: "all" });
    const [title] = data(r).project_titles as { file_id: string; clips: { timeline_clip_id: string }[]; fields: { text: string }[] }[];
    expect(title!.file_id).toBe(fileId);
    expect(new Set(title!.clips.map((c) => c.timeline_clip_id))).toEqual(new Set([clipA, clipB]));
    expect(title!.fields.map((f) => f.text)).toEqual(["Day 1", "Tokyo"]);
    expect(doc.undoLabels.length).toBe(undo);
  });
});

describe("edit_title_tool", () => {
  it("changes every clip's title to a new version; undo restores it", async () => {
    const { doc, h, fileId, clipA, clipB, path } = twoClipTitle();
    const undo = doc.undoLabels.length;
    const r = await call(doc, h, "edit_title_tool", { timeline_clip_id: clipA, text: "Day 2", text_color: "yellow" });
    expect(r.summary).toBe("Updated title 'Day 2 / Tokyo' on 2 clip(s).");
    const d = data(r);
    expect(d).toMatchObject({ scope: "all_clips", source_file_id: fileId, path: "/generated/Day 1 v2.svg", text_color: "#ffff00" });
    expect(new Set(d.timeline_clip_ids as string[])).toEqual(new Set([clipA, clipB]));
    const fresh = doc.project.files.find((f) => f.id === d.file_id)!;
    expect([fresh.name, fresh.path]).toEqual(["Day 1.svg", "/generated/Day 1 v2.svg"]);
    expect(doc.project.files.find((f) => f.id === fileId)).toBeUndefined();
    for (const id of [clipA, clipB]) expect([clip(doc, id)!.file_id, clip(doc, id)!.reader.path]).toEqual([d.file_id, "/generated/Day 1 v2.svg"]);
    const edited = parseTitleSvg(svgOf(h, "/generated/Day 1 v2.svg"));
    expect(lineTexts(edited)).toEqual(["Day 2", "Tokyo"]);
    expect(textColor(edited)[0]).toBe("#ffff00");
    expect(doc.undoLabels.length).toBe(undo + 1);
    doc.undo();
    expect(clip(doc, clipB)!.reader.path).toBe(path);
    expect(doc.project.files.find((f) => f.id === fileId)).toBeDefined();
    doc.redo();
    expect(clip(doc, clipB)!.reader.path).toBe("/generated/Day 1 v2.svg");
  });

  it("gives one clip its own copy", async () => {
    const { doc, h, fileId, clipA, clipB } = twoClipTitle();
    const r = await call(doc, h, "edit_title_tool", { timeline_clip_id: clipB, scope: "this_clip", subtitle: "Kyoto" });
    const d = data(r);
    expect(r.summary).toBe(`Gave clip ${clipB} its own edited title 'Day 1 / Kyoto'.`);
    expect(d.scope).toBe("this_clip");
    expect(d.file_id).not.toBe(fileId);
    expect(clip(doc, clipB)!.file_id).toBe(d.file_id);
    expect(clip(doc, clipA)!.file_id).toBe(fileId);
    expect((d.fields as { text: string }[]).map((f) => f.text)).toEqual(["Day 1", "Kyoto"]);
    expect(d.path).toBe("/generated/Day 1 (1).svg");
  });

  it("duplicates into Project Files without touching clips", async () => {
    const { doc, h, fileId, clipB } = twoClipTitle();
    const r = await call(doc, h, "edit_title_tool", { file_id: fileId, scope: "duplicate" });
    expect(r.summary).toBe("Duplicated the title as 'Day 1 (1).svg' ('Day 1 / Tokyo'); it is in Project Files.");
    expect(data(r).timeline_clip_ids).toEqual([]);
    expect(clip(doc, clipB)!.file_id).toBe(fileId);
  });

  it("finds a title by its text and refuses what it cannot do", async () => {
    const { doc, h, fileId } = twoClipTitle();
    expect(data(await call(doc, h, "edit_title_tool", { title_query: "tokyo", text: "Day 9" })).source_file_id).toBe(fileId);
    await expectRefusal(doc, h, "edit_title_tool", { title_query: "Day 9" }, "nothing to change");
    await expectRefusal(doc, h, "edit_title_tool", { title_query: "Day 9", text: "Day 9" }, "already looks like that");
    await expectRefusal(doc, h, "edit_title_tool", { title_query: "nothing like it", text: "x" }, "no title in the project matches");
    const id = (doc.project.files.find((f) => String(f.path).endsWith(".svg"))!).id;
    await expectRefusal(doc, h, "edit_title_tool", { file_id: id, scope: "this_clip", text: "x" }, "needs timeline_clip_id");
    await expectRefusal(doc, h, "edit_title_tool", { file_id: id, lines: "a, b, c" }, "has 2 text field(s) ['title', 'subtitle'] but 3 lines were given");
    // A second title makes "which title" ambiguous.
    doc.transaction("setup", (tx) => addFile(tx, media("/titles/Other.svg", videoInfo("/titles/Other.svg", 3600)), { mediaType: "image" }));
    await expectRefusal(doc, h, "edit_title_tool", { text: "x" }, "which title? pass timeline_clip_id, file_id or title_query (2 titles");
  });

  it("reports undoing and redoing a title edit as a change", async () => {
    const { doc, h, clipA, path } = twoClipTitle();
    await call(doc, h, "edit_title_tool", { timeline_clip_id: clipA, text: "Day 2" });
    const undo = await call(doc, h, "undo_tool", { steps: "1" });
    expect(undo.summary).toMatch(/^Undid 1 action: (removed|restored|changed effects\/properties of) /);
    expect(clip(doc, clipA)!.reader.path).toBe(path);
    expect((await call(doc, h, "redo_tool", { steps: "1" })).summary).toMatch(/^Redid 1 action/);
  });

  it("refuses non-titles and titles on locked tracks", async () => {
    const { doc, h, clipA } = twoClipTitle();
    const video = addVideo(doc, { position: 0 });
    await expectRefusal(doc, h, "edit_title_tool", { timeline_clip_id: video, text: "x" }, "is not a title (only .svg titles can be edited)");
    doc.transaction("lock", (tx) => setTrackLocked(tx, L2, true));
    await expectRefusal(doc, h, "edit_title_tool", { timeline_clip_id: clipA, text: "y" }, "title clip(s) on locked track(s)");
  });
});

// ---------------------------------------------------------------------------
// Animated titles
// ---------------------------------------------------------------------------

describe("add_animated_title_tool", () => {
  it("adds a 2D fly-by title above the video with its parameters, one undo step", async () => {
    const doc = newDoc();
    addVideo(doc, { duration: 20 });
    const h = host();
    const undo = doc.undoLabels.length;
    const r = await call(doc, h, "add_animated_title_tool", {
      template: "Fly Towards Camera",
      text: "Tokyo Day 1",
      params: JSON.stringify({ diffuse_color: "#ff0000", text_size: 1.5, spacemode: "left" }),
      position_seconds: "1",
    });
    expect(r.summary).toBe("Added animated title 'Fly Towards Camera' (a 2D keyframed title, 80 frames) on track 2 at 1.00-3.67s.");
    const d = data(r);
    expect((d.params as Record<string, unknown>).title).toBe("Tokyo Day 1");
    expect((d.params as Record<string, unknown>).diffuse_color).toEqual([1, 0, 0, 1]);
    expect((d.params as Record<string, unknown>).spacemode).toBe("LEFT");
    expect((d.params as Record<string, unknown>).file_name).toBe("Tokyo_Day_1");
    expect(h.calls).toContain("writeGenerated Tokyo_Day_1.svg");
    const c = clip(doc, String(d.timeline_clip_id))!;
    expect([c.layer, c.position, c.title]).toEqual([L2, 1, "Fly Towards Camera"]);
    expect((c.scale_x as Keyframe).Points.length).toBeGreaterThan(2);
    expect(svgOf(h, "/generated/Tokyo_Day_1.svg")).toContain("Tokyo Day 1</tspan>");
    expect(doc.undoLabels.length).toBe(undo + 1);
    doc.undo();
    expect(clip(doc, c.id)).toBeUndefined();
    expect(doc.project.files.find((f) => f.id === d.file_id)).toBeUndefined();
  });

  it("follows the desktop's frame remapping on a 60 fps project", async () => {
    const doc = newDoc("FHD 1080p 60 fps");
    const r = await call(doc, host(), "add_animated_title_tool", { template: "fly_by_1", text: "Hi", length_multiplier: "2" });
    expect(data(r)).toMatchObject({ frames: 320, duration: Math.round((320 / 60) * 1000) / 1000 });
  });

  it("places the opening crawl as three clips and the lens flare as an effect", async () => {
    const doc = newDoc();
    const crawl = data(await call(doc, host(), "add_animated_title_tool", { template: "spacemovie_intro" }));
    const ids = crawl.timeline_clip_ids as string[];
    expect(ids).toHaveLength(3);
    const clips = ids.map((id) => clip(doc, id)!);
    expect(clips[0]!.position).toBe(0);
    for (let i = 1; i < 3; i += 1) expect(clips[i]!.position).toBeCloseTo(clips[i - 1]!.position + clips[i - 1]!.end, 6);
    const flare = data(await call(doc, host(), "add_animated_title_tool", { template: "lens_flare", position_seconds: "100" }));
    const fc = clip(doc, String(flare.timeline_clip_id))!;
    expect(fc.effects.map((e) => e.class_name)).toEqual(["LensFlare"]);
    expect(doc.project.files.find((f) => f.id === fc.file_id)!.zenvi_role).toBe("text_overlay");
  });

  it.each([
    [{ template: "nope", text: "x" }, "unknown animated title 'nope'"],
    [{ template: "", text: "x" }, "template is required"],
    [{ template: "fly_by_1", params: { wobble: 1 } }, "unknown parameter 'wobble'"],
    [{ template: "fly_by_1", params: { extrude: 5 } }, "extrude must be between 0 and 1"],
    [{ template: "fly_by_1", params: { fontname: "Comic" } }, "fontname must be one of"],
    [{ template: "fly_by_1", params: { diffuse_color: "bleu" } }, "diffuse_color: unrecognised color"],
    [{ template: "fly_by_1", params: { end_frame: 500 } }, "unknown parameter 'end_frame'"],
    [{ template: "snow", text: "x" }, "has no text"],
    [{ template: "earth" }, "only Zenvi desktop renders"],
  ])("refuses %j before anything changes", async (args, needle) => {
    await expectRefusal(newDoc(), host(), "add_animated_title_tool", args, needle);
  });

  it("renders every template that has a 2D version", async () => {
    const doc = newDoc();
    for (const template of ["blinds", "colors", "dissolve", "explode", "fly_by_two_titles", "glare", "glass_slider", "neon_curves", "rotate_360", "slide_left_to_right", "wireframe_text", "zoom_clapboard"]) {
      const r = await call(doc, host(), "add_animated_title_tool", { template, position_seconds: String(doc.undoLabels.length * 20) });
      expect(r.status, `${template}: ${r.summary}`).toBe("applied");
      expect(() => toStoredPaths(doc.project, "/projects"), template).not.toThrow();
      for (const id of (data(r).timeline_clip_ids as string[] | undefined) ?? [String(data(r).timeline_clip_id)]) {
        const c = clip(doc, id)!;
        expect(c.layer, template).toBe(L1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Editor-tool argument coercion
// ---------------------------------------------------------------------------

describe("editor tool arguments", () => {
  it("accept enums in any case, '10s' numbers, comma lists and JSON objects", async () => {
    const doc = newDoc();
    const r = await call(doc, host(), "add_timer_tool", { mode: "Count_Down", format: "MM:SS", countdown_from_seconds: "10s", background: "no" });
    expect(r.status).toBe("applied");
    const t = timerOf(doc, String(data(r).timeline_clip_id));
    expect([t.mode, t.show_background, y(t.end_time)]).toEqual([1, 0, 10]);
    expect(data(r).duration).toBe(10);
  });

  it("leave the project untouched when a value cannot be coerced", async () => {
    await expectRefusal(newDoc(), host(), "add_timer_tool", { countdown_from_seconds: "ten" }, /^Error: Invalid arguments for add_timer_tool/);
    const r = await call(newDoc(), host(), "add_timer_tool", { definitely_not_an_arg: "1" });
    expect(r.summary).toMatch(/^Error: Invalid arguments for add_timer_tool: Additional properties are not allowed/);
  });
});
