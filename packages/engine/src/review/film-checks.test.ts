import { describe, expect, it } from "vitest";
import type { Brief } from "../brief/brief.js";
import { openshotPoint } from "../keyframe/edit.js";
import { createProject } from "../model/defaults.js";
import { Interpolation, type Clip, type Project, type ProjectFile } from "../model/types.js";
import { sfxHits, syncMisses, timelineCauses } from "./av-sync.js";
import { bandingOf } from "./banding.js";
import { copyPacing } from "./copy-pacing.js";
import { filmChecks } from "./film-checks.js";
import { clipSpeeds } from "./motion-speed.js";
import { bannedColour, houseBanFindings } from "./taste.js";

function project(clips: Partial<Clip>[], files: Partial<ProjectFile>[] = []): Project {
  const p = createProject();
  p.width = 1920;
  p.height = 1080;
  p.fps = { num: 30, den: 1 };
  p.files = [{ id: "V1", path: "/v.mp4", media_type: "video", has_video: true, has_audio: false, duration: 60 } as unknown as ProjectFile, ...(files as ProjectFile[])];
  p.clips = clips.map((c, i) => ({ id: `C${i}`, file_id: "V1", position: 0, start: 0, end: 4, layer: 1, ...c }) as unknown as Clip);
  return p;
}
const linear = (...pts: [number, number][]) => ({ Points: pts.map(([x, y]) => openshotPoint(x, y, Interpolation.LINEAR)) });

const brief = (style: string, extra: Partial<Brief> = {}): Brief =>
  ({ goal: "g", platform: "web", aspect: "16:9", length_seconds: 10, style, techniques: [], hook: "h", beats: [{ start: 0, end: 10, name: "all" }], shots: [], motifs: [], storyboard: [], direction: [], checklist: [], missing: [], ...extra }) as Brief;

describe("motion speed (cinetic measure-speed, px/f at 1080p60)", () => {
  it("measures keyframed moves and flags the ceiling and the blur threshold", () => {
    const p = project([{ location_x: linear([1, 0], [31, 1]) as never }, { location_x: linear([1, 0], [7, 1]) as never }]);
    const speeds = clipSpeeds(p);
    expect(speeds.map((s) => s.clipId)).toEqual(["C1", "C0"]);
    expect(speeds[1]!.peak).toBeCloseTo(32, 0);
    expect(speeds[0]!.peak).toBeCloseTo(160, 0);
    const codes = filmChecks({ project: p, brief: null, titles: [], svgs: new Map(), textBoxes: [] }).map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["motion-too-fast", "needs-motion-blur"]));
  });
});

describe("AV sync (every hit has a visible cause within a frame)", () => {
  it("finds the sound effect with nothing happening on screen", () => {
    const sfx = { id: "S1", path: "/hit.wav", media_type: "audio", has_video: false, has_audio: true, duration: 1, zenvi_role: "sfx", zenvi_sfx: { recipe: "hit_transient", hit: 0.05 } };
    const p = project(
      [
        { position: 0, end: 2 },
        { position: 2, start: 0, end: 2 },
        { file_id: "S1", position: 1.95, start: 0, end: 1, layer: 5 },
        { file_id: "S1", position: 3.45, start: 0, end: 1, layer: 5 },
      ],
      [sfx as never],
    );
    const hits = sfxHits(p);
    expect(hits.map((h) => h.time)).toEqual([2, 3.5]);
    const misses = syncMisses(hits, timelineCauses(p), 1 / 30);
    expect(misses.map((m) => m.time)).toEqual([3.5]);
    expect(misses[0]!.offset).toBeCloseTo(0.5, 2);
  });
});

describe("copy pacing (cinetic text flow)", () => {
  it("wants fragments of 1-4 words, held long enough, one at a time, with breaths", () => {
    const codes = copyPacing(
      [
        { id: "a", text: "Your builds wait on nothing at all now", start: 0, end: 2 },
        { id: "b", text: "Cache", start: 2.05, end: 2.3 },
        { id: "c", text: "hits", start: 2.1, end: 9.5 },
      ],
      10,
    ).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["copy-fragment-long", "copy-short-hold", "copy-together", "copy-share", "copy-no-breath"]));
    expect(copyPacing([{ id: "a", text: "Ship it.", start: 1, end: 2.5 }, { id: "b", text: "Sooner.", start: 5, end: 6.4 }], 10)).toEqual([]);
  });
});

describe("the cinetic house bans", () => {
  it("know the banned hue families and allow the rest", () => {
    expect(bannedColour("#FF8A00")).toBe("orange");
    expect(bannedColour("#F5E6C8")).toBe("beige");
    expect(bannedColour("#8B5CF6")).toBe("purple");
    expect(bannedColour("#39FF14")).toBe("neon");
    for (const ok of ["#E5484D", "#1F9D55", "#0EA5A4", "#2F6FEB", "#F2C200", "#0B0D10", "#F4F6F8", "#FFFFFF"]) expect(bannedColour(ok)).toBeNull();
  });

  it("flag a serif italic title, an eyebrow label and 'Introducing'", () => {
    const p = project([{ position: 0, end: 3 }, { position: 0, end: 3 }]);
    const svgs = new Map([
      ["C0", '<svg><text font-family="Instrument Serif" font-style="italic" fill="#FF7A1A">Introducing Kiln</text></svg>'],
      ["C1", '<svg><text font-family="Inter">NEW</text></svg>'],
    ]);
    const boxes = [
      { clipId: "C0", x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.6 },
      { clipId: "C1", x0: 0.45, y0: 0.38, x1: 0.55, y1: 0.43 },
    ];
    const bans = houseBanFindings({ project: p, svgs, textBoxes: boxes }).map((f) => f.ban);
    expect(bans).toEqual(expect.arrayContaining(["serif", "italic", "orange", "introducing", "eyebrow"]));
  });

  it("read the face of an outlined kinetic title from its style tag", () => {
    const p = project([{ position: 0, end: 3, zenvi_kinetic_title: { text: "Introducing Kiln", style: "editorial", animation: "rise" } } as never]);
    expect(houseBanFindings({ project: p }).map((f) => f.ban)).toEqual(expect.arrayContaining(["serif", "italic", "introducing"]));
  });

  it("hold only a cinetic style without a brand of the person's", () => {
    const p = project([{ position: 0, end: 3 }]);
    const svgs = new Map([["C0", '<svg><text font-family="Playfair Display">Kiln</text></svg>']]);
    const run = (b: Brief) => filmChecks({ project: p, brief: b, titles: [{ clipId: "C0", start: 0, end: 3 }], svgs, textBoxes: [] }).map((x) => x.code);
    expect(run(brief("cinetic-launch-film"))).toContain("house-ban-serif");
    expect(run(brief("cinetic-launch-film", { brand: "Kiln: Playfair wordmark, ember orange" }))).not.toContain("house-ban-serif");
    expect(run(brief("fashion-beauty-ad"))).not.toContain("house-ban-serif");
  });
});

describe("banding (cinetic forensics)", () => {
  it("sees flat 8-bit plateaus in a gradient and not a dithered one", () => {
    const w = 512;
    const h = 288;
    const make = (dither: boolean) => {
      const data = new Uint8Array(w * h * 4);
      let seed = 7;
      for (let y = 0; y < h; y += 1)
        for (let x = 0; x < w; x += 1) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          const v = 20 + (x / w) * 24 + (dither ? (seed / 2 ** 32 - 0.5) * 2 : 0);
          const q = Math.round(v);
          data.set([q, q, q, 255], (y * w + x) * 4);
        }
      return { width: w, height: h, data };
    };
    expect(bandingOf(make(false)).area).toBeGreaterThan(0.3);
    expect(bandingOf(make(true)).area).toBeLessThan(0.03);
  });
});
