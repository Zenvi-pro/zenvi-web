import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../history/document.js";
import { FX_IDS } from "../../fx/catalog.js";
import type { Clip } from "../../model/types.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "../test-support/fixture.js";

async function call(doc: ProjectDocument, host: FakeHost, name: string, args: Record<string, unknown>) {
  return (await runTool({ doc, host }, name, args)).data!;
}

const clipOf = (doc: ProjectDocument, id: string): Clip => doc.project.clips.find((c) => c.id === id)!;
const fileOf = (doc: ProjectDocument, id: string) => doc.project.files.find((f) => f.id === id);

describe("apply_fx_tool", () => {
  it("renders the clip's source range and swaps the clip to the render in one undo step", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const before = structuredClone(clipOf(doc, IDS.clipTail));
    const r = await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipTail, effects: [{ effect: "radial_blur", start: 0, end: 0.3 }, { effect: "bloom" }] });
    expect(r.status).toBe("applied");
    expect(host.calls).toContain("fx /media/interview.mp4 10-14 radial_blur+bloom");
    const clip = clipOf(doc, IDS.clipTail);
    expect(clip).toMatchObject({ position: before.position, layer: before.layer, start: 0, end: 4 });
    const file = fileOf(doc, String(clip.file_id))!;
    expect(file.path).toMatch(/^\/cache\/fx\/.+\.mov$/);
    expect(clip.reader.path).toBe(file.path);
    expect(file.zenvi_link).toMatchObject({ kind: "zenvi-fx", source: { file_id: IDS.interview, start: 10, end: 14 }, props: { effects: [{ effect: "radial_blur", start: 0, end: 0.3 }, { effect: "bloom" }] } });
    expect(r.data).toMatchObject({ timeline_clip_id: IDS.clipTail, original_file_id: IDS.interview, source_range: [10, 14], render: { codec: "prores422", alpha: false } });
    expect(doc.undoLabels).toEqual(["Apply FX radial_blur + bloom"]);
    // The other clip of the interview keeps the original.
    expect(clipOf(doc, IDS.clipA).file_id).toBe(IDS.interview);
  });

  it("adds to an existing stack, re-rendering from the original into the same render file", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "bloom" }] });
    const fxFile = String(clipOf(doc, IDS.clipB).file_id);
    const r = await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "vignette" }] });
    expect(r.status).toBe("applied");
    expect(host.calls.filter((c) => c.startsWith("fx "))).toEqual(["fx /media/broll.mp4 0-5 bloom", "fx /media/broll.mp4 0-5 bloom+vignette"]);
    expect(clipOf(doc, IDS.clipB).file_id).toBe(fxFile);
    expect(doc.project.files.filter((f) => f.zenvi_link)).toHaveLength(1);
  });

  it("slows the clip down: it gets longer on the timeline and removing the FX gives back the original times", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const before = snapshotOf(doc.project);
    const r = await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "optical_flow_slowmo", params: { speed: 0.5 } }] });
    expect(clipOf(doc, IDS.clipB)).toMatchObject({ start: 0, end: 10 });
    expect(r.notes?.[0]).toMatch(/now 10s long on the timeline/);
    await call(doc, host, "remove_fx_tool", { clip_id: IDS.clipB });
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("moves the clip's keyframes with its source frames, and back when the FX go", async () => {
    // Keyframe X counts source frames: the interview tail starts at 10 s (frame 301 at 30 fps).
    const doc = fixtureDoc();
    const pt = (X: number, Y: number) => ({ co: { X, Y }, interpolation: 1 });
    doc.transaction("animate", (tx) =>
      tx.update(["clips", { id: IDS.clipTail }], {
        alpha: { Points: [pt(301, 0), pt(331, 1)] },
        scale_x: { Points: [pt(1, 1)] },
        time: { Points: [pt(301, 301), pt(420, 420)] },
        effects: [{ id: "BLUR1", type: "Blur", sigma: { Points: [pt(391, 0), pt(421, 3)] } }],
      }),
    );
    const host = fakeHost();
    const before = snapshotOf(doc.project);
    const xs = (kf: unknown) => (kf as { Points: { co: { X: number; Y: number } }[] }).Points.map((p) => [p.co.X, p.co.Y]);
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipTail, effects: [{ effect: "bloom" }] });
    let clip = clipOf(doc, IDS.clipTail);
    expect(xs(clip.alpha)).toEqual([[1, 0], [31, 1]]);
    expect(xs(clip.scale_x)).toEqual([[1, 1]]);
    expect(xs(clip.time)).toEqual([[1, 1], [120, 120]]);
    expect(xs(clip.effects?.[0]?.sigma)).toEqual([[91, 0], [121, 3]]);
    // Slow motion at half speed stretches them with the render.
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipTail, effects: [{ effect: "optical_flow_slowmo", params: { speed: 0.5 } }] });
    clip = clipOf(doc, IDS.clipTail);
    expect(xs(clip.alpha)).toEqual([[1, 0], [61, 1]]);
    expect(xs(clip.time)).toEqual([[1, 1], [239, 239]]);
    await call(doc, host, "remove_fx_tool", { clip_id: IDS.clipTail });
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("refuses stills, retimed clips and bad stacks without touching history", async () => {
    const doc = fixtureDoc();
    doc.transaction("speed", (tx) => tx.update(["clips", { id: IDS.clipB }], { time: { Points: [{ co: { X: 1, Y: 1 }, interpolation: 1 }, { co: { X: 100, Y: 200 }, interpolation: 1 }] } }));
    const host = fakeHost();
    const before = snapshotOf(doc.project);
    expect((await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipLogo, effects: [{ effect: "bloom" }] })).summary).toMatch(/not video footage/);
    expect((await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "bloom" }] })).summary).toMatch(/apply FX before retiming it/);
    expect((await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipA, effects: [{ effect: "glitch", params: { rate: 99 } }] })).summary).toMatch(/^Error: effects\[0\]: glitch params: rate:/);
    expect((await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipA, effects: [{ effect: "glitch", start: 30 }] })).summary).toMatch(/after the clip's end/);
    expect(snapshotOf(doc.project)).toEqual(before);
    expect(doc.undoLabels).toEqual(["speed"]);
    expect(host.calls.some((c) => c.startsWith("fx "))).toBe(false);
  });

  it("refuses a clip on a locked track before rendering", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "bloom" }] });
    doc.transaction("lock", (tx) => tx.update(["layers", { number: clipOf(doc, IDS.clipB).layer }], { lock: true }));
    const renders = host.calls.filter((c) => c.startsWith("fx ")).length;
    for (const [name, args] of [["apply_fx_tool", { effects: [{ effect: "vignette" }] }], ["update_fx_tool", { amount: 1 }], ["remove_fx_tool", {}]] as const) {
      const r = await call(doc, host, name, { clip_id: IDS.clipB, ...args });
      expect(r).toMatchObject({ status: "refused", summary: expect.stringMatching(/locked track/) });
    }
    expect(host.calls.filter((c) => c.startsWith("fx "))).toHaveLength(renders);
    expect(doc.undoLabels).toEqual(["Apply FX bloom", "lock"]);
  });

  it("leaves history untouched when the render fails", async () => {
    const doc = fixtureDoc();
    doc.transaction("relink", (tx) => tx.update(["files", { id: IDS.broll }], { path: "/media/unrenderable.mp4" }));
    const host = fakeHost();
    const r = await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "bloom" }] });
    expect(r).toMatchObject({ status: "error", summary: expect.stringMatching(/^Error: the FX render failed: ffmpeg failed/) });
    expect(doc.undoLabels).toEqual(["relink"]);
  });

  it("is refused where the host has no Zenvi FX (the web editor)", async () => {
    const doc = fixtureDoc();
    const r = await call(doc, fakeHost({ without: ["fx"] }), "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "bloom" }] });
    expect(r.summary).toMatch(/^Error: apply_fx_tool is not available in this Zenvi surface: it needs Zenvi FX/);
  });
});

describe("update_fx_tool", () => {
  it("merges params over the effect's and re-renders", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "glitch", start: 1, end: 2 }, { effect: "bloom" }] });
    expect((await call(doc, host, "update_fx_tool", { clip_id: IDS.clipB, amount: 0.9 })).summary).toMatch(/has 2 FX; give index/);
    const r = await call(doc, host, "update_fx_tool", { clip_id: IDS.clipB, index: 0, params: { seed: 42 } });
    expect(r.status).toBe("applied");
    const link = fileOf(doc, String(clipOf(doc, IDS.clipB).file_id))!.zenvi_link as { props: { effects: Record<string, unknown>[] } };
    expect(link.props.effects[0]).toMatchObject({ effect: "glitch", start: 1, end: 2, params: { seed: 42, rate: 2.5 } });
    const whole = await call(doc, host, "update_fx_tool", { clip_id: IDS.clipB, index: 0, whole_clip: true });
    expect((whole.data as { effects: Record<string, unknown>[] }).effects[0]).not.toHaveProperty("start");
  });

  it("answers unchanged without rendering when nothing changes", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "bloom", amount: 0.5 }] });
    const renders = host.calls.filter((c) => c.startsWith("fx ")).length;
    const r = await call(doc, host, "update_fx_tool", { clip_id: IDS.clipB, amount: 0.5 });
    expect(r.status).toBe("unchanged");
    expect(host.calls.filter((c) => c.startsWith("fx ")).length).toBe(renders);
    expect(doc.undoLabels).toHaveLength(1);
  });
});

describe("remove_fx_tool", () => {
  it("restores the original clip exactly and drops the render from the bin", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const before = snapshotOf(doc.project);
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipTail, effects: [{ effect: "halftone" }, { effect: "vignette" }] });
    const r = await call(doc, host, "remove_fx_tool", { clip_id: IDS.clipTail });
    expect(r.status).toBe("applied");
    expect(snapshotOf(doc.project)).toEqual(before);
    expect(doc.undoLabels).toEqual(["Apply FX halftone + vignette", "Remove FX"]);
    doc.undo();
    expect(fileOf(doc, String(clipOf(doc, IDS.clipTail).file_id))?.zenvi_link).toBeTruthy();
  });

  it("removes one effect by re-rendering the rest", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "halftone" }, { effect: "vignette" }] });
    const r = await call(doc, host, "remove_fx_tool", { clip_id: IDS.clipB, index: 0 });
    expect(r.status).toBe("applied");
    expect(host.calls.at(-2)).toBe("fx /media/broll.mp4 0-5 vignette");
    expect((r.data as { effects: { effect: string }[] }).effects.map((e) => e.effect)).toEqual(["vignette"]);
  });

  it("restores everywhere, but removing one of several needs Zenvi FX", async () => {
    const doc = fixtureDoc();
    await call(doc, fakeHost(), "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "halftone" }, { effect: "vignette" }] });
    const web = fakeHost({ without: ["fx"] });
    expect((await call(doc, web, "remove_fx_tool", { clip_id: IDS.clipB, index: 1 })).summary).toMatch(/not available in this Zenvi surface: removing one of several FX/);
    expect((await call(doc, web, "remove_fx_tool", { clip_id: IDS.clipB })).status).toBe("applied");
    expect(clipOf(doc, IDS.clipB).file_id).toBe(IDS.broll);
  });

  it("says unchanged for a clip without FX", async () => {
    const r = await call(fixtureDoc(), fakeHost(), "remove_fx_tool", { clip_id: IDS.clipA });
    expect(r.status).toBe("unchanged");
  });
});

describe("list_fx_tool", () => {
  it("lists each effect with its params schema", async () => {
    const r = await call(fixtureDoc(), fakeHost(), "list_fx_tool", { effect: "glitch" });
    expect(r.data).toMatchObject({ available: true, effects: [{ id: "glitch", params: { type: "object", properties: { rate: { type: "number", default: 2.5 } } } }] });
    const web = await call(fixtureDoc(), fakeHost({ without: ["fx"] }), "list_fx_tool", {});
    expect(web.summary).toMatch(new RegExp(`^${FX_IDS.length} FX; this surface cannot render them`));
  });
});

const lastRender = (host: FakeHost) => host.calls.filter((c) => c.startsWith("fx ")).at(-1);

describe("datamosh_cut_tool", () => {
  it("carries the previous clip's motion into the clip after the cut, in one undo step", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "datamosh_cut_tool", { clip_id: IDS.clipB, length: 0.5 });
    expect(r.status).toBe("applied");
    // The interview clip before it plays source seconds 0-10, so its motion is read where it ends: 10 s.
    expect(host.calls).toContain("fx /media/broll.mp4 0-5 datamosh_carry carry /media/interview.mp4@10");
    const file = fileOf(doc, String(clipOf(doc, IDS.clipB).file_id))!;
    expect(file.zenvi_link).toMatchObject({ kind: "zenvi-fx", props: { effects: [{ effect: "datamosh_carry", params: { length: 0.5, carry: { file_id: IDS.interview, at: 10 } } }] } });
    expect(r.data).toMatchObject({ previous_clip_id: IDS.clipA, carry: { file_id: IDS.interview, at: 10 }, original_file_id: IDS.broll });
    expect(doc.undoLabels).toEqual(["Datamosh cut"]);
  });

  it("takes the clip that ends at the cut, or the one you name", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "datamosh_cut_tool", { clip_id: IDS.clipTail });
    expect(lastRender(host)).toBe("fx /media/interview.mp4 10-14 datamosh_carry carry /media/broll.mp4@5");
    // The tail now plays its FX render, so that is the footage (and the second of it) the next clip carries.
    const named = await call(doc, host, "datamosh_cut_tool", { clip_id: IDS.clipB, previous_clip_id: IDS.clipTail });
    expect(named.status).toBe("applied");
    expect(lastRender(host)).toMatch(/^fx \/media\/broll.mp4 0-5 datamosh_carry carry \/cache\/fx\/\w+\.mov@4$/);
  });

  it("refuses without a clip before the cut, and changes nothing", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const r = await call(doc, fakeHost(), "datamosh_cut_tool", { clip_id: IDS.clipA });
    expect(r.status).toBe("refused");
    expect(r.summary).toMatch(/no clip ends at the start of CLIPINTV01 on its track; give previous_clip_id/);
    expect((await call(doc, fakeHost(), "datamosh_cut_tool", { clip_id: IDS.clipB, previous_clip_id: "NOPE" })).summary).toMatch(/unknown timeline clip NOPE/);
    expect(snapshotOf(doc.project)).toEqual(before);
    expect(doc.undoLabels).toEqual([]);
  });

  it("goes last in the stack and a second run replaces the first instead of stacking", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "datamosh_carry", params: { carry: { file_id: IDS.interview, at: 9 } } }, { effect: "bloom" }] });
    const r = await call(doc, host, "datamosh_cut_tool", { clip_id: IDS.clipB, ghost: 0 });
    expect((r.data as { effects: { effect: string }[] }).effects.map((e) => e.effect)).toEqual(["bloom", "datamosh_carry"]);
    expect(lastRender(host)).toBe("fx /media/broll.mp4 0-5 bloom+datamosh_carry carry /media/interview.mp4@10");
  });

  it("is refused by apply_fx_tool without the footage before the cut, and takes no window", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const bare = await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "datamosh_carry" }] });
    expect(bare.status).toBe("refused");
    expect(bare.summary).toMatch(/needs the footage before the cut; use datamosh_cut_tool/);
    const windowed = await call(doc, host, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ effect: "datamosh_carry", start: 1, end: 2, params: { carry: { file_id: IDS.interview, at: 9 } } }] });
    expect(windowed.summary).toMatch(/set params.length, not start\/end/);
    expect(host.calls.filter((c) => c.startsWith("fx "))).toEqual([]);
  });

  it("keeps the carry when update_fx_tool changes the amount", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "datamosh_cut_tool", { clip_id: IDS.clipB });
    const r = await call(doc, host, "update_fx_tool", { clip_id: IDS.clipB, amount: 0.9 });
    expect(r.status).toBe("applied");
    expect(lastRender(host)).toBe("fx /media/broll.mp4 0-5 datamosh_carry carry /media/interview.mp4@10");
  });
});
