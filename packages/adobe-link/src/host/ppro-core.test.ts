import { describe, expect, test } from "vitest";
import { loadHostScript, type LoadedHostScript } from "../testing/host-script.js";
import { createPremiereMock, TICKS_PER_SECOND } from "../testing/premiere-mock.js";

function load() {
  const mock = createPremiereMock();
  const host = loadHostScript("ppro", mock.globals);
  return { mock, host };
}

function addProbe(host: LoadedHostScript): void {
  host.evaluate(`ZenviLink.register("premiere_t_probe", function (args, ctx) {
    var P = ZenviLink.ppro;
    var sequence = P.findSequence(args.sequence);
    var data = {sequence_id: sequence.sequenceID};
    if (args.track !== undefined) { data.track = P.findTrack(sequence, args.track).name; }
    if (args.snap !== undefined) { data.snapped = P.snapTime(sequence, args.snap, ctx, "start"); data.ticks = P.secondsToTicks(data.snapped); }
    return ZenviLink.ok("probe", data);
  });`);
}

describe("premiere_get_state", () => {
  test("refuses when no project is open", () => {
    const { mock, host } = load();
    mock.app.documentOpen = false;
    const receipt = host.dispatch("premiere_get_state");
    expect(receipt).toMatchObject({ status: "refused", error: { code: "NO_PROJECT" } });
  });

  test("sequences, the active one with playhead, in/out and selection", () => {
    const { mock, host } = load();
    mock.project.name = "trip.prproj";
    mock.project.path = "/Users/me/trip.prproj";
    mock.project.addSequence({ name: "Rough", fps: 24, duration: 30, active: false });
    const main = mock.project.addSequence({ name: "Main", width: 1080, height: 1920, fps: 29.97, duration: 12.5 });
    main.setPlayerPosition(String(3 * TICKS_PER_SECOND));
    main.setInPoint(1);
    main.setOutPoint(9);
    const media = mock.project.addMedia("beach.mp4", "/Users/me/beach.mp4");
    main.audioTrackList[1]?.addClip(media, 2, 6).setSelected(true);

    const receipt = host.dispatch("premiere_get_state");
    expect(receipt.status).toBe("ok");
    expect(receipt.summary).toBe(
      'Premiere Pro 26.0.0, project "trip.prproj", 2 sequences, active sequence "Main" (1080x1920, 29.97 fps, 12.5 s, playhead 3 s), 1 clip selected',
    );
    expect(receipt.data).toMatchObject({
      project: { path: "/Users/me/trip.prproj", name: "trip.prproj" },
      sequences: [
        { name: "Rough", fps: 24, duration: 30 },
        { name: "Main", sequence_id: main.sequenceID, width: 1080, height: 1920, fps: 29.97 },
      ],
      active_sequence: {
        sequence_id: main.sequenceID,
        playhead: 3,
        in_point: 1,
        out_point: 9,
        selection: [{ name: "beach.mp4", track: { kind: "audio", index: 1 }, start: 2, end: 6 }],
      },
    });
  });

  test("no active sequence", () => {
    const { host } = load();
    expect(host.dispatch("premiere_get_state")).toMatchObject({ status: "ok", data: { sequences: [], active_sequence: null } });
  });
});

describe("Premiere helpers", () => {
  test("findSequence: active, by id, by name; refusals", () => {
    const { mock, host } = load();
    const a = mock.project.addSequence({ name: "A" });
    const b = mock.project.addSequence({ name: "B", active: false });
    mock.project.addSequence({ name: "Twin", active: false });
    mock.project.addSequence({ name: "Twin", active: false });
    addProbe(host);
    expect(host.dispatch("premiere_t_probe", {}).data).toEqual({ sequence_id: a.sequenceID });
    expect(host.dispatch("premiere_t_probe", { sequence: b.sequenceID }).data).toEqual({ sequence_id: b.sequenceID });
    expect(host.dispatch("premiere_t_probe", { sequence: "B" }).data).toEqual({ sequence_id: b.sequenceID });
    expect(host.dispatch("premiere_t_probe", { sequence: "Nope" }).error?.code).toBe("NOT_FOUND");
    expect(host.dispatch("premiere_t_probe", { sequence: "Twin" }).error?.code).toBe("INVALID_ARGUMENT");
    mock.project.activeSequence = null;
    expect(host.dispatch("premiere_t_probe", {}).error?.code).toBe("NO_ACTIVE_SEQUENCE");
  });

  test("findTrack is 0-based and bounded", () => {
    const { mock, host } = load();
    mock.project.addSequence({ videoTracks: 2, audioTracks: 1 });
    addProbe(host);
    expect(host.dispatch("premiere_t_probe", { track: { kind: "video", index: 1 } }).data.track).toBe("Video 2");
    const receipt = host.dispatch("premiere_t_probe", { track: { kind: "audio", index: 1 } });
    expect(receipt.error?.code).toBe("NOT_FOUND");
    expect(receipt.summary).toContain("has 1 audio track; there is no index 1 (A2)");
  });

  test("snapTime snaps to the sequence frame grid in exact ticks", () => {
    const { mock, host } = load();
    mock.project.addSequence({ fps: 25 });
    addProbe(host);
    const receipt = host.dispatch("premiere_t_probe", { snap: 1.03 });
    expect(receipt.data).toMatchObject({ snapped: 1.04, ticks: String(26 * (TICKS_PER_SECOND / 25)) });
    expect(receipt.warnings).toEqual(["Snapped start 1.03 s to the frame grid: 1.04 s (frame 26 at 25 fps)"]);
  });

  test("QE is enabled once, on first use", () => {
    const { mock, host } = load();
    expect(host.evaluate("typeof qe")).toBe("undefined");
    host.evaluate("ZenviLink.ppro.qe().project.getActiveSequence()");
    host.evaluate("ZenviLink.ppro.qe()");
    expect(mock.state.qeEnabled).toBe(true);
    expect(mock.state.qeCalls).toEqual(["project.getActiveSequence()"]);
  });
});
