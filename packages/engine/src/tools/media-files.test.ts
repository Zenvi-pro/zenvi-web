/**
 * The Project Files tools, ported from zenvi-core develop
 * tests/test_editor_tools_media_files.py and called through runTool with the
 * Assistant's string arguments: list/filter, update (rename, tags, relink,
 * in/out, sequence fps), image sequences, removal, sub-clips, and optimized
 * previews (refused: only Zenvi desktop has them). The fake host's disk
 * stands in for the CLI's.
 */

import { describe, expect, it } from "vitest";
import type { ReaderInfo } from "../model/types.js";
import { addFile } from "../ops/files.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { L2, audioInfo, imageInfo, videoInfo } from "./test-support/fixture.js";
import type { FakeHostOptions } from "./test-support/fake-host.js";

type Row = Record<string, unknown>;

function harness(host: FakeHostOptions = {}): EditHarness {
  return new EditHarness({ host });
}

/** A project file at `path` (the harness's own files live under /media). */
function fileAt(ed: EditHarness, path: string, info: ReaderInfo, extra: Row = {}): string {
  const id = ed.doc.transaction("setup", (tx) => {
    const file = addFile(tx, { path, info }, { dedupe: false });
    if (Object.keys(extra).length > 0) tx.update(["files", { id: file.id }], extra);
    return file.id;
  });
  ed.mark();
  return id;
}

function file(ed: EditHarness, id: string): Row | undefined {
  return ed.doc.project.files.find((f) => f.id === id) as Row | undefined;
}

function ids(rows: unknown): string[] {
  return (rows as Row[]).map((r) => String(r.file_id));
}

const frames = (folder: string, n: number, name = "frame_") => Array.from({ length: n }, (_, i) => `${folder}/${name}${String(i + 1).padStart(4, "0")}.png`);

// ---------------------------------------------------------------------------
// list_project_files_tool
// ---------------------------------------------------------------------------

describe("list_project_files_tool", () => {
  it("filters by kind, text, tags, usage and missing media", async () => {
    const ed = harness({ disk: ["/shoot/drone_shot.mp4", "/shoot/music.mp3"] });
    const v = fileAt(ed, "/shoot/drone_shot.mp4", videoInfo("/shoot/drone_shot.mp4", 12), { tags: "b-roll, aerial" });
    const a = fileAt(ed, "/shoot/music.mp3", audioInfo("/shoot/music.mp3", 30));
    const img = fileAt(ed, "/shoot/gone.jpg", imageInfo("/shoot/gone.jpg"), { name: "Logo" });
    ed.addClip(v, { position: 0 });
    const r = await ed.receipt("list_project_files_tool");
    expect([r.matched, r.total_files]).toEqual([3, 3]);
    const byId = Object.fromEntries((r.files as Row[]).map((f) => [f.file_id, f]));
    expect(byId[v]).toMatchObject({ clip_count: 1, tags: ["b-roll", "aerial"], optimized_preview: "none", missing: false, kind: "video", duration: 12 });
    expect(byId[img]).toMatchObject({ missing: true, name: "Logo", file_name: "gone.jpg", kind: "image", duration: null });
    expect(byId[img]).not.toHaveProperty("optimized_preview");
    expect(ids((await ed.receipt("list_project_files_tool", { usage: "unused" })).files)).toEqual([a, img]);
    expect(ids((await ed.receipt("list_project_files_tool", { media_type: "Audio" })).files)).toEqual([a]);
    expect(ids((await ed.receipt("list_project_files_tool", { query: "drone" })).files)).toEqual([v]);
    expect(ids((await ed.receipt("list_project_files_tool", { tags: "B-Roll" })).files)).toEqual([v]);
    const missing = await ed.call("list_project_files_tool", { missing_only: "true" });
    expect(ids((missing.data as Row).files)).toEqual([img]);
    expect(missing.summary).toBe("1 of 3 project files match (missing).");
    const filtered = await ed.call("list_project_files_tool", { media_type: "video", query: "Drone", tags: ["b-roll"], usage: "used" });
    expect(filtered.summary).toBe("1 of 3 project files match (video, 'drone', tags ['b-roll'], used).");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("full detail, a limit, and unknown ids", async () => {
    const ed = harness();
    const v = ed.addFile("video", { duration: 10, hasAudio: true });
    ed.addFile("video");
    const full = ((await ed.receipt("list_project_files_tool", { file_ids: [v], detail: "full" })).files as Row[])[0]!;
    expect(full).toMatchObject({ fps: "30/1", fps_value: 30, width: 1280, height: 720, frames: 300, video_codec: "h264", audio_codec: "aac", channel_layout: "stereo", display_ratio: "16:9", analyzed: false });
    expect(full).toHaveProperty("media_duration", 10);
    const limited = await ed.call("list_project_files_tool", { limit: "1" });
    expect(limited.summary).toBe("2 of 2 project files match. Showing the first 1.");
    await ed.refused("list_project_files_tool", { file_ids: ["NOPE", "ALSO"] }, "no project file with id(s) ALSO, NOPE");
  });

  it("marks image sequences and SVG titles", async () => {
    const ed = harness({ disk: ["/seq/f_0001.png"] });
    const s = fileAt(ed, "/seq/f_%04d.png", videoInfo("/seq/f_%04d.png", 2));
    const t = fileAt(ed, "/titles/title.svg", imageInfo("/titles/title.svg"));
    const seq = (await ed.receipt("list_project_files_tool", { media_type: "image_sequence" })).files as Row[];
    expect(ids(seq)).toEqual([s]);
    expect(seq[0]!.missing).toBe(false);
    expect(ids((await ed.receipt("list_project_files_tool", { media_type: "title" })).files)).toEqual([t]);
  });

  it("stills report no duration; audio reports its channel layout", async () => {
    const ed = harness();
    const img = ed.addFile("image");
    const aud = ed.addFile("audio");
    const rows = Object.fromEntries(((await ed.receipt("list_project_files_tool", { detail: "full" })).files as Row[]).map((f) => [f.file_id, f]));
    expect([rows[img]!.duration, rows[img]!.media_duration, rows[img]!.channel_layout]).toEqual([null, null, "none"]);
    expect(rows[aud]!.channel_layout).toBe("stereo");
  });

  it("without a media check, missing is null and missing_only is refused", async () => {
    const ed = harness({ omit: ["media.missing"] });
    ed.addFile("video");
    const rows = (await ed.receipt("list_project_files_tool")).files as Row[];
    expect(rows[0]!.missing).toBeNull();
    await ed.refused("list_project_files_tool", { missing_only: true }, "is not available in this Zenvi surface");
  });

  it("lists sub-clips with their source in/out", async () => {
    const ed = harness();
    const v = ed.addFile("video", { duration: 30 });
    const made = await ed.receipt("create_subclips_tool", { file_id: v, subclips: [{ source_start_seconds: 2, source_end_seconds: 5 }] });
    const sub = (made.subclips as Row[])[0]!.file_id as string;
    const row = ((await ed.receipt("list_project_files_tool", { file_ids: [sub] })).files as Row[])[0]!;
    expect(row).toMatchObject({ source_in: 2, source_out: 5, duration: 3 });
  });
});

// ---------------------------------------------------------------------------
// update_project_files_tool
// ---------------------------------------------------------------------------

describe("update_project_files_tool", () => {
  it("rename is one undo step and can relabel the clips", async () => {
    const ed = harness();
    const v = ed.addFile("video", { name: "sample_video.mp4" });
    const c = ed.addClip(v);
    const r = await ed.receipt("update_project_files_tool", { file_ids: [v], name: "Intro" });
    expect(r.changed).toBe(true);
    expect([file(ed, v)!.name, ed.clip(c)!.title]).toEqual(["Intro", "sample_video.mp4"]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(file(ed, v)!.name).toBe("sample_video.mp4");
    ed.mark();
    const hook = await ed.call("update_project_files_tool", { file_query: "sample_video", name: "Hook", rename_clips: "true" });
    expect(hook.summary).toBe("Updated 1 file(s): renamed. Refreshed 1 timeline clip(s).");
    expect((hook.data as Row).renamed_clip_ids).toEqual([c]);
    expect(ed.clip(c)!.title).toBe("Hook");
    expect((ed.clip(c)!.reader as Row).name).toBe("Hook");
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("tags on many files: add, remove, replace", async () => {
    const ed = harness();
    const a = ed.addFile("video");
    ed.doc.transaction("tags", (tx) => tx.update(["files", { id: a }], { tags: "interview" }));
    const b = ed.addFile("audio");
    await ed.receipt("update_project_files_tool", { file_ids: [a, b], add_tags: "b-roll, Interview" });
    expect([file(ed, a)!.tags, file(ed, b)!.tags]).toEqual(["interview, b-roll", "b-roll, Interview"]);
    expect(ed.stepsSinceMark()).toBe(1);
    await ed.receipt("update_project_files_tool", { file_ids: [a], remove_tags: ["INTERVIEW"] });
    expect(file(ed, a)!.tags).toBe("b-roll");
    await ed.receipt("update_project_files_tool", { file_ids: [b], tags: [] });
    expect(file(ed, b)!.tags).toBe("");
  });

  it("refusals and a no-op add no undo step", async () => {
    const ed = harness();
    const a = ed.addFile("video", { name: "A" });
    const b = ed.addFile("video", { name: "sample_video.mp4" });
    ed.addFile("video", { name: "sample_video_2.mp4" });
    const cases: [Row, string][] = [
      [{ file_ids: [a, b], name: "X" }, "name apply to one file; 2 were chosen"],
      [{ file_ids: [a] }, "nothing to change"],
      [{ file_ids: [a], fps: 24 }, "only image sequences can change frame rate; A keep the rate their media was recorded at"],
      [{ file_ids: [a], rename_clips: true }, "nothing to change"],
      [{ file_ids: [a], rename_clips: true, add_tags: ["x"] }, "rename_clips needs a name"],
      [{ file_ids: [a], source_start_seconds: 5, source_end_seconds: 2 }, "the in-point (5.000s) must be before the out-point (2.000s)"],
      [{ file_ids: [a], source_end_seconds: 999 }, "source_end_seconds 999.000 is past the end of the media (10.000s)"],
      [{ file_ids: [a], path: "/definitely/missing.mp4" }, "no file at '/definitely/missing.mp4'"],
      [{ file_query: "sample_video" }, "nothing to change"],
      [{ file_query: "sample", name: "X" }, "'sample' matches 2 files: 'sample_video.mp4' (file_id="],
      [{ file_ids: ["NOPE"], name: "X" }, "no project file with id='NOPE'"],
      [{ file_ids: [a], path: "/x.mp4", search_folder: "/y" }, "pass path or search_folder, not both"],
      [{ file_ids: [a], source_start_seconds: 1, reset_in_out: true }, "pass source_start/end_seconds or reset_in_out, not both"],
      [{ file_query: "nothing like it", name: "X" }, "no project file matches 'nothing like it'"],
    ];
    for (const [args, fragment] of cases) await ed.refused("update_project_files_tool", args, fragment);
    const same = await ed.call("update_project_files_tool", { file_ids: [a], name: "A" });
    expect([same.status, (same.data as Row).changed]).toEqual(["unchanged", false]);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("in/out and reset", async () => {
    const ed = harness();
    const v = ed.addFile("video", { duration: 20 });
    const r = await ed.receipt("update_project_files_tool", { file_ids: [v], source_start_seconds: "2.0", source_end_seconds: "5.5" });
    expect([file(ed, v)!.start, file(ed, v)!.end]).toEqual([2, 5.5]);
    expect((r.files as Row[])[0]).toMatchObject({ duration: 3.5, source_in: 2, source_out: 5.5 });
    ed.mark();
    await ed.receipt("update_project_files_tool", { file_ids: [v], reset_in_out: true });
    expect(file(ed, v)).not.toHaveProperty("start");
    expect(file(ed, v)).not.toHaveProperty("end");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(file(ed, v)!.start).toBe(2);
  });

  it("a sequence's frame rate rescales it and clamps its clips", async () => {
    const ed = harness();
    const s = fileAt(ed, "/seq/f_%04d.png", videoInfo("/seq/f_%04d.png", 2));
    const c = ed.addClip(s, { end: 2 });
    const r = await ed.receipt("update_project_files_tool", { file_ids: [s], fps: "60" });
    expect([file(ed, s)!.fps, file(ed, s)!.video_timebase, file(ed, s)!.duration]).toEqual([{ num: 60, den: 1 }, { num: 1, den: 60 }, 1]);
    expect([ed.clip(c)!.end, ed.clip(c)!.reader.duration]).toEqual([1, 1]);
    expect((r.files as Row[])[0]!.fps).toBe("60/1");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([file(ed, s)!.fps, ed.clip(c)!.end]).toEqual([{ num: 30, den: 1 }, 2]);
  });

  it("relinks: keeps tags, updates clips and reports whether the content is the same", async () => {
    const disk = ["/old/interview.mp4", "/new/deep/interview.mp4", "/else/interview.mp4", "/nowhere/readme.txt"];
    const ed = harness({ disk, contents: { "/old/interview.mp4": "AAAA", "/new/deep/interview.mp4": "AAAA", "/else/interview.mp4": "BBBB" } });
    const v = fileAt(ed, "/old/interview.mp4", videoInfo("/old/interview.mp4", 20), { tags: "interview", name: "Interview", fingerprint: { sha256: "AAAA", size: 4 } });
    const c = ed.addClip(v, { end: 5 });
    const r = await ed.receipt("update_project_files_tool", { file_ids: [v], search_folder: "/new" });
    expect(file(ed, v)).toMatchObject({ path: "/new/deep/interview.mp4", tags: "interview", name: "Interview", duration: 8 });
    expect(ed.clip(c)!.reader.path).toBe("/new/deep/interview.mp4");
    expect((r.files as Row[])[0]).toMatchObject({ path: "/new/deep/interview.mp4", same_content: true });
    expect(ed.stepsSinceMark()).toBe(1);
    const other = await ed.call("update_project_files_tool", { file_ids: [v], path: "/else/interview.mp4" });
    expect(((other.data as Row).files as Row[])[0]!.same_content).toBe(false);
    expect(other.summary).toContain("content differs");
    ed.doc.undo();
    expect(file(ed, v)!.path).toBe("/new/deep/interview.mp4");
    ed.mark();
    await ed.refused("update_project_files_tool", { file_ids: [v], search_folder: "/nowhere" }, "no media named like Interview under '/nowhere'");
    await ed.refused("update_project_files_tool", { file_ids: [v], search_folder: "/new/deep/interview.mp4" }, "is not a folder");
  });

  it("relinking needs local files: refused where the host has none", async () => {
    const ed = harness({ omit: ["media.importPath", "media.listPaths"] });
    const v = ed.addFile("video");
    await ed.refused("update_project_files_tool", { file_ids: [v], path: "/new/clip.mp4" }, "is not available in this Zenvi surface: relinking");
  });

  it("relinks an image sequence to its new folder at the rate it had", async () => {
    const ed = harness({ disk: frames("/renders/v2", 12) });
    const s = fileAt(ed, "/renders/v1/frame_%04d.png", { ...videoInfo("/renders/v1/frame_%04d.png", 0.5), fps: { num: 24, den: 1 }, video_length: 12 });
    const r = await ed.receipt("update_project_files_tool", { file_ids: [s], path: "/renders/v2" });
    expect(file(ed, s)).toMatchObject({ path: "/renders/v2/frame_%04d.png", fps: { num: 24, den: 1 }, video_timebase: { num: 1, den: 24 }, duration: 0.5, media_type: "video" });
    expect((r.files as Row[])[0]).toMatchObject({ path: "/renders/v2/frame_0001.png", same_content: null });
  });
});

// ---------------------------------------------------------------------------
// import_image_sequence_tool
// ---------------------------------------------------------------------------

describe("import_image_sequence_tool", () => {
  it("imports a folder of frames as one sequence at 24 fps", async () => {
    const ed = harness({ disk: frames("/frames", 10) });
    const receipt = await ed.call("import_image_sequence_tool", { path: "/frames/", fps: "24", name: "Intro frames" });
    expect(receipt.summary).toBe("Imported 10 frames of frame_%04d.png as one 24 fps sequence (0.42s). Place it with add_clip_to_timeline_tool.");
    const r = receipt.data as Row;
    expect(r).toMatchObject({ frames: 10, first_frame: 1, last_frame: 10, fps: "24/1", path: "/frames/frame_%04d.png", name: "Intro frames", duration: 0.417, width: 640, height: 360 });
    const f = file(ed, String(r.file_id))!;
    expect(f).toMatchObject({ media_type: "video", fps: { num: 24, den: 1 }, video_timebase: { num: 1, den: 24 }, video_length: 10, name: "Intro frames", type: "FFmpegReader" });
    expect(f).not.toHaveProperty("fingerprint");
    expect(ed.stepsSinceMark()).toBe(1);
    const again = await ed.call("import_image_sequence_tool", { path: "/frames/frame_0005.png" });
    expect([again.status, (again.data as Row).file_id]).toEqual(["unchanged", r.file_id]);
    expect(again.summary).toBe("That sequence is already in the project as 'Intro frames'.");
  });

  it("defaults to the project frame rate and refuses what is not a sequence", async () => {
    const ed = harness({ disk: [...frames("/frames", 3), "/lone/photo_0001.jpg", "/lone/notes.txt"] });
    const r = await ed.receipt("import_image_sequence_tool", { path: "/frames/frame_0002.png" });
    expect([r.fps, r.frames]).toEqual(["30/1", 3]);
    ed.mark();
    await ed.refused("import_image_sequence_tool", { path: "/lone" }, "no numbered image sequence (name0001.png, name0002.png...) in '/lone'");
    await ed.refused("import_image_sequence_tool", { path: "/lone/photo_0001.jpg" }, "'photo_0001.jpg' has no neighbouring numbered frames; import a single image with import_files_tool");
    await ed.refused("import_image_sequence_tool", { path: "/nope" }, "no file or folder at '/nope'");
  });

  it("is refused where the host cannot open local folders", async () => {
    const ed = harness({ omit: ["media.listPaths"] });
    await ed.refused("import_image_sequence_tool", { path: "/frames" }, "is not available in this Zenvi surface: it cannot open local folders");
  });
});

// ---------------------------------------------------------------------------
// remove_files_from_project_tool
// ---------------------------------------------------------------------------

describe("remove_files_from_project_tool", () => {
  it("scope=unused touches no clip", async () => {
    const ed = harness();
    const used = ed.addFile("video");
    const unused = ed.addFile("audio");
    const c = ed.addClip(used);
    const r = await ed.receipt("remove_files_from_project_tool", { scope: "unused" });
    expect([r.removed_file_ids, r.removed_clip_ids]).toEqual([[unused], []]);
    expect([file(ed, used) !== undefined, ed.clip(c) !== undefined, file(ed, unused)]).toEqual([true, true, undefined]);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("a used file needs confirm; undo restores the file and its clips", async () => {
    const ed = harness();
    const v = ed.addFile("video", { name: "interview.mp4" });
    const c1 = ed.addClip(v, { position: 0 });
    const c2 = ed.addClip(v, { position: 30, layer: L2 });
    await ed.refused("remove_files_from_project_tool", { file_ids: [v] }, "'interview.mp4' (2 clip(s)) is used on the timeline", "confirm_remove_clips", "2 timeline clip(s)");
    const receipt = await ed.call("remove_files_from_project_tool", { file_ids: [v], confirm_remove_clips: "true" });
    expect(receipt.summary).toBe("Removed 1 file(s) from the project and 2 timeline clip(s) that used them. The media files stay on disk.");
    const r = receipt.data as Row;
    expect(new Set(r.removed_clip_ids as string[])).toEqual(new Set([c1, c2]));
    expect([file(ed, v), ed.doc.project.clips]).toEqual([undefined, []]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([file(ed, v) !== undefined, ed.clip(c1) !== undefined, ed.clip(c2) !== undefined]).toEqual([true, true, true]);
    ed.doc.redo();
    expect([file(ed, v), ed.doc.project.clips]).toEqual([undefined, []]);
  });

  it("refuses locked tracks and bad targets", async () => {
    const ed = harness();
    const v = ed.addFile("video");
    ed.addClip(v, { layer: L2 });
    ed.lockTrack(L2);
    await ed.refused("remove_files_from_project_tool", { file_ids: [v], confirm_remove_clips: true }, "clips of these files sit on locked track(s) [2]; unlock them first");
    await ed.refused("remove_files_from_project_tool", { scope: "unused", file_ids: [v] }, "pass scope or file_ids/file_query, not both");
    await ed.refused("remove_files_from_project_tool", {}, "say which file: file_ids or file_query");
    const r = await ed.call("remove_files_from_project_tool", { scope: "unused" });
    expect([r.status, r.summary]).toEqual(["unchanged", "Every project file is used on the timeline; nothing to remove."]);
  });

  it("scope=missing removes what the host cannot find; sub-clips of a removed file stay", async () => {
    const ed = harness({ disk: ["/shoot/here.mp4"] });
    const here = fileAt(ed, "/shoot/here.mp4", videoInfo("/shoot/here.mp4", 10));
    const gone = fileAt(ed, "/shoot/gone.mp4", videoInfo("/shoot/gone.mp4", 10));
    const sub = fileAt(ed, "/shoot/gone.mp4", videoInfo("/shoot/gone.mp4", 10), { start: 1, end: 2, parent_file_id: gone });
    const r = await ed.receipt("remove_files_from_project_tool", { scope: "missing" });
    expect(r.removed_file_ids).toEqual([gone, sub]);
    expect(file(ed, here)).toBeDefined();
    const none = await ed.call("remove_files_from_project_tool", { scope: "missing" });
    expect(none.summary).toBe("No project file is missing its media; nothing to remove.");
  });

  it("reports the sub-clips a removed file leaves", async () => {
    const ed = harness();
    const v = ed.addFile("video", { duration: 30 });
    const sub = fileAt(ed, "/media/cut.mp4", videoInfo("/media/cut.mp4", 30), { start: 1, end: 4, parent_file_id: v });
    const r = await ed.receipt("remove_files_from_project_tool", { file_ids: [v] });
    expect(r.subclips_kept).toEqual([sub]);
  });
});

// ---------------------------------------------------------------------------
// create_subclips_tool
// ---------------------------------------------------------------------------

describe("create_subclips_tool", () => {
  it("creates several sub-clips in one undo step", async () => {
    const ed = harness();
    const v = ed.addFile("video", { duration: 90, name: "sample_video.mp4" });
    ed.doc.transaction("path", (tx) => tx.update(["files", { id: v }], { path: "/media/sample_video.mp4" }));
    ed.mark();
    const receipt = await ed.call("create_subclips_tool", {
      file_id: v,
      subclips: JSON.stringify([
        { source_start_seconds: 5, source_end_seconds: 12, name: "Hook" },
        { source_start_seconds: "70", source_end_seconds: "80.5" },
      ]),
    });
    expect(receipt.summary).toBe("Created 2 sub-clip(s) of 'sample_video.mp4'. Place one with add_clip_to_timeline_tool(file_id=...).");
    const subs = (receipt.data as Row).subclips as Row[];
    expect(subs.map((s) => s.name)).toEqual(["Hook", "sample_video (01:10;00 to 01:20;15)"]);
    expect(subs[1]).toMatchObject({ source_in: 70, source_out: 80.5, duration: 10.5 });
    const hook = file(ed, String(subs[0]!.file_id))!;
    expect([hook.start, hook.end, hook.path]).toEqual([5, 12, "/media/sample_video.mp4"]);
    expect(hook).not.toHaveProperty("parent_file_id");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([file(ed, String(subs[0]!.file_id)), file(ed, String(subs[1]!.file_id))]).toEqual([undefined, undefined]);
  });

  it("trims the AI scene descriptions to each range", async () => {
    const ed = harness();
    const v = ed.addFile("video", { duration: 30 });
    ed.doc.transaction("ai", (tx) =>
      tx.update(["files", { id: v }], {
        ai_metadata: { analyzed: true, scene_descriptions: [{ time: 3, description: "a dog" }, { time: 20, description: "a cat" }] },
      }),
    );
    ed.mark();
    const subs = (await ed.receipt("create_subclips_tool", { file_id: v, subclips: [{ source_start_seconds: 15, source_end_seconds: 25 }] })).subclips as Row[];
    const ai = file(ed, String(subs[0]!.file_id))!.ai_metadata as Row;
    expect((ai.scene_descriptions as Row[]).map((s) => [s.time, s.description])).toEqual([[5, "a cat"]]);
    expect(ai.source_window).toEqual({ start: 15, end: 25 });
  });

  it("refusals add no undo step", async () => {
    const ed = harness();
    const v = ed.addFile("video", { duration: 10 });
    const img = ed.addFile("image");
    const cases: [Row, string][] = [
      [{ file_id: v, subclips: [{ source_start_seconds: 5, source_end_seconds: 20 }] }, "sub-clip 1: 5.00-20.00s is outside the file's 0.00-10.00s"],
      [{ file_id: v, subclips: [{ source_start_seconds: 5, source_end_seconds: 5 }] }, "sub-clip 1: source_end_seconds must be after source_start_seconds"],
      [{ file_id: v, subclips: [] }, "give at least one sub-clip"],
      [{ file_id: img, subclips: [{ source_start_seconds: 0, source_end_seconds: 2 }] }, "a still image has no time range to split"],
      [{ file_id: "NOPE", subclips: [{ source_start_seconds: 0, source_end_seconds: 2 }] }, "no project file with id='NOPE'"],
      [{ file_id: v, subclips: [{ source_start_seconds: 0 }] }, "Error"],
      [{ file_id: v, subclips: [{ source_start_seconds: 1, source_end_seconds: 1.01 }] }, "sub-clip 1 is shorter than one frame"],
    ];
    for (const [args, fragment] of cases) await ed.refused("create_subclips_tool", args, fragment);
  });
});

// ---------------------------------------------------------------------------
// manage_optimized_previews_tool
// ---------------------------------------------------------------------------

describe("manage_optimized_previews_tool", () => {
  it("is refused: only Zenvi desktop has optimized previews", async () => {
    const ed = harness();
    const v = ed.addFile("video");
    for (const action of ["optimize", "status", "unlink", "clear_all"]) {
      const receipt = await ed.refused("manage_optimized_previews_tool", { action, file_ids: [v] }, "is not available in this Zenvi surface", "Zenvi desktop");
      expect(receipt.status).toBe("refused");
    }
  });
});
