import { describe, expect, test } from "vitest";
import { loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";
import { TICKS_PER_SECOND } from "../testing/premiere-mock.js";

function register(fx: ReturnType<typeof loadPremiere>, name: string, body: string): void {
  fx.host.evaluate(`ZenviLink.register(${JSON.stringify(name)}, function (args, ctx) { ${body} }, {mutating: true});`);
}

describe("undo steps measured from Premiere's undo stack", () => {
  test("the stack's movement wins over the tool's own count", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    register(fx, "premiere_t_two_moves", `ctx.changed(); var clips = app.project.activeSequence.videoTracks[0].clips;
      clips[2].move(1); clips[1].move(0.5); clips[0].move(0.25); return ZenviLink.applied("moved", {}, 1);`);
    expect(fx.call("premiere_t_two_moves")).toMatchObject({ status: "applied", undoSteps: 3 });
    expect(edit.v.a.span.start).toBe(0.25);
  });

  test("without undoStackIndex the tool's count stands; a failure reports what the stack saw", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    fx.mock.state.qeUndoIndex = false;
    register(fx, "premiere_t_count", `ctx.changed(); app.project.activeSequence.videoTracks[0].clips[2].move(1); return ZenviLink.applied("moved", {}, 1);`);
    expect(fx.call("premiere_t_count").undoSteps).toBe(1);
    const fx2 = loadPremiere();
    standardEdit(fx2);
    register(fx2, "premiere_t_fail", `ctx.changed(); app.project.activeSequence.videoTracks[0].clips[2].move(1); throw new Error("half way");`);
    expect(fx2.call("premiere_t_fail")).toMatchObject({ status: "error", undoSteps: 1 });
  });

  test("no movement and no count is unknown (null)", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    register(fx, "premiere_t_none", `return ZenviLink.applied("did nothing undoable", {});`);
    expect(fx.call("premiere_t_none").undoSteps).toBeNull();
  });
});

describe("Premiere helpers", () => {
  test("timecodes follow the sequence display format and NTSC rates", () => {
    const fx = loadPremiere();
    const main = fx.mock.project.addSequence({ name: "Main", fps: 25 });
    main.videoDisplayFormat = 101;
    expect(fx.host.evaluate("ZenviLink.ppro.timecode(app.project.activeSequence, 61.2)")).toBe("00:01:01:05");
    const ntsc = fx.mock.project.addSequence({ name: "NTSC", fps: 29.97 });
    ntsc.videoDisplayFormat = 103;
    expect(fx.host.evaluate("ZenviLink.ppro.timecode(app.project.activeSequence, 1)")).toBe("00:00:01:00");
    expect(fx.host.evaluate("ZenviLink.ppro.fps(app.project.activeSequence)")).toBeCloseTo(29.97, 3);
  });

  test("paths join with the platform separator", () => {
    const mac = loadPremiere();
    expect(mac.host.evaluate('ZenviLink.ppro.join("/tmp/zenvi-link/", "frame")')).toBe("/tmp/zenvi-link/frame");
    const windows = loadPremiere({ os: "windows" });
    expect(windows.host.evaluate('ZenviLink.ppro.join("C:\\\\Temp\\\\zenvi-link", "frame")')).toBe("C:\\Temp\\zenvi-link\\frame");
  });

  test("the QE item for a clip is matched by start time, skipping gaps", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.v.a.remove(false, true);
    const name = fx.host.evaluate(`(function () { var P = ZenviLink.ppro; var seq = app.project.activeSequence;
      var found = P.findClip(${JSON.stringify(edit.v.c.nodeId)});
      var item = P.qeItem(P.qeTrack(P.qeSequence(seq, null), "video", 0), found.clip, Number(seq.timebase));
      return item.name + "@" + item.start.ticks; }())`);
    expect(name).toBe(`c.mov@${9 * TICKS_PER_SECOND}`);
  });

  test("linked clips: only same-source clips overlapping this one count", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const stray = edit.sequence.audioTrackList[2]?.addClip(edit.items.b, 0, 2);
    if (stray) stray.linkGroup = edit.v.b.linkGroup;
    const linked = fx.host.evaluate(`(function () { var P = ZenviLink.ppro; var found = P.findClip(${JSON.stringify(edit.v.b.nodeId)});
      return ZenviLink.map(P.linkedOf(found.clip), function (clip) { return clip.nodeId; }).join(","); }())`);
    expect(linked).toBe(edit.audio.b.nodeId);
  });

  test("findClip searches the active sequence, then every sequence; refuses unknown ids", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.project.addSequence({ name: "Other" });
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "rename", name: "A" }).status).toBe("applied");
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "rename", name: "B", sequence: "Other" }).error?.code).toBe("NOT_FOUND");
    expect(fx.call("premiere_edit_clip", { clip: "000fffff", action: "rename", name: "B" }).summary).toContain("No clip has nodeId 000fffff");
  });
});

describe("premiere_run_script", () => {
  test("returns the completion value as JSON, with app and qe in scope", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const receipt = fx.call("premiere_run_script", { script: "var s = app.project.activeSequence; ({name: s.name, qe: typeof qe, tracks: s.videoTracks.numTracks})" });
    expect(receipt).toMatchObject({ status: "applied", data: { result: { name: "Main", qe: "object", tracks: 3 }, type: "object" } });
    expect(receipt.summary).toBe("Ran the script; it returned an object");
    expect(fx.call("premiere_run_script", { script: "1 + 1" }).data).toEqual({ result: 2, type: "number" });
    expect(fx.call("premiere_run_script", { script: "var x = 1;" }).summary).toBe("Ran the script; it returned nothing");
  });

  test("a failing script is an error with its message; blank is refused", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const receipt = fx.call("premiere_run_script", { script: "app.project.nothing.here" });
    expect(receipt).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    expect(receipt.summary).toMatch(/^Error: The script failed: .*here/);
    expect(fx.call("premiere_run_script", { script: "   " }).error?.code).toBe("INVALID_ARGUMENT");
  });
});

describe("review fixes: QE sequence lookup", () => {
  test("a QE guid that differs from the DOM sequenceID still reaches the active sequence, or the one opened for it", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.state.qeGuidSuffix = "-x";
    expect(fx.call("premiere_razor", { time: 2, tracks: [{ kind: "video", index: 0 }] }).status).toBe("applied");
    expect(edit.sequence.videoTrackList[0]?.clipList).toHaveLength(4);
    fx.mock.project.addSequence({ name: "Other" });
    const receipt = fx.call("premiere_apply_effect", { clip: edit.v.c.nodeId, effect: "Gaussian Blur" });
    expect(receipt.status).toBe("applied");
    expect(receipt.warnings).toContain('Opened sequence "Main" so the QE DOM can reach it');
    expect(edit.v.c.componentList[2]?.displayName).toBe("Gaussian Blur");
  });
});
