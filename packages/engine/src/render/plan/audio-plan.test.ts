import { describe, expect, it } from "vitest";
import type { Clip, Project } from "../../model/types.js";
import { planAudio } from "./audio-plan.js";

const FPS = { num: 30, den: 1 };

function kf(...points: [number, number][]): unknown {
  return { Points: points.map(([X, Y]) => ({ co: { X, Y }, interpolation: 1 })) };
}

function video(path = "/media/a.mp4", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "FFmpegReader",
    path,
    has_video: true,
    has_audio: true,
    has_single_image: false,
    duration: 60,
    width: 640,
    height: 360,
    fps: FPS,
    video_length: 1800,
    sample_rate: 48000,
    channels: 2,
    ...extra,
  };
}

function clip(id: string, fields: Record<string, unknown>): Clip {
  return {
    id,
    file_id: `f-${id}`,
    layer: 1,
    position: 0,
    start: 0,
    end: 2,
    reader: video(),
    effects: [],
    ...fields,
  } as unknown as Clip;
}

function project(clips: Clip[], effects: unknown[] = []): Project {
  return { fps: FPS, sample_rate: 48000, channels: 2, width: 640, height: 360, clips, effects } as unknown as Project;
}

describe("planAudio", () => {
  it("maps a trimmed clip to one segment of its source", () => {
    const plan = planAudio(project([clip("a", { position: 1, start: 2, end: 5 })]));
    expect(plan).toMatchObject({ sampleRate: 48000, channels: 2, start: 0, end: 4 });
    expect(plan.segments).toHaveLength(1);
    const s = plan.segments[0]!;
    expect(s).toMatchObject({ clipId: "a", fileId: "f-a", path: "/media/a.mp4", timelineStart: 1, sourceStart: 2, rate: 1, effects: [] });
    expect(s.duration).toBeCloseTo(3, 12);
    expect(s.gain).toEqual([
      { t: 0, gain: 1 },
      { t: s.duration, gain: 1 },
    ]);
  });

  it("skips muted clips, stills and readers without audio", () => {
    const muted = clip("m", { has_audio: kf([1, 0]) });
    const still = clip("s", { reader: { ...video("/media/p.png"), type: "QtImageReader", has_audio: false, has_single_image: true } });
    const silent = clip("v", { reader: video("/media/silent.mp4", { has_audio: false }) });
    expect(planAudio(project([muted, still, silent])).segments).toEqual([]);
  });

  it("mutes clip frames past the media length", () => {
    const short = clip("a", { end: 4, reader: video("/media/a.mp4", { duration: 1 }) });
    const [s] = planAudio(project([short])).segments;
    expect(s!.duration).toBeCloseTo(1, 12);
  });

  it("samples the volume ramp exactly at frame boundaries", () => {
    // volume 1 at frame 1, 0 at frame 31: libopenshot ramps volume(n-1) → volume(n) over frame n.
    const [s] = planAudio(project([clip("a", { volume: kf([1, 1], [31, 0]) })])).segments;
    expect(s!.gain).toEqual([
      { t: 0, gain: 1 },
      { t: 1600 / 48000, gain: 1 },
      { t: (31 * 1600) / 48000, gain: 0 },
      { t: 2, gain: 0 },
    ]);
  });

  it("averages overlapping clips with AVERAGE mixing", () => {
    const a = clip("a", { end: 2, mixing: 1 });
    const b = clip("b", { layer: 2, position: 1, end: 2, mixing: 1, reader: video("/media/b.mp4") });
    const plan = planAudio(project([a, b]));
    const sa = plan.segments.find((s) => s.clipId === "a")!;
    const sb = plan.segments.find((s) => s.clipId === "b")!;
    // a: full volume, then halved from the first frame b overlaps (a step at t = 1 s).
    expect(sa.gain).toEqual([
      { t: 0, gain: 1 },
      { t: 1, gain: 1 },
      { t: 1, gain: 0.5 },
      { t: 2, gain: 0.5 },
    ]);
    expect(sb.gain).toEqual([
      { t: 0, gain: 0.5 },
      { t: 1, gain: 0.5 },
      { t: 1, gain: 1 },
      { t: 2, gain: 1 },
    ]);
    expect(sb.timelineStart).toBe(1);
  });

  it("reduces overlapping clips by 0.77 with REDUCE mixing", () => {
    const a = clip("a", { mixing: 2 });
    const b = clip("b", { layer: 2, mixing: 0 });
    const plan = planAudio(project([a, b]));
    expect(plan.segments.find((s) => s.clipId === "a")!.gain.map((p) => p.gain)).toEqual([Math.fround(0.77), Math.fround(0.77)]);
    expect(plan.segments.find((s) => s.clipId === "b")!.gain.map((p) => p.gain)).toEqual([1, 1]);
  });

  it("counts still clips in the AVERAGE volume sum (FrameMapper reports audio)", () => {
    const a = clip("a", { mixing: 1 });
    const still = clip("s", { layer: 2, reader: { ...video("/media/p.png"), type: "QtImageReader", has_audio: false } });
    expect(planAudio(project([a, still])).segments[0]!.gain.map((p) => p.gain)).toEqual([0.5, 0.5]);
  });

  it("folds equal-power transition fades into the gain", () => {
    // a: 0-3 s, b: 2-5 s on one layer; a fade_audio_hint Mask over the 1 s overlap.
    const a = clip("a", { end: 3 });
    const b = clip("b", { position: 2, end: 3, reader: video("/media/b.mp4") });
    const mask = { id: "t", type: "Mask", layer: 1, position: 2, start: 0, end: 1, fade_audio_hint: true, reader: video("/m.png") };
    const plan = planAudio(project([a, b], [mask]));
    const sa = plan.segments.find((s) => s.clipId === "a")!;
    const sb = plan.segments.find((s) => s.clipId === "b")!;
    // Mask frames 61..90: a fades out with cos, b fades in with sin.
    const g = (fadeIn: boolean, frame: number): number => {
      const t = Math.min(1, Math.max(0, (frame - 61) / 29));
      return Math.fround(fadeIn ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2));
    };
    // Envelope value just before time t (the ramp's end within a frame).
    const at = (seg: typeof sa, t: number): number => {
      const pts = seg.gain;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (t > a.t - 1e-12 && t <= b.t + 1e-12 && b.t > a.t) return a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
      }
      return Number.NaN;
    };
    // Timeline frame f ends at f/30 s and ramps up to gain(f).
    for (const f of [61, 62, 75, 89, 90]) {
      expect(at(sa, f / 30)).toBeCloseTo(g(false, f), 6);
      expect(at(sb, f / 30 - 2)).toBeCloseTo(g(true, f), 6);
    }
    expect(at(sa, 2)).toBe(1);
    expect(at(sb, 0)).toBe(0);
  });

  it("turns a constant-speed time curve into one segment at that rate", () => {
    const [s] = planAudio(project([clip("a", { time: kf([1, 1], [61, 121]) })])).segments;
    expect(s).toMatchObject({ rate: 2, sourceStart: 0, timelineStart: 0 });
    expect(s!.duration).toBeCloseTo(2, 12);
  });

  it("plays a decreasing time curve backwards from the end of its first frame", () => {
    const [s] = planAudio(project([clip("a", { time: kf([1, 60], [60, 1]) })])).segments;
    expect(s).toMatchObject({ rate: -1, sourceStart: 2 });
  });

  it("evaluates audio effects and splits segments where parameters change", () => {
    const delay = { id: "d", type: "Delay", class_name: "Delay", delay_time: kf([1, 0.5]) };
    const [s] = planAudio(project([clip("a", { effects: [delay] })])).segments;
    expect(s!.effects).toHaveLength(1);
    expect(s!.effects[0]).toMatchObject({ id: "d", type: "Delay", frame: 1, params: { delay_time: 0.5 } });

    const animated = { id: "e", type: "Echo", class_name: "Echo", echo_time: kf([1, 0.1], [31, 0.4]) };
    const segs = planAudio(project([clip("a", { effects: [animated] })])).segments;
    expect(segs.length).toBe(31);
    expect(segs[0]!.effects[0]!.params.echo_time).toBeCloseTo(0.1, 12);
    expect(segs[30]!.effects[0]!.params.echo_time).toBeCloseTo(0.4, 12);
    expect(segs[30]!.duration).toBeCloseTo(1, 12);
  });

  it("covers only the frames overlapping the requested range", () => {
    const plan = planAudio(project([clip("a", { end: 5 })]), { start: 1, end: 2 });
    expect(plan).toMatchObject({ start: 1, end: 2 });
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]).toMatchObject({ timelineStart: 1, sourceStart: 1 });
    expect(plan.segments[0]!.duration).toBeCloseTo(1, 12);
  });

  it("reports channel filter and mapping", () => {
    const [s] = planAudio(project([clip("a", { channel_filter: kf([1, 0]), channel_mapping: kf([1, 1]) })])).segments;
    expect(s).toMatchObject({ channelFilter: 0, channelMapping: 1 });
  });
});
