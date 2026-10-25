/**
 * The project-export tools, ported from zenvi-core develop
 * tests/test_editor_tools_project_export.py, _profiles.py, _render.py and
 * _prefs.py, called through runTool with the Assistant's string arguments:
 * recent projects and recovery copies, EDL / XML (Zenvi desktop's),
 * collect / reclaim, caches and history, profiles and reframing, custom
 * profiles, export presets, frames, files, preferences and the layout. The
 * fake host stands in for each surface (its omissions for the ones without).
 */

import { describe, expect, it } from "vitest";
import { createProject } from "../model/defaults.js";
import { setProfile } from "../ops/project.js";
import { addFile } from "../ops/files.js";
import type { PreferenceEntry } from "./types.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { L1, L2, videoInfo } from "./test-support/fixture.js";
import type { FakeHostOptions } from "./test-support/fake-host.js";

type Row = Record<string, unknown>;

function harness(host: FakeHostOptions = {}): EditHarness {
  return new EditHarness({ host });
}

/** A 1920×1080 30 fps project (the desktop tests' FHD 1080p 30 fps). */
function fhd(host: FakeHostOptions = {}): EditHarness {
  const ed = harness(host);
  ed.doc.transaction("setup", (tx) => setProfile(tx, "FHD 1080p 30 fps"));
  ed.mark();
  return ed;
}

function fileAt(ed: EditHarness, path: string, extra: Row = {}): string {
  const id = ed.doc.transaction("setup", (tx) => {
    const file = addFile(tx, { path, info: videoInfo(path, 10) }, { dedupe: false });
    if (Object.keys(extra).length > 0) tx.update(["files", { id: file.id }], extra);
    return file.id;
  });
  ed.mark();
  return id;
}

// ---------------------------------------------------------------------------
// Recent projects and recovery
// ---------------------------------------------------------------------------

describe("recent projects", () => {
  it("lists the host's recent projects with whether each still exists", async () => {
    const ed = harness({
      recent: [
        { path: "/films/kept.zvn", name: "kept", exists: true, modifiedAt: 1_790_000_000 },
        { path: "/films/gone.zvn", name: "gone", exists: false, modifiedAt: null },
      ],
    });
    const call = await ed.call("list_recent_projects_tool");
    expect(call.summary).toBe("2 recent project(s); most recent: kept.");
    const data = call.data as Row;
    expect((data.projects as Row[]).map((p) => [p.index, p.name, p.exists])).toEqual([
      [1, "kept", true],
      [2, "gone", false],
    ]);
    expect((data.projects as Row[])[0]!.modified).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
    expect((data.projects as Row[])[1]!.modified).toBeNull();
    expect(data.current_path).toBe("/projects/current.zvn");
    expect((await ed.call("list_recent_projects_tool")).undoSteps).toBe(0);
    expect((await harness().call("list_recent_projects_tool")).summary).toBe("No recent projects.");
    await harness({ omit: ["storage.recentProjects"] }).refused("list_recent_projects_tool", {}, "not available", "no list of recent projects");
  });

  it("never forgets entries on the web: the lists are the projects themselves, or Zenvi desktop's", async () => {
    const ed = harness({ recent: [{ path: "/films/a.zvn", name: "a", exists: true, modifiedAt: null }] });
    const r = await ed.refused("forget_recent_projects_tool", { missing_only: "true" }, "not available in this Zenvi surface", "File > Recent Projects");
    expect(r.status).toBe("refused");
  });
});

describe("recovery versions", () => {
  const copy = (path: string, minutesAgo: number, clips = 0) => {
    const project = createProject();
    for (let i = 0; i < clips; i += 1) project.markers.push({ id: `M${i}`, position: i } as never);
    return { path, savedAt: Date.now() / 1000 - minutesAgo * 60, sizeBytes: 100, project };
  };

  it("lists the copies newest first, and none for a project that was never saved", async () => {
    const ed = harness({ recovery: [copy("/rec/200-trip.zip", 1), copy("/rec/100-trip.zip", 10)] });
    const r = await ed.call("list_recovery_versions_tool");
    expect(r.summary).toMatch(/^2 recovery version\(s\); newest saved 1\.0 min ago\.$/);
    const versions = (r.data as Row).versions as Row[];
    expect(versions.map((v) => [v.version, v.path])).toEqual([
      [1, "/rec/200-trip.zip"],
      [2, "/rec/100-trip.zip"],
    ]);
    expect(versions[1]!.minutes_ago).toBe(10);
    expect(versions[0]!.saved_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    expect((r.data as Row).project_path).toBe("/projects/current.zvn");

    const unsaved = await harness({ projectPath: null, recovery: [copy("/rec/1-x.zip", 1)] }).call("list_recovery_versions_tool");
    expect(unsaved.summary).toBe("The project has never been saved, so it has no recovery versions.");
    expect((unsaved.data as Row).versions).toEqual([]);
    expect((await harness().call("list_recovery_versions_tool")).summary).toBe("No recovery versions exist for this project yet.");
    await harness({ omit: ["storage.recoveryCopies"] }).refused("list_recovery_versions_tool", {}, "not available", "keeps no recovery copies");
  });

  it("restores a copy over the project and opens it", async () => {
    const ed = harness({ recovery: [copy("/rec/9-trip.zip", 5, 3)] });
    ed.addFile("video");
    await ed.refused("restore_recovery_version_tool", { version: "2" }, "only 1 recovery versions");
    const r = await ed.call("restore_recovery_version_tool", { discard_unsaved: "true" });
    expect(r.summary).toMatch(/^Restored the version saved 5\.0 min ago \(0 clips\); the previous file was kept as current-1-backup\.zvn\.$/);
    expect(r.data).toMatchObject({ path: "/projects/current.zvn", restored_from: "/rec/9-trip.zip", backup_of_previous: "/projects/current-1-backup.zvn" });
    expect(ed.doc.project.files).toHaveLength(0);
    expect(ed.doc.project.markers).toHaveLength(3);
    expect(ed.host.calls).toContain("restore /rec/9-trip.zip");

    await harness({ projectPath: null }).refused("restore_recovery_version_tool", {}, "never been saved");
    await harness().refused("restore_recovery_version_tool", {}, "no recovery versions exist");
    await harness({ omit: ["storage.recoveryCopies"] }).refused("restore_recovery_version_tool", {}, "not available");
  });
});

// ---------------------------------------------------------------------------
// EDL / XML, collect / reclaim
// ---------------------------------------------------------------------------

describe("EDL and Final Cut Pro XML", () => {
  it("are Zenvi desktop's conversions: refused on the web with where to do it", async () => {
    const ed = harness();
    ed.addClip(ed.addFile("video"));
    await ed.refused("export_project_file_tool", { format: "edl", file_path: "/out/cut.edl" }, "not available in this Zenvi surface", "Zenvi desktop", "File > Export Project");
    await ed.refused("import_project_file_tool", { file_path: "/in/cut.xml" }, "not available in this Zenvi surface", "Import Project");
  });
});

describe("consolidate_project_media_tool", () => {
  function shoot(host: FakeHostOptions = {}) {
    const ed = harness({ projectPath: "/proj/film.zvn", disk: ["/outside/shot.mp4"], contents: { "/outside/shot.mp4": "video-bytes" }, ...host });
    const fid = fileAt(ed, "/outside/shot.mp4");
    const cid = ed.addClip(fid);
    return { ed, fid, cid };
  }
  const file = (ed: EditHarness, id: string) => ed.doc.project.files.find((f) => f.id === id) as Row;

  it("collects outside media into the assets folder as one undo step, then reclaims the copies", async () => {
    const { ed, fid, cid } = shoot();
    const collected = await ed.receipt("consolidate_project_media_tool", { action: "collect" });
    const copy = "/proj/film_assets/media/shot.mp4";
    expect(collected).toMatchObject({ action: "collect", count: 1, files: [copy], files_repointed: 1, clips_repointed: 1, undoable: true });
    expect(file(ed, fid)).toMatchObject({ path: copy, original_path: "/outside/shot.mp4" });
    expect(ed.clip(cid)!.reader.path).toBe(copy);
    expect(ed.host.disk!.has(copy)).toBe(true);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(file(ed, fid).path).toBe("/outside/shot.mp4");
    ed.doc.redo();
    expect(file(ed, fid).path).toBe(copy);

    ed.mark();
    const reclaimed = await ed.receipt("consolidate_project_media_tool", { action: "reclaim" });
    expect(reclaimed).toMatchObject({ action: "reclaim", count: 1, files: [copy], undoable: false });
    expect(file(ed, fid).path).toBe("/outside/shot.mp4");
    expect(ed.clip(cid)!.reader.path).toBe("/outside/shot.mp4");
    expect(ed.host.disk!.has(copy)).toBe(false);
    expect(ed.stepsSinceMark()).toBe(0);
    // Saved pointing at the originals before any copy was deleted.
    const saveAt = ed.host.calls.findIndex((c) => c.startsWith("save"));
    expect(saveAt).toBeGreaterThan(-1);
    expect(saveAt).toBeLessThan(ed.host.calls.findIndex((c) => c.startsWith("removeCopies")));
    const again = await ed.call("consolidate_project_media_tool", { action: "reclaim" });
    expect(again.summary).toBe("Nothing to reclaim: no asset copy has an identical original.");
    expect(again.status).toBe("unchanged");
  });

  it("keeps the copies when the save before deleting fails", async () => {
    const { ed, fid } = shoot();
    await ed.receipt("consolidate_project_media_tool", { action: "collect" });
    const copy = file(ed, fid).path;
    ed.host.storage!.save = async () => {
      throw new Error("disk full");
    };
    ed.mark();
    await ed.refused("consolidate_project_media_tool", { action: "reclaim" }, "Project not saved, nothing removed: disk full");
    expect(file(ed, fid).path).toBe(copy);
    expect(ed.host.disk!.has(String(copy))).toBe(true);
  });

  it("needs a saved project and local files", async () => {
    await shoot({ projectPath: null }).ed.refused("consolidate_project_media_tool", { action: "collect" }, "save the project first");
    await shoot({ omit: ["media.collect"] }).ed.refused("consolidate_project_media_tool", { action: "collect" }, "not available", "already stored with the project");
    const nothing = await harness({ projectPath: "/proj/film.zvn", disk: [] }).call("consolidate_project_media_tool", { action: "collect" });
    expect(nothing.summary).toBe("Nothing to collect: all media is already in the project folder or unavailable.");
  });
});

// ---------------------------------------------------------------------------
// Caches and history
// ---------------------------------------------------------------------------

describe("reset_caches_and_history_tool", () => {
  it("clears the editor's playback cache; elsewhere there is none", async () => {
    const ed = harness();
    const r = await ed.call("reset_caches_and_history_tool", { target: "playback_cache" });
    expect(r.summary).toBe("Cleared the playback cache; preview frames will re-render.");
    expect(ed.host.calls).toContain("clearPlaybackCache");
    expect(ed.stepsSinceMark()).toBe(0);
    const cli = await harness({ omit: ["ui.clearPlaybackCache"] }).call("reset_caches_and_history_tool", { target: "Playback_Cache" });
    expect(cli.status).toBe("unchanged");
    expect(cli.summary).toMatch(/keeps no playback cache/);
  });

  it("drops stored waveform data as one undo step", async () => {
    const ed = harness();
    const fid = fileAt(ed, "/media/song.mp3", { ui: { audio_data: [0.1, 0.5], audio_data_rate: 20, keep: 1 } });
    const cid = ed.addClip(fid);
    ed.setClip(cid, { ui: { audio_data: [0.1, 0.5] } });
    const r = await ed.receipt("reset_caches_and_history_tool", { target: "waveforms" });
    expect(r).toMatchObject({ files: 1, clips: 1 });
    expect(ed.doc.project.files[0]!.ui).toEqual({ keep: 1 });
    expect(ed.clip(cid)!.ui).toEqual({});
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect((ed.doc.project.files[0]!.ui as Row).audio_data).toEqual([0.1, 0.5]);
    ed.doc.redo();
    ed.mark();
    const again = await ed.call("reset_caches_and_history_tool", { target: "waveforms" });
    expect(again.summary).toBe("No file or clip has stored waveform data; nothing cleared.");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("clears the undo history only with confirm", async () => {
    const ed = harness();
    ed.addClip(ed.addFile("video"));
    ed.doc.undo();
    ed.mark();
    const undo = ed.doc.undoLabels.length;
    await ed.refused("reset_caches_and_history_tool", { target: "undo_history" }, "cannot be undone", "confirm=true");
    const r = await ed.receipt("reset_caches_and_history_tool", { target: "undo_history", confirm: "true" });
    expect(r).toMatchObject({ undo_steps_cleared: undo, redo_steps_cleared: 1 });
    expect([ed.doc.undoLabels.length, ed.doc.redoLabels.length]).toEqual([0, 0]);
    expect(ed.doc.toJSON().history).toMatchObject({ undo: [], redo: [] });
    expect((await ed.call("reset_caches_and_history_tool", { target: "undo_history", confirm: "yes" })).summary).toBe("The undo history is already empty.");
  });
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

describe("set_project_profile_tool", () => {
  it("instagram_reel with fill reframes landscape clips in one undo step", async () => {
    const ed = fhd();
    const video = ed.addClip(ed.addFile("video"));
    const audio = ed.addClip(ed.addFile("audio"), { layer: L2 });
    const image = ed.addClip(ed.addFile("image"), { position: 30, end: 10 });
    const pip = ed.addClip(ed.addFile("video"), { position: 60 });
    ed.setClip(pip, { scale_x: { Points: [{ co: { X: 1, Y: 0.4 }, interpolation: 0 }] } });
    const title = ed.addClip(ed.addFile("video"), { position: 90 });
    ed.setClip(title, { reader: { ...ed.clip(title)!.reader, path: "/titles/title.svg" } });

    const audioScale = ed.clip(audio)!.scale;
    const r = await ed.receipt("set_project_profile_tool", { profile: "instagram_reel", reframe: "fill" });
    const p = ed.doc.project;
    expect([p.width, p.height, p.profile]).toEqual([1080, 1920, "FHD Vertical 1080p 30 fps"]);
    expect(p.display_ratio).toEqual({ num: 9, den: 16 });
    expect(new Set(r.reframed_clip_ids as string[])).toEqual(new Set([video, image]));
    expect([ed.clip(video)!.scale, ed.clip(video)!.gravity]).toEqual([0, 4]);
    expect(ed.clip(audio)!.scale).toBe(audioScale);
    const reasons = Object.fromEntries((r.skipped as Row[]).map((s) => [s.timeline_clip_id, s.reason]));
    expect(reasons[pip]).toContain("picture-in-picture");
    expect(reasons[title]).toContain("SVG");
    expect(r.suggested_export_preset).toBe("Instagram Reels");
    expect(r.previous_profile).toEqual({ profile: "FHD 1080p 30 fps", width: 1920, height: 1080, fps: 30, aspect: "16:9" });
    expect(ed.stepsSinceMark()).toBe(1);

    ed.doc.undo();
    expect([ed.doc.project.width, ed.doc.project.height, ed.clip(video)!.scale]).toEqual([1920, 1080, 1]);
    ed.doc.redo();
    expect([ed.doc.project.height, ed.clip(video)!.scale]).toEqual([1920, 0]);
  });

  it("keep lists letterboxed clips and changes none; a social preset keeps the project's rate", async () => {
    const ed = harness({});
    ed.doc.transaction("setup", (tx) => setProfile(tx, "FHD PAL 1080p 25 fps"));
    const video = ed.addClip(ed.addFile("video"));
    const r = await ed.call("set_project_profile_tool", { profile: "tiktok" });
    expect((r.data as Row).letterboxed_clip_ids).toEqual([video]);
    expect((r.data as Row).reframed_clip_ids).toEqual([]);
    expect(r.summary).toContain("reframe='fill'");
    expect(ed.doc.project.profile).toBe("FHD Vertical 1080p 25 fps");
    expect(ed.clip(video)!.scale).toBe(1);
  });

  it("fill on an empty timeline says to reframe once clips are placed", async () => {
    const ed = fhd();
    const r = await ed.call("set_project_profile_tool", { profile: "instagram_reel", reframe: "fill" });
    expect((r.data as Row).reframed_clip_ids).toEqual([]);
    expect(r.summary).toContain("no video clips yet");
    expect(r.summary).toContain("again once they are on the timeline");
    const video = ed.addClip(ed.addFile("video"));
    const again = await ed.call("set_project_profile_tool", { reframe: "fill" });
    expect((again.data as Row).reframed_clip_ids).toEqual([video]);
    expect(again.summary).not.toContain("no video clips yet");
    expect(ed.clip(video)!.scale).toBe(0);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("the same profile is a no-op; a locked track is skipped", async () => {
    const ed = fhd();
    const same = await ed.call("set_project_profile_tool", { profile: "FHD 1080p 30 fps" });
    expect(same.status).toBe("unchanged");
    expect((same.data as Row).changed).toBe(false);
    expect(ed.stepsSinceMark()).toBe(0);
    const video = ed.addClip(ed.addFile("video"));
    ed.lockTrack(L1);
    const r = await ed.receipt("set_project_profile_tool", { profile: "vertical", reframe: "fill" });
    expect(r.reframed_clip_ids).toEqual([]);
    expect((r.skipped as Row[])[0]!.reason).toBe("track is locked");
    expect(ed.clip(video)!.scale).toBe(1);
  });

  it("flips orientation, takes a frame rate, matches a file, and makes custom profiles for odd sizes", async () => {
    const ed = fhd();
    const turned = await ed.receipt("set_project_profile_tool", { orientation: "portrait" });
    expect([(turned.profile as Row).width, (turned.profile as Row).height]).toEqual([1080, 1920]);
    const uhd = await ed.receipt("set_project_profile_tool", { profile: "4k", fps: "24" });
    expect((uhd.profile as Row).name).toBe("4K UHD 2160p 24 fps");
    expect(ed.doc.project.fps).toEqual({ num: 24, den: 1 });

    const fid = ed.addFile("video");
    expect(((await ed.receipt("set_project_profile_tool", { from_file_id: fid })).profile as Row).name).toBe("HD 720p 30 fps");
    const odd = await ed.receipt("set_project_profile_tool", { width: "1000", height: "1000", fps: "30" });
    expect(odd.profile).toMatchObject({ name: "Custom 1000x1000 30 fps", user: true, aspect: "1:1" });
    expect(Object.keys(ed.host.profiles)).toEqual(["01000x1000p0030_01-01"]);
    expect(ed.host.profiles["01000x1000p0030_01-01"]).toContain("description=Custom 1000x1000 30 fps\n");
    ed.mark();
    await ed.refused("set_project_profile_tool", { width: "1001", height: "1000" }, "even");
    await ed.refused("set_project_profile_tool", { from_file_id: ed.addFile("audio") }, "no picture");
    await ed.refused("set_project_profile_tool", { width: "1000" }, "give both width and height");
  });

  it("refuses a size no built-in profile has where the host keeps no custom profiles", async () => {
    const ed = fhd({ omit: ["storage.customProfiles"] });
    await ed.refused("set_project_profile_tool", { width: "1000", height: "1000", fps: "30" }, "no built-in profile is 1000x1000 at 30 fps", "Zenvi desktop's profiles folder", "HD 720p 30 fps");
    expect((await ed.receipt("set_project_profile_tool", { width: "1280", height: "720" })).profile).toMatchObject({ name: "HD 720p 30 fps" });
  });

  it("refuses unknown and ambiguous profiles with help", async () => {
    const ed = fhd();
    await ed.refused("set_project_profile_tool", { profile: "hologram" }, "instagram_reel", "WIDTHxHEIGHT");
    await ed.refused("set_project_profile_tool", { profile: "NTSC" }, "matches");
    await ed.refused("set_project_profile_tool", {}, "say what to change");
  });
});

describe("list_project_profiles_tool", () => {
  it("filters by orientation, size, rate and aspect, with the social presets", async () => {
    const ed = harness();
    const portrait = await ed.receipt("list_project_profiles_tool", { orientation: "portrait", height: "1920", fps: "30" });
    const names = (portrait.profiles as Row[]).map((p) => p.name);
    expect(names).toContain("FHD Vertical 1080p 30 fps");
    expect((portrait.profiles as Row[]).every((p) => p.height === 1920)).toBe(true);
    expect((portrait.social_presets as Row[]).some((s) => s.name === "instagram_reel")).toBe(true);
    const square = await ed.receipt("list_project_profiles_tool", { aspect: "1x1", include_social_presets: "false" });
    expect((square.profiles as Row[]).length).toBeGreaterThan(0);
    expect((square.profiles as Row[]).every((p) => p.aspect === "1:1")).toBe(true);
    expect(square).not.toHaveProperty("social_presets");
    const all = await ed.call("list_project_profiles_tool", { limit: "5" });
    expect(all.summary).toMatch(/^\d+ profile\(s\) match; showing 5\.$/);
    expect((all.data as Row).current).toBe("HD 720p 30 fps");
  });

  it("lists the host's custom profiles first", async () => {
    const ed = harness({ profiles: { "00720x1280p0024_09-16": "description=Phone 720x1280 24\nframe_rate_num=24\nframe_rate_den=1\nwidth=720\nheight=1280\n" } });
    const r = await ed.receipt("list_project_profiles_tool", { query: "phone" });
    expect(r.profiles).toEqual([expect.objectContaining({ name: "Phone 720x1280 24", user: true, aspect: "9:16", fps: 24 })]);
    expect(((await ed.receipt("list_project_profiles_tool", {})).profiles as Row[])[0]).toMatchObject({ name: "Phone 720x1280 24" });
  });
});

describe("manage_custom_profiles_tool", () => {
  it("creates, duplicates, edits and deletes custom profiles; never an undo step", async () => {
    const ed = fhd();
    const made = await ed.receipt("manage_custom_profiles_tool", { action: "create", name: "Phone 720x1280 24", width: "720", height: "1280", fps: "24" });
    expect(made.profile).toMatchObject({ name: "Phone 720x1280 24", aspect: "9:16", user: true, fps: 24 });
    expect(made.path).toBe("/profiles/00720x1280p0024_09-16");
    await ed.refused("manage_custom_profiles_tool", { action: "create", name: "Phone 720x1280 24", width: "720", height: "1280" }, "already exists");
    const copy = await ed.receipt("manage_custom_profiles_tool", { action: "duplicate", profile: "FHD 1080p 30 fps" });
    expect(copy.profile).toMatchObject({ name: "FHD 1080p 30 fps (copy)", user: true });
    expect(copy.path).toBe("/profiles/01920x1080p0030_16-09");
    await ed.refused("manage_custom_profiles_tool", { action: "edit", profile: "FHD 1080p 30 fps", width: "1000", height: "500" }, "built-in");
    const edited = await ed.receipt("manage_custom_profiles_tool", { action: "edit", profile: "Phone 720x1280 24", fps: "30" });
    expect([(edited.profile as Row).fps, edited.path]).toEqual([30, "/profiles/00720x1280p0024_09-16"]);
    await ed.refused("manage_custom_profiles_tool", { action: "delete", profile: "FHD 1080p 30 fps" }, "built-in");
    await ed.refused("manage_custom_profiles_tool", { action: "set_default", profile: "Phone 720x1280 24" }, "not available", "Preferences > Default Profile");
    await ed.refused("manage_custom_profiles_tool", { action: "duplicate" }, "needs 'profile'");
    await ed.refused("manage_custom_profiles_tool", { action: "create", width: "721", height: "1280" }, "even");
    await ed.refused("manage_custom_profiles_tool", { action: "create", pixel_ratio: "wide", width: "720", height: "1280" }, "pixel_ratio");
    await ed.receipt("manage_custom_profiles_tool", { action: "delete", profile: "FHD 1080p 30 fps (copy)" });
    expect(Object.keys(ed.host.profiles)).toEqual(["00720x1280p0024_09-16"]);
    await ed.receipt("set_project_profile_tool", { profile: "Phone 720x1280 24" });
    ed.mark();
    await ed.refused("manage_custom_profiles_tool", { action: "delete", profile: "Phone 720x1280 24" }, "cannot delete");
  });

  it("is refused where the host keeps no custom profiles", async () => {
    await fhd({ omit: ["storage.customProfiles"] }).refused("manage_custom_profiles_tool", { action: "create", width: "720", height: "1280" }, "not available", "Zenvi desktop's profiles folder");
  });
});

// ---------------------------------------------------------------------------
// Export presets, frames, files
// ---------------------------------------------------------------------------

describe("list_export_presets_tool", () => {
  it("lists presets with codecs, rates and profiles; ones this host cannot encode only on request", async () => {
    const ed = harness();
    const web = await ed.receipt("list_export_presets_tool", { category: "Web" });
    const reels = (web.presets as Row[]).find((p) => p.title === "Instagram Reels")!;
    expect(reels).toMatchObject({ video_codec: "libx264", category: "Web", export_to: "Video & Audio", available: true });
    expect((reels.qualities as Row).high).toEqual({ video: "5.5 Mb/s", audio: "160 kb/s" });
    expect(reels.profiles).toContain("FHD Vertical 1080p 30 fps");
    const gif = await ed.receipt("list_export_presets_tool", { query: "gif" });
    expect((gif.presets as Row[]).map((p) => [p.title, p.profiles, p.export_to])).toEqual([["GIF (animated)", "any", "Video Only"]]);
    expect(((await ed.receipt("list_export_presets_tool", { query: "prores" })).presets as Row[]).length).toBe(0);
    const prores = await ed.receipt("list_export_presets_tool", { query: "prores", include_unavailable: "true" });
    expect(prores.presets).toEqual([expect.objectContaining({ title: "MOV (ProRes 422)", available: false })]);
    // AVI is not a container the engine's exporters write.
    expect(((await ed.receipt("list_export_presets_tool", { query: "avi" })).presets as Row[]).length).toBe(0);
    const all = (await ed.receipt("list_export_presets_tool", {})).presets as Row[];
    expect(all[0]!.category).toBe("Web");
    await harness({ without: ["exporter"] }).refused("list_export_presets_tool", {}, "not available", "video rendering");
  });
});

describe("save_frame_image_tool", () => {
  it("renders the frame at full size and saves it where the host puts files", async () => {
    const ed = fhd({ disk: [] });
    ed.addClip(ed.addFile("video", { duration: 10 }), { position: 1 });
    const r = await ed.receipt("save_frame_image_tool", { time: "2.0", file_path: "/exports/still" });
    expect(r).toMatchObject({ path: "/exports/still.png", frame: 61, time: 2, width: 1920, height: 1080 });
    expect(ed.host.calls).toContain("renderFrame 2.00");
    await ed.refused("save_frame_image_tool", { time: "2.0", file_path: "/exports/still.png" }, "/exports/still.png already exists; pass overwrite=true");
    expect((await ed.receipt("save_frame_image_tool", { time: "2.0", file_path: "/exports/still.png", overwrite: "true" })).path).toBe("/exports/still.png");
    const jpg = await ed.receipt("save_frame_image_tool", { time: "3", file_path: "/exports/s.jpg" });
    expect(jpg.path).toBe("/exports/s.jpg");
    const named = await ed.receipt("save_frame_image_tool", { time: "-1" });
    expect(named.path).toBe("/projects/Frame-00001.png");
    await ed.refused("save_frame_image_tool", { time: "99" }, "after the end of the last clip (11.000s)");
    expect(ed.stepsSinceMark()).toBe(0);
    await harness().refused("save_frame_image_tool", {}, "the timeline is empty");
  });

  it("attaches the frame where the host writes no files", async () => {
    const ed = harness({ omit: ["storage.writeBytes"] });
    ed.addClip(ed.addFile("video"));
    const result = await (await import("./registry.js")).runTool({ doc: ed.doc, host: ed.host }, "save_frame_image_tool", { time: "1" });
    expect(result.ok).toBe(true);
    expect(result.images).toHaveLength(1);
    expect(result.data!.warnings[0]).toContain("writes no files");
  });
});

describe("export_files_to_folder_tool", () => {
  it("copies plain files and renders sub-clips; files already there are skipped", async () => {
    const ed = harness({ disk: [] });
    const plain = fileAt(ed, "/shoot/Shot 1.mp4");
    const sub = fileAt(ed, "/shoot/long.mp4", { start: 1, end: 2, name: "Hook!" });
    const r = await ed.receipt("export_files_to_folder_tool", { file_ids: `${plain},${sub}`, folder: "/handoff" });
    expect(r.folder).toBe("/handoff");
    expect(r.files).toEqual([
      expect.objectContaining({ file_id: plain, status: "copied", path: "/handoff/shot 1 [0.00 - 10.00].mp4" }),
      expect.objectContaining({ file_id: sub, status: "rendered", path: "/handoff/hook [1.00 - 2.00].mp4" }),
    ]);
    const options = ed.host.exports.at(-1)!;
    expect(options).toMatchObject({ format: "mp4", width: 1280, height: 720, videoCodec: "libx264", crf: 22, audioCodec: "aac", output: "/handoff/hook [1.00 - 2.00].mp4" });
    const again = await ed.call("export_files_to_folder_tool", { file_ids: [plain], folder: "/handoff" });
    expect(again.summary).toBe("Exported 0 file(s) to /handoff; 1 already there.");
    expect(((again.data as Row).files as Row[])[0]!.status).toBe("skipped (exists)");
    await ed.refused("export_files_to_folder_tool", { file_ids: ["nope"] }, "no project file with id='nope'");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("refuses sub-clips where the host cannot render", async () => {
    const ed = harness({ without: ["exporter"] });
    const sub = fileAt(ed, "/shoot/long.mp4", { start: 1, end: 2 });
    await ed.refused("export_files_to_folder_tool", { file_ids: [sub] }, "could not export", "needs video rendering");
    await harness({ omit: ["storage.exportMedia"] }).refused("export_files_to_folder_tool", { file_ids: [] }, "give at least one file id");
  });
});

// ---------------------------------------------------------------------------
// Preferences and layout
// ---------------------------------------------------------------------------

const PREFS: PreferenceEntry[] = [
  { key: "snapping", title: "Snapping", tab: "Timeline", type: "bool", value: true, default: true },
  { key: "autosave-interval", title: "Autosave Interval (minutes)", tab: "Autosave", type: "spinner", value: 3, default: 3, min: 1, max: 60 },
  { key: "history-limit", title: "History Limit (# of undo/redo)", tab: "Autosave", type: "spinner-int", value: 50, default: 50, min: 0, max: 1000 },
  { key: "theme", title: "Default Theme", tab: "General", type: "dropdown", value: "dark", default: "dark", choices: [{ value: "dark", name: "Dark" }, { value: "light", name: "Light" }] },
  { key: "zenvi-backend-url", title: "Backend URL", tab: "AI", type: "text", value: "https://api.zenvi.pro", default: "https://api.zenvi.pro", readOnly: "set when the web editor is built" },
  { key: "actionUndo", title: "Undo", tab: "Keyboard", type: "text", value: "Ctrl+Z", default: "Ctrl+Z" },
  { key: "actionRedo", title: "Redo", tab: "Keyboard", type: "text", value: "Ctrl+Shift+Z", default: "Ctrl+Shift+Z" },
];

describe("preferences", () => {
  it("reads by tab, key or title and query; shortcuts only when asked", async () => {
    const ed = harness({ preferences: PREFS });
    const autosave = await ed.receipt("get_preferences_tool", { tab: "Autosave" });
    expect((autosave.preferences as Row[]).map((p) => p.key)).toEqual(["autosave-interval", "history-limit"]);
    expect((autosave.preferences as Row[])[0]).toMatchObject({ min: 1, max: 60, default: 3, type: "spinner" });
    const one = await ed.call("get_preferences_tool", { key: "Default Theme" });
    expect(one.summary).toBe("Default Theme = 'dark' (default 'dark').");
    expect((one.data as Row).preference).toMatchObject({ choices: [{ value: "dark", name: "Dark" }, { value: "light", name: "Light" }] });
    const all = await ed.receipt("get_preferences_tool", {});
    expect((all.preferences as Row[]).some((p) => p.tab === "Keyboard")).toBe(false);
    expect(((await ed.receipt("get_preferences_tool", { query: "undo" })).preferences as Row[]).some((p) => p.tab === "Keyboard")).toBe(true);
    expect((await ed.call("get_preferences_tool", { key: "autosave" })).summary).toContain("Did you mean: autosave-interval?");
    expect(((await ed.receipt("get_preferences_tool", { key: "zenvi-backend-url" })).preference as Row).read_only).toBe(true);
    await harness({ omit: ["ui.preferences"] }).refused("get_preferences_tool", {}, "not available", "no editor window");
  });

  it("sets a value after checking its type, range and choices; never an undo step", async () => {
    const ed = harness({ preferences: PREFS });
    const r = await ed.call("set_preference_tool", { key: "autosave-interval", value: "5" });
    expect(r.summary).toBe("Set Autosave Interval (minutes) to 5.0 (was 3.0).");
    expect(ed.host.calls).toContain("setPreference autosave-interval=5");
    await ed.refused("set_preference_tool", { key: "autosave-interval", value: "0" }, "between 1.0 and 60.0");
    await ed.refused("set_preference_tool", { key: "history-limit", value: "2.5" }, "whole number");
    await ed.refused("set_preference_tool", { key: "snapping", value: "maybe" }, "true or false");
    expect((await ed.receipt("set_preference_tool", { key: "snapping", value: "off" })).value).toBe(false);
    expect((await ed.receipt("set_preference_tool", { key: "theme", value: "Light" })).value).toBe("light");
    await ed.refused("set_preference_tool", { key: "theme", value: "Tape" }, "dark (Dark)");
    expect((await ed.call("set_preference_tool", { key: "theme", value: "light" })).status).toBe("unchanged");
    await ed.refused("set_preference_tool", { key: "zenvi-backend-url", value: "http://evil" }, "protected", "built");
    await ed.refused("set_preference_tool", { key: "warp-drive", value: "1" }, "no preference named 'warp-drive'");
    await ed.refused("set_preference_tool", {}, "give key and value");
    await ed.refused("set_preference_tool", { key: "actionRedo", value: "Ctrl+Z" }, "shortcut conflict: Ctrl+Z is already Undo");
    await ed.refused("set_preference_tool", { key: "actionRedo", value: "Ctrl++++" }, "not a key sequence");
    const restored = await ed.receipt("set_preference_tool", { restore_tab: "Timeline" });
    expect(restored).toMatchObject({ tab: "Timeline", restored: ["snapping"], restart_required: false });
    await ed.refused("set_preference_tool", { key: "snapping", value: "on", restore_tab: "General" }, "not both");
    expect(ed.stepsSinceMark()).toBe(0);
  });
});

describe("editor layout", () => {
  it("reports and changes panels; what this editor lacks is refused before anything moves", async () => {
    const ed = harness();
    const layout = await ed.call("get_editor_layout_tool");
    expect(layout.summary).toBe("View 'simple' with 4 open panel(s).");
    expect(layout.data).toMatchObject({ open_panels: ["Project Files", "Properties", "Timeline", "Video Preview"], closed_panels: ["Assistant", "Effects"], custom_views: [] });

    const shown = await ed.receipt("set_editor_layout_tool", { show_panels: ["effects", "chat"], hide_panels: "properties" });
    expect(shown.open_panels).toEqual(["Assistant", "Effects", "Timeline", "Video Preview"]);
    const both = await ed.call("set_editor_layout_tool", { show_panels: ["Project Files", "Effects"] });
    expect(both.warnings[0]).toContain("Project Files shares its place with Effects");
    expect((await ed.receipt("set_editor_layout_tool", { view: "Default" })).active_view).toBe("simple");

    await ed.refused("set_editor_layout_tool", { show_panels: ["Holodeck"] }, "no panel named 'Holodeck'; panels: Assistant, Effects, Project Files");
    await ed.refused("set_editor_layout_tool", { hide_panels: ["timeline"] }, "always stays open");
    await ed.refused("set_editor_layout_tool", { view: "Color Grading" }, "no Color Grade view");
    await ed.refused("set_editor_layout_tool", { view: "cinema mode" }, "no view named 'cinema mode'");
    await ed.refused("set_editor_layout_tool", { scopes: "show_all", show_panels: ["Effects"] }, "no scopes");
    await ed.refused("set_editor_layout_tool", { fullscreen: "on" }, "click or a key press");
    await ed.refused("set_editor_layout_tool", { save_view_as: "Grade" }, "no saved custom views");
    await ed.refused("set_editor_layout_tool", {}, "say what to change");
    expect(ed.host.calls.filter((c) => c.startsWith("layout"))).toHaveLength(3);
    expect((await ed.receipt("set_editor_layout_tool", { toolbar: "show", dock_all: "true" })).toolbar_visible).toBe(true);
    await harness({ omit: ["ui.layout"] }).refused("get_editor_layout_tool", {}, "not available", "no editor window");
    await harness({ without: ["ui"] }).refused("set_editor_layout_tool", { view: "simple" }, "not available");
  });
});
