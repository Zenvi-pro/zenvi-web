import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import { ProjectParseError } from "./errors.js";
import { parseProject, parseProjectText, serializeProject } from "./parse.js";
import { repairProjectText } from "./repair.js";
import { PROJECT_FORMAT_VERSION } from "./versions.js";

// Desktop projects with personal data removed (ai_metadata, history,
// fingerprints, home folders → ../media/…): Mountain_montage (6 clips, 5 fade
// transitions, libopenshot 0.5.0 stamp) and podcast_clip (11 subclip files
// under @assets/, thumbnails).
const fixture = (name: string): string => readFileSync(new URL(`../../fixtures/projects/${name}`, import.meta.url), "utf8");
const MOUNTAIN = fixture("mountain-montage.zvn");
const PODCAST = fixture("podcast-subclips.zvn");

function ids(): () => string {
  let n = 0;
  return () => `NEWID${String((n += 1)).padStart(5, "0")}`;
}

function issuesOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProjectParseError) return [...error.issues];
    throw error;
  }
  throw new Error("expected a ProjectParseError");
}

describe("parseProject on desktop projects", () => {
  it("loads Mountain_montage and keeps every known and unknown field", () => {
    const raw = JSON.parse(MOUNTAIN) as Record<string, unknown>;
    const project = parseProject(raw);
    expect(project.clips).toHaveLength(6);
    expect(project.effects).toHaveLength(5);
    expect(project.files).toHaveLength(5);
    expect(project.effects[0]!.reader.path).toBe("@transitions/common/fade.svg");
    // Desktop transitions are sparse: no class_name, kept that way.
    expect("class_name" in project.effects[0]!).toBe(false);
    expect(project.export_settings).toEqual(raw.export_settings);
    expect(project.files[1]!.duration_strategy).toBe("VideoPreferred");
    expect(project.version).toEqual(PROJECT_FORMAT_VERSION);
    // Paths stay as stored.
    expect(project.files[0]!.path).toBe("../media/freesound_750340.mp3");
  });

  it("applies the desktop load repairs to Mountain_montage (audio-only clip)", () => {
    const raw = JSON.parse(MOUNTAIN) as { clips: Record<string, unknown>[] };
    const before = raw.clips.find((c) => c.id === "4H5AEUDLOT")!;
    const after = parseProject(raw).clips.find((c) => c.id === "4H5AEUDLOT")!;
    expect(after.scale).toBe(3);
    expect(after.has_video).toEqual({ Points: [{ co: { X: 1, Y: 0 }, interpolation: 2 }] });
    expect(after.reader.has_video).toBe(false);
    // Everything else on the clip is unchanged.
    const { scale: _s1, has_video: _h1, reader: _r1, ...restBefore } = before;
    const { scale: _s2, has_video: _h2, reader: _r2, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
  });

  it("loads podcast_clip with its subclip keys and @assets paths", () => {
    const project = parseProject(JSON.parse(PODCAST));
    expect(project.files).toHaveLength(11);
    expect(project.files[0]!.zenvi_subclip).toBe(true);
    expect(project.files[0]!.parent_file_id).toBe("K7L871SPFU");
    expect(project.files[0]!.path).toBe("@assets/media/videoplayback_P6L13C6REQ.mp4");
    expect(project.files[0]!.image).toBe("thumbnail/P6L13C6REQ.png");
  });

  it("is idempotent across serializeProject and works with ProjectDocument", () => {
    for (const text of [MOUNTAIN, PODCAST]) {
      const once = parseProject(JSON.parse(text));
      const twice = parseProjectText(serializeProject(once));
      expect(twice).toEqual(once);
      const doc = new ProjectDocument(once);
      expect(parseProject(JSON.parse(serializeProject(doc.toJSON())))).toEqual(once);
    }
  });

  it("does not modify its input", () => {
    const raw = JSON.parse(MOUNTAIN) as unknown;
    const copy = structuredClone(raw);
    parseProject(raw);
    expect(raw).toEqual(copy);
  });
});

describe("parseProject defaults", () => {
  it("fills a bare object like a new desktop project", () => {
    const project = parseProject({}, { newId: ids() });
    const fresh = createProject({ id: "NEWID00001" });
    expect(project).toEqual({ ...fresh, version: { ...PROJECT_FORMAT_VERSION } });
  });

  it("fills size and rate from the named profile", () => {
    const project = parseProject({ id: "P", profile: "FHD PAL 1080p 25 fps", version: { ...PROJECT_FORMAT_VERSION } });
    expect([project.width, project.height, project.fps]).toEqual([1920, 1080, { num: 25, den: 1 }]);
  });

  it("keeps saved size and rate even when the profile says otherwise (no profile re-apply)", () => {
    const project = parseProject({ id: "P", profile: "HD 720p 30 fps", width: 1080, height: 1920, fps: { num: 24, den: 1 } });
    expect([project.width, project.height, project.fps]).toEqual([1080, 1920, { num: 24, den: 1 }]);
  });

  it("keeps the saved sample rate and channels", () => {
    const project = parseProject({ id: "P", sample_rate: 44100, channels: 1, channel_layout: 4 });
    expect([project.sample_rate, project.channels, project.channel_layout]).toEqual([44100, 1, 4]);
  });

  it("repairs missing or empty history like load()", () => {
    expect(parseProject({ id: "P", history: null }).history).toEqual({ undo: [], redo: [] });
    expect(parseProject({ id: "P", history: {} }).history).toEqual({ undo: [], redo: [] });
    expect(parseProject({ id: "P", history: [] }).history).toEqual({ undo: [], redo: [] });
    const undo = [{ type: "insert", key: ["markers"], value: { id: "M1", position: 1 }, transaction: "t" }];
    expect(parseProject({ id: "P", history: { undo } }).history).toEqual({ undo, redo: [] });
  });

  it("normalizes containers the engine reads", () => {
    const project = parseProject({
      id: "P",
      export_overrides: null,
      clips: [{ id: "C1", file_id: "F1", position: 0, start: 0, end: 1, layer: 1 }],
    });
    expect(project.export_overrides).toEqual({});
    expect(project.clips[0]!.effects).toEqual([]);
  });

  it("replaces the template id T0 and keeps other ids", () => {
    expect(parseProject({ id: "T0" }, { newId: ids() }).id).toBe("NEWID00001");
    expect(parseProject({ id: "ABCDEFGHIJ" }).id).toBe("ABCDEFGHIJ");
  });

  it("stamps the version but keeps other version keys", () => {
    const project = parseProject({ id: "P", version: { "openshot-qt": "1.0.100", libopenshot: "1.0.0", build: "abc" } });
    expect(project.version).toEqual({ ...PROJECT_FORMAT_VERSION, build: "abc" });
  });

  it("treats an unstamped project as an OpenShot beta project, like the desktop", () => {
    const clip = { id: "C1", file_id: "F1", position: 0, start: 0, end: 1, layer: 1, alpha: { Points: [{ co: { X: 1, Y: 1 }, interpolation: 1 }] } };
    expect(parseProject({ id: "P", clips: [clip] }).clips[0]!.alpha.Points[0]!.co.Y).toBe(0);
    const stamped = { id: "P", clips: [clip], version: { ...PROJECT_FORMAT_VERSION } };
    expect(parseProject(stamped).clips[0]!.alpha.Points[0]!.co.Y).toBe(1);
  });

  it("does not let __proto__ keys pollute prototypes", () => {
    const project = parseProject(JSON.parse('{"id": "P", "__proto__": {"polluted": true}, "settings": {"__proto__": {"x": 1}}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(project)).toBe(Object.prototype);
  });
});

describe("parseProject validation", () => {
  it("rejects non-objects", () => {
    for (const bad of [null, [], "x", 3, undefined]) {
      expect(issuesOf(() => parseProject(bad))).toEqual([{ path: "", message: "expected a JSON object" }]);
    }
  });

  it("names every bad field with its path", () => {
    const issues = issuesOf(() =>
      parseProject({
        id: "P",
        fps: { num: 30, den: 0 },
        width: 12.5,
        clips: [
          { id: "C1", file_id: "F1", position: "1", start: 0, end: 1, layer: 1 },
          {
            id: "C2",
            file_id: "F1",
            position: 0,
            start: 0,
            end: 1,
            layer: 1,
            alpha: { Points: [{ co: { X: "1", Y: 1 } }] },
            wave_color: { red: { Points: [{ co: { X: 1, Y: null } }] } },
            effects: [{ id: "E1", type: "Blur", sigma: { Points: "nope" } }],
          },
        ],
        layers: [{ id: "L1" }],
        files: [{ id: "F1" }],
      }),
    );
    const paths = issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "fps.den",
        "width",
        "clips[0].position",
        "clips[1].alpha.Points[0].co.X",
        "clips[1].wave_color.red.Points[0].co.Y",
        "clips[1].effects[0].sigma.Points",
        "layers[0].number",
        "files[0].path",
      ]),
    );
    expect(issues).toHaveLength(8);
  });

  it("explains itself in the error message", () => {
    expect(() => parseProject({ id: "P", markers: [{ id: "M1", position: "soon" }] })).toThrow(
      /^Invalid project: markers\[0\]\.position: .*expected number/,
    );
  });
});

describe("parseProjectText", () => {
  it("rejects text that is not JSON", () => {
    expect(() => parseProjectText("{ nope")).toThrow(/not valid JSON/);
  });

  it("reads the NaN/Infinity tokens Python writes and reports the field", () => {
    const project = parseProjectText('{"id": "P", "settings": {"gain": NaN, "peak": -Infinity, "label": "NaN"}}');
    expect(project.settings).toEqual({ gain: null, peak: null, label: "NaN" });
    expect(() => parseProjectText('{"id": "P", "duration": Infinity}')).toThrow(/duration/);
  });

  it("repairs OpenShot 2.6.0 unquoted drive keys", () => {
    const text = '{\n "version": {"openshot-qt": "2.6.0", "libopenshot": "0.2.7"},\n C: 1,\n "id": "P"\n}';
    expect(() => JSON.parse(text)).toThrow();
    expect(parseProjectText(text).C).toBe(1);
  });

  it("repairs OpenShot 2.5.0 slash escapes", () => {
    const text = '{"version": {"openshot-qt": "2.5.0", "libopenshot": "0.2.5"}, "id": "P", "settings": {"name": "caf/u00e9"}}';
    expect(parseProjectText(text).settings).toEqual({ name: "café" });
    // Healthy text and other versions are untouched.
    const healthy = '{"version": {"openshot-qt": "2.6.1"}, "settings": {"name": "a/u00e9"}}';
    expect(repairProjectText(healthy)).toBe(healthy);
  });
});

describe("serializeProject", () => {
  it("writes desktop-style JSON with the engine stamp", () => {
    const project = { ...createProject({ id: "P1" }), extra: { kept: true } };
    const text = serializeProject(project);
    expect(text.startsWith('{\n "id": "P1",\n "fps": {\n  "num": 30,')).toBe(true);
    const back = JSON.parse(text) as Record<string, unknown>;
    expect(back.version).toEqual(PROJECT_FORMAT_VERSION);
    expect(back.extra).toEqual({ kept: true });
    // createProject() already carries the current stamp, so nothing reads it as a beta project.
    expect(project.version).toEqual(PROJECT_FORMAT_VERSION);
  });
});
