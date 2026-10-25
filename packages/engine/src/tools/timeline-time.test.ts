/**
 * Timeline-edit timing and sound tools: speed, repeat, freeze, separate
 * audio, audio/video on-off, and reverse_clip_tool. Ported from zenvi-core
 * develop tests/test_editor_tools_timeline_edit_time.py and
 * tests/test_tool_handlers_reverse_clip.py; here the tools run the engine's
 * own Clip menu edits, so the cases check the resulting clips.
 */

import { describe, expect, it } from "vitest";
import { timeCurveIsReversed } from "../ops/retime.js";
import { EditHarness } from "./test-support/edit-harness.js";

const T1 = 1_000_000;
const T2 = 2_000_000;
const T3 = 3_000_000;

type Row = Record<string, unknown>;

/** Two clips of d seconds on track 2 from one 20 s video with stereo sound, `gap` apart. */
function two(ed: EditHarness, d = 6, gap = 0): [string, string] {
  const f = ed.addFile("video", { duration: 20, hasAudio: true, channels: 2 });
  return [ed.addClip(f, { position: 0, end: d, layer: T2 }), ed.addClip(f, { position: d + gap, end: d, layer: T2 })];
}

function y(kf: unknown): number {
  return (kf as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y;
}

describe("set_clip_speed_tool", () => {
  it("speeds a clip up 2x; undo and redo", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    const r = await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 2 });
    expect(ed.dur(a)).toBe(3);
    expect((r.clips as Row[])[0]).toMatchObject({ duration_before: 6, duration_after: 3, effective_speed: 2, direction: "forward" });
    expect((await ed.call("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 2 })).summary).toBe(
      "Retimed 1 clip(s): 3.00 s -> 1.50 s, now 4.0x forward.",
    );
    ed.doc.undo();
    ed.doc.undo();
    expect(ed.dur(a)).toBe(6);
    ed.doc.redo();
    expect(ed.dur(a)).toBe(3);
  });

  it("refuses slow motion that runs into the next clip unless rippled or allowed", async () => {
    const ed = new EditHarness();
    const [a, b] = two(ed);
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 0.5 }, "would overlap", "ripple=true");
    const r = await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 0.5, ripple: true });
    expect([ed.dur(a), ed.pos(b)]).toEqual([12, 12]);
    expect(r.shifted).toEqual([b]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([ed.dur(a), ed.pos(b)]).toEqual([6, 6]);
  });

  it("reports the overlap with allow_overlap", async () => {
    const ed = new EditHarness();
    const [a, b] = two(ed);
    const r = await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 0.5, allow_overlap: true });
    expect((r.overlaps as Row[])[0]!.overlaps).toBe(b);
    expect(ed.pos(b)).toBe(6);
  });

  it("reverses, and reverses at a speed", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    const r = await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], reverse: true });
    expect((r.clips as Row[])[0]!.direction).toBe("backward");
    expect(timeCurveIsReversed(ed.clip(a)!.time)).toBe(true);
    await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 3, reverse: true });
    expect(ed.dur(a)).toBe(2);
    // Reversing a reversed clip at a speed plays it forward again (Time ▸ Backward flips the curve).
    expect(timeCurveIsReversed(ed.clip(a)!.time)).toBe(false);
  });

  it("retimes to an exact length, and back to normal speed with absolute", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], target_duration_seconds: 4 });
    expect(ed.dur(a)).toBe(4);
    const r = await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 1, absolute: true, ripple: true });
    expect(ed.dur(a)).toBe(6);
    expect(Math.abs(((r.clips as Row[])[0]!.effective_speed as number) - 1)).toBeLessThan(0.01);
  });

  it("needs reset=true for a looped clip", async () => {
    const ed = new EditHarness();
    const [a] = two(ed, 6, 30);
    await ed.receipt("repeat_clip_tool", { timeline_clip_ids: [a], times: 2 });
    ed.mark();
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 2 }, "looped", "reset=true");
    await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 2, reset: true, allow_overlap: true });
    expect(ed.clip(a)!.repeat_cache).toBeUndefined();
    // Reset: in point to the end of the 20 s source, then 2x.
    expect(ed.dur(a)).toBe(10);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("refuses bad requests", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    await ed.refused("set_clip_speed_tool", { speed: 2 }, "say which clips");
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a] }, "nothing to change");
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 2, target_duration_seconds: 3 }, "not both");
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], absolute: true, reverse: true }, "needs a speed");
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 1 }, "already plays");
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], target_duration_seconds: 0.1 }, "1/16x to 16x");
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 40 }, "maximum of 16");
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], speed: "fast" }, "speed");
    ed.lockTrack(T2);
    await ed.refused("set_clip_speed_tool", { timeline_clip_ids: [a], speed: 2 }, "track 2 is locked");
  });

  it("coerces string arguments like the desktop's registry", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    const r = await ed.receipt("set_clip_speed_tool", { timeline_clip_ids: JSON.stringify([a]), speed: "2", reverse: "true" });
    expect((r.clips as Row[])[0]).toMatchObject({ duration_after: 3, direction: "backward" });
  });

  it("still takes the web's older clip_id, factor and direction", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    const receipt = await ed.call("set_clip_speed_tool", { clip_id: a, factor: "2", direction: "backward" });
    expect(receipt.summary).toBe("Retimed 1 clip(s) (reversed): 6.00 s -> 3.00 s, now 2.0x backward.");
    expect(receipt.undoSteps).toBe(1);
    ed.mark();
    await ed.refused("set_clip_speed_tool", { clip_id: a, factor: 2, speed: 3 }, "not both");
  });
});

describe("repeat_clip_tool", () => {
  it("loops three times; undo; repeats again after the undo", async () => {
    const ed = new EditHarness();
    const [a] = two(ed, 2, 10);
    const r = await ed.receipt("repeat_clip_tool", { timeline_clip_ids: [a], times: "3" });
    expect(ed.dur(a)).toBe(6);
    expect((r.clips as Row[])[0]!.direction).toBe("looped");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.dur(a)).toBe(2);
    ed.mark();
    await ed.receipt("repeat_clip_tool", { timeline_clip_ids: [a], times: 2 });
    expect(ed.dur(a)).toBe(4);
  });

  it("ping-pongs backwards with a pause and a speed ramp", async () => {
    const ed = new EditHarness();
    const [a] = two(ed, 2, 20);
    await ed.receipt("repeat_clip_tool", {
      timeline_clip_ids: [a],
      times: 2,
      pattern: "PING_PONG",
      reverse: true,
      delay_seconds: "0.5",
      speed_ramp_percent: 100,
    });
    // 2 s + 1 s (twice as fast) + 0.5 s pause
    expect(ed.dur(a)).toBe(3.5);
  });

  it("refuses to run into the next clip unless rippled; an already looped clip", async () => {
    const ed = new EditHarness();
    const [a, b] = two(ed, 2);
    await ed.refused("repeat_clip_tool", { timeline_clip_ids: [a], times: 4 }, "would overlap");
    await ed.refused("repeat_clip_tool", { timeline_clip_ids: [a], times: 1 }, "minimum of 2");
    await ed.receipt("repeat_clip_tool", { timeline_clip_ids: [a], times: 4, ripple: true });
    expect(ed.pos(b)).toBe(8);
    ed.mark();
    await ed.refused("repeat_clip_tool", { timeline_clip_ids: [a], times: 2, ripple: true }, "already looped");
  });
});

describe("freeze_frame_tool", () => {
  it("holds the last frame", async () => {
    const ed = new EditHarness();
    const [a] = two(ed, 6, 10);
    const r = await ed.receipt("freeze_frame_tool", { timeline_clip_id: a, frame: "last", hold_seconds: 2 });
    expect(Math.abs((r.frozen_at as number) - (6 - 1 / 30))).toBeLessThan(1e-3);
    expect(ed.dur(a)).toBe(8);
    expect((r.clip as Row).duration_after).toBe(8);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.dur(a)).toBe(6);
  });

  it("freezes a time with zoom and ripple", async () => {
    const ed = new EditHarness();
    const [a, b] = two(ed);
    const r = await ed.receipt("freeze_frame_tool", { timeline_clip_id: a, at_seconds: "2.5s", hold_seconds: 1, zoom: true, ripple: true });
    expect(r.frozen_at).toBe(2.5);
    expect(ed.pos(b)).toBe(7);
    expect(ed.clip(a)!.scale_x.Points.some((p) => p.co.Y > 1.04)).toBe(true);
  });

  it("uses the clip start for frame='first' and the playhead by default", async () => {
    const ed = new EditHarness();
    const [a] = two(ed, 6, 10);
    await ed.call("move_clips_tool", { timeline_clip_ids: [a], position_seconds: 1 });
    expect((await ed.receipt("freeze_frame_tool", { timeline_clip_id: a, frame: "first" })).frozen_at).toBe(1);
    ed.host.player!.seek(3);
    expect((await ed.receipt("freeze_frame_tool", { timeline_clip_id: a })).frozen_at).toBe(3);
  });

  it("refuses bad requests", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    await ed.refused("freeze_frame_tool", { timeline_clip_id: a, at_seconds: 9 }, "outside");
    await ed.refused("freeze_frame_tool", { timeline_clip_id: a, frame: "last" }, "would overlap");
    await ed.refused("freeze_frame_tool", { timeline_clip_id: "nope", frame: "last" }, "No timeline clip");
    ed.lockTrack(T2);
    await ed.refused("freeze_frame_tool", { timeline_clip_id: a, frame: "first", ripple: true }, "locked");
  });
});

describe("separate_clip_audio_tool", () => {
  it("puts the sound on the track below and mutes the original; undo", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 8, hasAudio: true, channels: 2 });
    const a = ed.addClip(f, { position: 1, end: 8, layer: T2 });
    const r = await ed.receipt("separate_clip_audio_tool", { timeline_clip_ids: [a] });
    const created = (r.audio_clips as Row[])[0]!;
    expect(created).toMatchObject({ track: 1, video: "off", position: 1 });
    expect((r.originals as Row[])[0]!.audio).toBe("off");
    expect(y(ed.clip(a)!.has_audio)).toBe(0);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.doc.project.clips).toHaveLength(1);
  });

  it("puts the sound on a chosen track", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 8, hasAudio: true, channels: 2 });
    const a = ed.addClip(f, { position: 0, end: 8, layer: T2 });
    const tracks = ed.doc.project.layers.length;
    const r = await ed.receipt("separate_clip_audio_tool", { timeline_clip_ids: [a], to_track: "3" });
    expect((r.audio_clips as Row[])[0]!.track).toBe(3);
    expect(ed.doc.project.layers).toHaveLength(tracks);
  });

  it("refuses clips without sound, audio-only clips, covered or locked destinations, and a second separation", async () => {
    const ed = new EditHarness();
    const silent = ed.addFile("video", { duration: 8 });
    const s = ed.addClip(silent, { position: 0, end: 8, layer: T2 });
    await ed.refused("separate_clip_audio_tool", { timeline_clip_ids: [s] }, "no audio");
    const song = ed.addFile("audio");
    const m = ed.addClip(song, { position: 0, end: 5, layer: T3 });
    await ed.refused("separate_clip_audio_tool", { timeline_clip_ids: [m] }, "already audio-only");
    const f = ed.addFile("video", { duration: 8, hasAudio: true, channels: 2 });
    const v = ed.addClip(f, { position: 20, end: 8, layer: T2 });
    ed.addClip(f, { position: 22, end: 2, layer: T1 });
    await ed.refused("separate_clip_audio_tool", { timeline_clip_ids: [v] }, "would overlap", "allow_overlap");
    ed.lockTrack(T1);
    await ed.refused("separate_clip_audio_tool", { timeline_clip_ids: [v] }, "track 1 is locked (where the audio would go)");
    ed.lockTrack(T1, false);
    await ed.receipt("separate_clip_audio_tool", { timeline_clip_ids: [v], allow_overlap: true });
    ed.mark();
    await ed.refused("separate_clip_audio_tool", { timeline_clip_ids: [v], allow_overlap: true }, "already has its audio off");
  });

  it("splits a video clip's channels onto the tracks below", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 8, hasAudio: true, channels: 2 });
    const v = ed.addClip(f, { position: 0, end: 8, layer: T3 });
    const r = await ed.receipt("separate_clip_audio_tool", { timeline_clip_ids: [v], per_channel: "true" });
    expect((r.audio_clips as Row[]).map((c) => [c.track, c.video]).sort()).toEqual([
      [1, "off"],
      [2, "off"],
    ]);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("splits an audio-only clip per channel", async () => {
    const ed = new EditHarness();
    const song = ed.addFile("audio");
    const m = ed.addClip(song, { position: 0, end: 5, layer: T3 });
    const r = await ed.receipt("separate_clip_audio_tool", { timeline_clip_ids: [m], per_channel: true });
    // Channel 1 stays on the clip; channel 2 is a new clip on the track below.
    expect((r.audio_clips as Row[]).map((c) => c.track)).toEqual([2]);
    expect(y(ed.clip(m)!.channel_filter)).toBe(0);
    ed.mark();
    await ed.refused("separate_clip_audio_tool", { timeline_clip_ids: [m], per_channel: true, to_track: "1" }, "to_track works");
  });
});

describe("set_clip_audio_video_tool", () => {
  it("mutes and unmutes; an unchanged state adds no history", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    const r = await ed.receipt("set_clip_audio_video_tool", { timeline_clip_ids: [a], audio: "OFF" });
    expect(y(ed.clip(a)!.has_audio)).toBe(0);
    expect((r.clips as Row[])[0]!.audio).toBe("off");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(y(ed.clip(a)!.has_audio)).toBe(-1);
    ed.mark();
    const receipt = await ed.call("set_clip_audio_video_tool", { timeline_clip_ids: [a], audio: "auto" });
    expect(receipt.status).toBe("unchanged");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("makes a clip audio-only, and refuses what the media does not have", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    await ed.receipt("set_clip_audio_video_tool", { timeline_clip_ids: [a], video: "off" });
    expect(y(ed.clip(a)!.has_video)).toBe(0);
    const song = ed.addFile("audio");
    const m = ed.addClip(song, { position: 0, end: 5, layer: T3 });
    await ed.refused("set_clip_audio_video_tool", { timeline_clip_ids: [m], video: "on" }, "no picture");
    const silent = ed.addFile("video", { duration: 8 });
    const s = ed.addClip(silent, { position: 0, end: 4, layer: T1 });
    await ed.refused("set_clip_audio_video_tool", { timeline_clip_ids: [s], audio: "on" }, "no audio");
    await ed.refused("set_clip_audio_video_tool", { timeline_clip_ids: [s], waveform: "show" }, "no waveform");
    await ed.refused("set_clip_audio_video_tool", { timeline_clip_ids: [s] }, "nothing to change");
    ed.lockTrack(T3);
    await ed.refused("set_clip_audio_video_tool", { timeline_clip_ids: [m], audio: "off" }, "locked");
  });

  it("treats waveform show as done (the web always draws them) and refuses hide in words to retry without it", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    const shown = await ed.call("set_clip_audio_video_tool", { timeline_clip_ids: [a], waveform: "show" });
    expect(shown.status).toBe("unchanged");
    expect(shown.summary).toContain("already draws the waveform");
    const hidden = await ed.refused("set_clip_audio_video_tool", { timeline_clip_ids: [a], waveform: "hide", audio: "off" }, "Call it again without waveform");
    expect(hidden.summary).not.toContain("not available");
    expect(y(ed.clip(a)!.has_audio)).toBe(-1);
  });
});

describe("reverse_clip_tool", () => {
  it("needs a clip and a known mode before resolving anything", async () => {
    const ed = new EditHarness();
    two(ed);
    await ed.refused("reverse_clip_tool", {}, "requires timeline_clip_id or clip_query");
    await ed.refused("reverse_clip_tool", { timeline_clip_id: "x", mode: "warp" }, "mode must be");
  });

  it("reverses, refuses nothing-to-do calls without an undo step, and resets", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    const reversed = await ed.call("reverse_clip_tool", { timeline_clip_id: a });
    expect(reversed.summary).toBe(`Reversed timeline_clip_id=${a}.`);
    expect(timeCurveIsReversed(ed.clip(a)!.time)).toBe(true);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.mark();
    const again = await ed.call("reverse_clip_tool", { timeline_clip_id: a, mode: "reverse" });
    expect(again).toMatchObject({ status: "unchanged", summary: `timeline_clip_id=${a} is already reversed; nothing changed.` });
    expect(ed.stepsSinceMark()).toBe(0);
    const reset = await ed.call("reverse_clip_tool", { timeline_clip_id: a, mode: "Reset" });
    expect(reset.summary).toBe(`Reset time on timeline_clip_id=${a}.`);
    expect(ed.clip(a)!.time.Points).toHaveLength(1);
    ed.mark();
    const forward = await ed.call("reverse_clip_tool", { timeline_clip_id: a, mode: "reset" });
    expect(forward).toMatchObject({ status: "unchanged", summary: `timeline_clip_id=${a} already plays forward at 1x; nothing changed.` });
  });

  it("refuses a clip on a locked track", async () => {
    const ed = new EditHarness();
    const [a] = two(ed);
    ed.lockTrack(T2);
    await ed.refused("reverse_clip_tool", { timeline_clip_id: a }, "locked");
  });
});
