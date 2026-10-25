import { describe, expect, it } from "vitest";
import { findClip } from "../model/query.js";
import { addClip, setClipProperty } from "./clips.js";
import { clearExportSettings, setExportSetting, setProfile, setProjectAudio, snapToFrameRate, withExportOverride, withoutExportOverrides } from "./project.js";
import { addTitleClip } from "./titles.js";
import { expectRefused, expectUndoRedo, makeDoc, reader } from "./testkit.js";

describe("setProfile", () => {
  it("applies size/fps/ratios in one step and resets export settings", () => {
    const doc = makeDoc();
    doc.transaction("export", (tx) => tx.replace(["export_settings"], [{ name: "cboProfile", value: 3 }]));
    const before = doc.project;
    // A legacy description upgrades to the current profile with the same key (get_profile).
    const p = doc.transaction("profile", (tx) => setProfile(tx, "HD 1080p 25 fps"));
    expect(p.key).toBe("01920x1080p0025_16-09");
    expect(doc.project).toMatchObject({ profile: "FHD PAL 1080p 25 fps", width: 1920, height: 1080, fps: { num: 25, den: 1 }, export_settings: null });
    expect(doc.undoLabels.at(-1)).toBe("profile");
    expectUndoRedo(doc, before);
  });

  it("rescales keyframes and snaps times when the frame rate changes (and undo restores them)", () => {
    const doc = makeDoc();
    doc.transaction("clip", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 1, layer: 1_000_000, id: "C" });
      setClipProperty(tx, "C", "alpha", 0, { frame: 61 });
    });
    const before = doc.project;
    doc.transaction("60", (tx) => setProfile(tx, "HD 720p 60 fps"));
    const c = findClip(doc.project, "C")!;
    expect(c.alpha.Points.map((p) => p.co.X)).toEqual([1, 122]);
    expect(c.position).toBe(1);
    doc.undo();
    expect(doc.project).toEqual(before);
  });

  it("audio-only files take the profile size", () => {
    const doc = makeDoc();
    doc.transaction("fps", (tx) => setProfile(tx, "HD 1080p 30 fps"));
    const song = doc.project.files.find((f) => f.id === "AUDIO00001")!;
    expect([song.width, song.height, song.has_video]).toEqual([1920, 1080, false]);
  });

  it("no change records nothing; unknown profile is refused", () => {
    const doc = makeDoc();
    doc.transaction("same", (tx) => setProfile(tx, "HD 720p 30 fps"));
    expect(doc.canUndo).toBe(false);
    expectRefused(doc, "not_found", (tx) => setProfile(tx, "Cinema 99K"));
  });

  it("snapToFrameRate closes 1-3 frame gaps like convert_framerate.remove_gaps", () => {
    const fps = { num: 24, den: 1 };
    const [a, b] = snapToFrameRate(
      [
        { position: 0, start: 0, end: 2 },
        { position: 2.05, start: 0, end: 1 },
      ],
      fps,
    );
    expect(b!.position).toBeCloseTo(49 / 24, 12);
    expect(a!.end).toBeCloseTo(49 / 24, 12);
  });
});

describe("setProjectAudio", () => {
  it("records only what differs: sample rate, channels and their layout together", () => {
    const doc = makeDoc();
    const before = doc.project;
    const keys = doc.transaction("audio", (tx) => setProjectAudio(tx, { sampleRate: 44100, channels: { count: 1, layout: 4 } }));
    expect(keys).toEqual(["sample_rate", "channels", "channel_layout"]);
    expect(doc.project).toMatchObject({ sample_rate: 44100, channels: 1, channel_layout: 4 });
    expectUndoRedo(doc, before);
    const same = doc.transaction("again", (tx) => setProjectAudio(tx, { sampleRate: 44100 }));
    expect(same).toEqual([]);
  });

  it("refuses values that are not positive whole numbers", () => {
    const doc = makeDoc();
    expectRefused(doc, "invalid_argument", (tx) => setProjectAudio(tx, { sampleRate: 0 }));
    expectRefused(doc, "invalid_argument", (tx) => setProjectAudio(tx, { sampleRate: 44100.5 }));
    expectRefused(doc, "invalid_argument", (tx) => setProjectAudio(tx, { channels: { count: 2, layout: -1 } }));
  });
});

describe("export overrides (set_export_setting)", () => {
  it("coerces keys and values like the desktop", () => {
    let o = withExportOverride({}, "Width", " 1920 ");
    o = withExportOverride(o, "vcodec", "libx264");
    o = withExportOverride(o, "path", "/tmp/out.mp4");
    o = withExportOverride(o, "format", "mp4");
    o = withExportOverride(o, "crf", 18);
    expect(o).toEqual({ width: 1920, video_codec: "libx264", output_path: "/tmp/out.mp4", vformat: "mp4", crf: "18" });
    expect(() => withExportOverride({}, "fps_num", "abc")).toThrow(/integer/);
  });

  it("is not an undo step", () => {
    const doc = makeDoc();
    setExportSetting(doc, "height", 720);
    expect(doc.project.export_overrides).toEqual({ height: 720 });
    expect(doc.canUndo).toBe(false);
  });

  it("clears stored overrides without an undo step", () => {
    expect(withoutExportOverrides({ height: 720, fps_num: 24, fps_den: 1 }, ["fps_num", "fps_den", "nope"])).toEqual({ height: 720 });
    expect(withoutExportOverrides(null, ["height"])).toEqual({});
    const doc = makeDoc();
    setExportSetting(doc, "height", 720);
    setExportSetting(doc, "width", 1280);
    expect(clearExportSettings(doc, ["height"])).toEqual({ width: 1280 });
    expect(doc.project.export_overrides).toEqual({ width: 1280 });
    expect(doc.canUndo).toBe(false);
  });
});

describe("addTitleClip", () => {
  it("imports the SVG and places it for the duration, in one step", () => {
    const doc = makeDoc();
    const before = doc.project;
    const svg = reader({ type: "QtImageReader", path: "/titles/hello.svg", has_single_image: true, has_audio: false, duration: 3600 });
    const r = doc.transaction("title", (tx) =>
      addTitleClip(tx, { file: { path: "/titles/hello.svg", info: svg, name: "hello.svg" }, position: 2, duration: 5, layer: 2_000_000 }),
    );
    expect(r.file.media_type).toBe("image");
    expect([r.clip.position, r.clip.start, r.clip.end, r.clip.title]).toEqual([2, 0, 5, "hello.svg"]);
    expect(doc.undoLabels).toEqual(["title"]);
    expectUndoRedo(doc, before);
    expectRefused(doc, "invalid_argument", (tx) =>
      addTitleClip(tx, { file: { path: "/a.png", info: svg }, position: 0, duration: 5, layer: 1_000_000 }),
    );
    expectRefused(doc, "invalid_argument", (tx) =>
      addTitleClip(tx, { file: { path: "/b.svg", info: svg }, position: 0, duration: 0, layer: 1_000_000 }),
    );
  });
});
