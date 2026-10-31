import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../history/document.js";
import { addClip } from "../../ops/clips.js";
import { listProjectMotionTransitions, motionRecords } from "../../ops/motion-transitions.js";
import { patchClip } from "../../ops/internal.js";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import { Interpolation } from "../../model/types.js";
import { makeDoc } from "../../ops/testkit.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";

type Data = Record<string, unknown>;
const dataOf = (result: { data?: unknown }): Data => (result.data as { data: Data }).data;
const summaryOf = (result: { data?: unknown }): string => (result.data as { summary: string }).summary;

/** Four 2 s clips back to back on track 1, and a fifth after a gap. */
function editDoc(): ProjectDocument {
  const doc = makeDoc();
  doc.transaction("clips", (tx) => {
    for (let i = 0; i < 4; i += 1) addClip(tx, { fileId: "VIDEO00001", position: 2 * i, layer: 1, start: 2 * i, end: 2 * i + 2, id: `CLIP${i}` });
    addClip(tx, { fileId: "VIDEO00001", position: 9, layer: 1, start: 0, end: 2, id: "LATE" });
  });
  doc.clearHistory();
  return doc;
}

const call = (doc: ProjectDocument, name: string, args: Record<string, unknown>) => runTool({ doc, host: fakeHost() }, name, args);

describe("motion transition tools", () => {
  it("lists presets with lengths at the project frame rate", async () => {
    const doc = editDoc();
    const result = await call(doc, "list_motion_transitions_tool", {});
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { presets: { preset: string; default_frames: number }[]; styles: Record<string, string[]>; on_timeline: unknown[] };
    expect(data.presets.find((p) => p.preset === "whip")?.default_frames).toBe(8);
    expect(Object.keys(data.styles)).toEqual(["hype", "cinematic", "sport", "flash", "brand", "editorial", "punch", "travel", "gentle"]);
    expect(data.on_timeline).toEqual([]);
    expect(doc.undoLabels).toEqual([]);
  });

  it("applies one transition with string arguments, as one undo step with sfx cues", async () => {
    const doc = editDoc();
    const result = await call(doc, "apply_motion_transition_tool", { preset: "zoom_in", clip1_id: "CLIP0", duration: "0.3", intensity: "1.2" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Motion transition zoom_in"]);
    const data = dataOf(result) as { transition_id: string; frames: number; clips: { clip_id: string; effect_ids: string[] }[]; sfx_cues: { kind: string; time: number }[] };
    expect(data.frames).toBe(10);
    expect(data.clips.map((c) => c.clip_id)).toEqual(["CLIP0", "CLIP1"]);
    expect(data.clips[0]!.effect_ids.length).toBe(1);
    expect(data.sfx_cues.map((c) => c.kind)).toEqual(["whoosh", "hit"]);
    expect(data.sfx_cues[1]!.time).toBe(2);
    const listed = dataOf(await call(doc, "list_motion_transitions_tool", {})) as { on_timeline: { transition_id: string }[] };
    expect(listed.on_timeline.map((t) => t.transition_id)).toEqual([data.transition_id]);
  });

  it("names the clips in its summary as people know them (the ids stay in data)", async () => {
    const doc = editDoc();
    doc.transaction("titles", (tx) => {
      tx.project.clips.find((c) => c.id === "CLIP0")!.title = "beach.mp4";
    });
    const result = await call(doc, "apply_motion_transition_tool", { preset: "whip", clip1_id: "CLIP0" });
    expect(summaryOf(result)).toMatch(/between beach\.mp4 and \S+\.$/);
    expect(summaryOf(result)).not.toContain("CLIP");
  });

  it("finds the cut from a track and a time", async () => {
    const doc = editDoc();
    const result = await call(doc, "apply_motion_transition_tool", { preset: "whip", track: "1", time: "4.1", direction: "up" });
    expect(result.ok, result.text).toBe(true);
    expect((dataOf(result) as { clips: { clip_id: string }[] }).clips.map((c) => c.clip_id)).toEqual(["CLIP1", "CLIP2"]);
  });

  it("refuses bad cuts without an undo step", async () => {
    const doc = editDoc();
    for (const args of [
      { preset: "whip", clip1_id: "CLIP3", clip2_id: "LATE" },
      { preset: "whip", clip1_id: "LATE" },
      { preset: "whip", track: "1", time: "8.5" },
      { preset: "spin", clip1_id: "CLIP0", direction: "left" },
      { preset: "whip", clip1_id: "NOPE" },
      { preset: "whip" },
    ]) {
      const result = await call(doc, "apply_motion_transition_tool", args);
      expect(result.ok, JSON.stringify(args)).toBe(false);
      expect(summaryOf(result)).toMatch(/^Error/);
    }
    expect(doc.undoLabels).toEqual([]);
  });

  it("refuses a duration past the frame limit in seconds, at the project's rate", async () => {
    const doc = editDoc();
    doc.project.fps = { num: 60, den: 1 };
    for (const [name, target] of [["apply_motion_transition_tool", { clip1_id: "CLIP0" }], ["apply_motion_transitions_tool", { track: "1" }]] as const) {
      const result = await call(doc, name, { preset: "whip", ...target, duration: "4" });
      expect(result.ok).toBe(false);
      expect(summaryOf(result)).toBe("Error: duration 4s is 240 frames at 60 fps; the most is 2s");
    }
    expect(doc.undoLabels).toEqual([]);
  });

  it("transitions every cut on a track with a style mix, and removes them all", async () => {
    const doc = editDoc();
    const before = JSON.stringify(doc.project.clips);
    const result = await call(doc, "apply_motion_transitions_tool", { track: "1", style: "hype" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(1);
    const data = dataOf(result) as { transitions: { preset: string; cut: number }[]; sfx_cues: unknown[] };
    expect(data.transitions.map((t) => [t.preset, t.cut])).toEqual([
      ["whip", 2],
      ["whip", 4],
      ["zoom_out", 6],
    ]);
    expect(data.sfx_cues.length).toBe(4);
    const again = await call(doc, "apply_motion_transitions_tool", { track: "1", preset: "glitch" });
    expect((dataOf(again) as { transitions: { replaced?: string }[] }).transitions.every((t) => t.replaced)).toBe(true);
    const removed = await call(doc, "remove_motion_transition_tool", { track: "1" });
    expect(removed.ok, removed.text).toBe(true);
    expect(JSON.stringify(doc.project.clips)).toBe(before);
    expect(doc.undoLabels).toHaveLength(3);
    const nothing = await call(doc, "remove_motion_transition_tool", { clip_id: "CLIP1" });
    expect(summaryOf(nothing)).toMatch(/nothing to remove/);
    expect(doc.undoLabels).toHaveLength(3);
  });

  it("varies the moves by style, leaving most cuts hard, and warns on one preset everywhere", async () => {
    const long = (): ProjectDocument => {
      const doc = makeDoc();
      doc.transaction("clips", (tx) => {
        for (let i = 0; i < 9; i += 1) addClip(tx, { fileId: "VIDEO00001", position: i, layer: 1, start: 0, end: 1, id: `SHOT${i}` });
      });
      doc.clearHistory();
      return doc;
    };
    const brand = long();
    const result = await call(brand, "apply_motion_transitions_tool", { track: "1", style: "brand" });
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { transitions: { preset: string; cut: number }[]; hard_cuts: number };
    expect(data.transitions.map((t) => [t.preset, t.cut])).toEqual([
      ["slide", 3],
      ["blur_dissolve", 6],
      ["zoom_through", 8],
    ]);
    expect(data.hard_cuts).toBe(5);
    expect(summaryOf(result)).toMatch(/5 cut\(s\) stay hard/);

    const auto = long();
    const fallback = await call(auto, "apply_motion_transitions_tool", { track: "1", focus_x: 0.2, focus_y: 0.3 });
    expect(fallback.ok, fallback.text).toBe(true);
    expect(summaryOf(fallback)).toMatch(/cinematic, from the brief's style \(none saved\)/);
    const last = listProjectMotionTransitions(auto.project).find((r) => r.preset === "zoom_through")!;
    const out = auto.project.clips.find((c) => c.id === last.outClipId)!;
    // Flying into (0.2, 0.3): the picture moves right and down as it scales, keeping that point still.
    const lx = (out as unknown as { location_x: { Points: { co: { Y: number } }[] } }).location_x.Points.map((p) => p.co.Y);
    expect(Math.max(...lx)).toBeGreaterThan(0);

    const same = long();
    const whips = await call(same, "apply_motion_transitions_tool", { track: "1", preset: "whip" });
    expect(whips.ok, whips.text).toBe(true);
    expect(JSON.stringify(whips.data)).toMatch(/whip on all 8 cuts reads as a template/);
  });

  it("keeps whips and slides on the current after a mix's camera tilt (no flip to the reserved up)", async () => {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      for (let i = 0; i < 18; i += 1) addClip(tx, { fileId: "VIDEO00001", position: i, layer: 1, start: 0, end: 1, id: `SHOT${i}` });
    });
    doc.clearHistory();
    const result = await call(doc, "apply_motion_transitions_tool", { track: "1", style: "sport" });
    expect(result.ok, result.text).toBe(true);
    const records = listProjectMotionTransitions(doc.project);
    const whips = records.filter((r) => r.preset === "whip");
    expect(whips.length).toBeGreaterThanOrEqual(2);
    expect(whips.map((r) => r.direction)).toEqual(whips.map(() => "left"));
    expect(records.filter((r) => r.preset === "tilt").every((r) => r.direction === "up")).toBe(true);
  });

  it("drifts a dissolve's clips from their own framing, not from 1", async () => {
    const doc = editDoc();
    doc.transaction("frame", (tx) => {
      patchClip(tx, "CLIP0", { scale_x: { Points: [makeKeyframePoint(1, 1.5, Interpolation.BEZIER)] }, scale_y: { Points: [makeKeyframePoint(1, 1.2, Interpolation.BEZIER)] } });
    });
    doc.clearHistory();
    const result = await call(doc, "apply_matched_dissolve_tool", { clip1_id: "CLIP0", duration: 0.5, speed: 0.04 });
    expect(result.ok, result.text).toBe(true);
    const clip = doc.project.clips.find((c) => c.id === "CLIP0") as unknown as Record<"scale_x" | "scale_y", { Points: { co: { X: number; Y: number } }[] }>;
    expect(clip.scale_x.Points[0]!.co.Y).toBeCloseTo(1.5, 6);
    expect(clip.scale_y.Points[0]!.co.Y).toBeCloseTo(1.2, 6);
    expect(clip.scale_x.Points[1]!.co.Y).toBeGreaterThan(1.5);
    // The last key sits on the clip's last frame (2 s at 30 fps from source start 0), not one past it.
    expect(clip.scale_x.Points[1]!.co.X).toBe(60);
  });

  it("dissolves with both shots pushing in at one speed, in one undo step", async () => {
    const doc = editDoc();
    const result = await call(doc, "apply_matched_dissolve_tool", { clip1_id: "CLIP0", duration: 0.5, speed: 0.04 });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Motion-matched dissolve"]);
    expect((dataOf(result) as { transition_id: string }).transition_id).toBeTruthy();
    const slope = (id: string) => {
      const pts = (doc.project.clips.find((c) => c.id === id) as unknown as { scale_x: { Points: { co: { X: number; Y: number } }[] } }).scale_x.Points;
      return (pts[1]!.co.Y - pts[0]!.co.Y) / ((pts[1]!.co.X - pts[0]!.co.X) / 30);
    };
    // Same velocity on both sides of the blend: the move reads as one.
    expect(slope("CLIP0")).toBeCloseTo(0.04, 2);
    expect(slope("CLIP1")).toBeCloseTo(0.04, 2);
    const again = await call(doc, "apply_matched_dissolve_tool", { clip1_id: "LATE" });
    expect(again.ok).toBe(false);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("finds the cut from the time alone", async () => {
    const doc = editDoc();
    const result = await call(doc, "apply_motion_transition_tool", { preset: "tilt", time: 4.2 });
    expect(result.ok, result.text).toBe(true);
    expect((dataOf(result) as { cut: number; preset: string }).cut).toBe(4);
    expect(summaryOf(result)).toMatch(/^Added tilt up on the cut at 4\.00s/);
    const none = await call(doc, "apply_motion_transition_tool", { preset: "whip", time: 8.5 });
    expect(none.text).toMatch(/no scene change within 0\.5 s of 8\.50s/);
  });

  it("moves a scene's whole stack when the cut is found from the time alone", async () => {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1, start: 0, end: 2, id: "BG1" });
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 2, start: 0, end: 2, id: "HEAD1" });
      addClip(tx, { fileId: "VIDEO00001", position: 2, layer: 3, start: 0, end: 2, id: "CARDS" });
    });
    doc.clearHistory();
    const result = await call(doc, "apply_motion_transition_tool", { preset: "whip", time: 2.1 });
    expect(result.ok, result.text).toBe(true);
    const roles = (dataOf(result) as { clips: { clip_id: string; role: string }[] }).clips.map((c) => `${c.clip_id}:${c.role}`);
    expect(roles.sort()).toEqual(["BG1:out", "CARDS:in", "HEAD1:out"]);
  });

  it("says which track has the cuts when the named one has none", async () => {
    // Agents pass track 1 after build_reel_tool, which puts the music there and the shots on track 2.
    const doc = editDoc();
    const result = await call(doc, "apply_motion_transitions_tool", { track: "2", style: "hype" });
    expect(summaryOf(result)).toMatch(/^No cuts on .*: no clips play back to back there\. Cuts are on track 1 \(3 cuts\): pass track="1"\.$/);
    // One cut by track and time, on a track of lone clips (a montage's flash frames): the same pointer.
    const one = await call(doc, "apply_motion_transition_tool", { preset: "flash_invert", track: "2", time: 2 });
    expect(summaryOf(one)).toMatch(/^Error: no cuts on .*: no clips play back to back there\. Cuts are on track 1 \(3 cuts\): pass track="1"\.$/);
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("transitions scene changes across tracks: each scene's stack moves as one, what spans the cut stays put", async () => {
    // A SaaS promo's layout (bench round 5): scene 1 = background + headline on tracks 1-2, scene 2 = glass cards on track 3,
    // scene 3 back on tracks 1-2; a logo bug over everything and a 2-frame flash over the second cut.
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      const clip = (id: string, layer: number, position: number, length: number, fileId = "VIDEO00001") => addClip(tx, { fileId, position, layer, start: 0, end: length, id });
      clip("BG1", 1, 0, 2);
      clip("HEAD1", 2, 0, 2);
      clip("CARDS", 3, 2, 2);
      clip("BG3", 1, 4, 2);
      clip("HEAD3", 2, 4, 2);
      clip("LOGO", 5, 0, 6, "IMAGE00001");
      clip("FLASH", 4, 4, 2 / 30, "IMAGE00001");
    });
    doc.clearHistory();
    const before = JSON.stringify(doc.project.clips);
    const onTrack = await call(doc, "apply_motion_transitions_tool", { track: "1", preset: "whip" });
    expect(summaryOf(onTrack)).toMatch(/2 scene changes cross tracks: omit track/);
    const result = await call(doc, "apply_motion_transitions_tool", { style: "hype", direction: "left" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(1);
    const data = dataOf(result) as { track: string; transitions: { cut: number; clips: { clip_id: string; role: string }[] }[] };
    expect(data.track).toBe("all");
    expect(data.transitions.map((t) => [t.cut, t.clips.map((c) => `${c.clip_id}:${c.role}`)])).toEqual([
      [2, ["BG1:out", "CARDS:in", "HEAD1:out"]],
      [4, ["CARDS:out", "BG3:in", "HEAD3:in"]],
    ]);
    const clip = (id: string) => doc.project.clips.find((c) => c.id === id)!;
    expect(motionRecords(clip("HEAD1"))[0]).toMatchObject({ role: "out", follows: "BG1", partner: "CARDS" });
    expect(clip("HEAD1").location_x).toEqual(clip("BG1").location_x);
    expect(motionRecords(clip("LOGO"))).toEqual([]);
    expect(motionRecords(clip("FLASH"))).toEqual([]);
    // One record per transition for lists and sound design; followers come off with it.
    expect(listProjectMotionTransitions(doc.project)).toHaveLength(2);
    const removed = await call(doc, "remove_motion_transition_tool", { clip_id: "CARDS" });
    expect(removed.ok, removed.text).toBe(true);
    expect(JSON.stringify(doc.project.clips)).toBe(before);
  });

  it("replacing a scene transition releases the clips that no longer move with it", async () => {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1, start: 0, end: 2, id: "A" });
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 2, start: 0, end: 2, id: "A2" });
      addClip(tx, { fileId: "VIDEO00001", position: 2, layer: 3, start: 0, end: 2, id: "B" });
    });
    doc.clearHistory();
    const plain = JSON.stringify(doc.project.clips.find((c) => c.id === "A2"));
    expect((await call(doc, "apply_motion_transitions_tool", { preset: "whip" })).ok).toBe(true);
    expect(motionRecords(doc.project.clips.find((c) => c.id === "A2")!)).toHaveLength(1);
    // By clip ids across tracks: just the two clips this time.
    const again = await call(doc, "apply_motion_transition_tool", { preset: "glitch", clip1_id: "A", clip2_id: "B" });
    expect(again.ok, again.text).toBe(true);
    expect(JSON.stringify(doc.project.clips.find((c) => c.id === "A2"))).toBe(plain);
    expect(listProjectMotionTransitions(doc.project).map((r) => r.preset)).toEqual(["glitch"]);
  });

  it("refuses a cross-track transition onto a clip on a locked track, adding no undo step", async () => {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1, start: 0, end: 2, id: "A" });
      addClip(tx, { fileId: "VIDEO00001", position: 2, layer: 3, start: 0, end: 2, id: "B" });
    });
    doc.transaction("lock", (tx) => tx.update(["layers", { number: 3 }], { lock: true }));
    doc.clearHistory();
    const before = JSON.stringify(doc.project.clips);
    const result = await call(doc, "apply_motion_transition_tool", { preset: "whip", clip1_id: "A", clip2_id: "B" });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/locked/);
    expect(JSON.stringify(doc.project.clips)).toBe(before);
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("removes one transition by id and refuses unknown ids", async () => {
    const doc = editDoc();
    const before = JSON.stringify(doc.project.clips);
    const r = dataOf(await call(doc, "apply_motion_transition_tool", { preset: "flash_white", clip1_id: "CLIP2" })) as { transition_id: string };
    const removed = await call(doc, "remove_motion_transition_tool", { transition_id: r.transition_id });
    expect(removed.ok, removed.text).toBe(true);
    expect(JSON.stringify(doc.project.clips)).toBe(before);
    const unknown = await call(doc, "remove_motion_transition_tool", { transition_id: r.transition_id });
    expect(summaryOf(unknown)).toMatch(/^Error: no motion transition/);
    expect(doc.undoLabels).toHaveLength(2);
  });
});

describe("flash transitions stay within 3 flashes a second (WCAG 2.3.1)", () => {
  /** Twelve quarter-second shots back to back: a flash on every cut is 4 a second. */
  function fastDoc(): ProjectDocument {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      for (let i = 0; i < 12; i += 1) addClip(tx, { fileId: "VIDEO00001", position: 0.25 * i, layer: 1, start: 0.25 * i, end: 0.25 * i + 0.25, id: `FAST${String(i).padStart(2, "0")}` });
    });
    doc.clearHistory();
    return doc;
  }
  const flashCuts = (doc: ProjectDocument): number[] => listProjectMotionTransitions(doc.project).filter((r) => r.preset === "flash_white").map((r) => r.cut);

  it("leaves off the flashes past the limit, with a warning, in one undo step", async () => {
    const doc = fastDoc();
    const result = await call(doc, "apply_motion_transitions_tool", { track: "1", preset: "flash_white", duration: "0.1" });
    expect(result.ok, result.text).toBe(true);
    const cuts = flashCuts(doc);
    expect(cuts.length).toBeGreaterThan(3);
    expect(cuts.length).toBeLessThan(11);
    for (const t of cuts) expect(cuts.filter((c) => c >= t && c < t + 1 - 1e-6).length).toBeLessThanOrEqual(3);
    expect((result.data as { warnings: string[] }).warnings.join(" ")).toMatch(/flash\(es\) left off.*WCAG 2\.3\.1.*allow_strobe=true/);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("counts a flash already on a cut it may leave as it was before thinning the earlier cuts", async () => {
    const doc = fastDoc();
    expect((await call(doc, "apply_motion_transition_tool", { preset: "flash_white", clip1_id: "FAST03", duration: "0.1" })).ok).toBe(true);
    const result = await call(doc, "apply_motion_transitions_tool", { track: "1", preset: "flash_white", duration: "0.1" });
    expect(result.ok, result.text).toBe(true);
    const cuts = flashCuts(doc);
    expect(cuts.some((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
    for (const t of cuts) expect(cuts.filter((c) => c >= t && c < t + 1 - 1e-6).length).toBeLessThanOrEqual(3);
  });

  it("keeps every flash with allow_strobe", async () => {
    const doc = fastDoc();
    const result = await call(doc, "apply_motion_transitions_tool", { track: "1", preset: "flash_white", duration: "0.1", allow_strobe: "true" });
    expect(result.ok, result.text).toBe(true);
    expect(flashCuts(doc)).toHaveLength(11);
  });

  it("refuses one more flash where three are already in the second, with no undo step", async () => {
    const doc = fastDoc();
    for (const id of ["FAST00", "FAST01", "FAST02"]) expect((await call(doc, "apply_motion_transition_tool", { preset: "flash_white", clip1_id: id, duration: "0.1" })).ok).toBe(true);
    const steps = doc.undoLabels.length;
    const fourth = await call(doc, "apply_motion_transition_tool", { preset: "flash_white", clip1_id: "FAST03", duration: "0.1" });
    expect(fourth.data?.status).toBe("refused");
    expect(summaryOf(fourth)).toMatch(/more than 3 flashes within a second/);
    expect(doc.undoLabels).toHaveLength(steps);
    // A move is fine there, and so is the flash a second later.
    expect((await call(doc, "apply_motion_transition_tool", { preset: "zoom_in", clip1_id: "FAST03", duration: "0.1" })).ok).toBe(true);
    expect((await call(doc, "apply_motion_transition_tool", { preset: "flash_white", clip1_id: "FAST07", duration: "0.1" })).ok).toBe(true);
  });
});
