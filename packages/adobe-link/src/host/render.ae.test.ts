import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { RQItemStatus } from "../testing/ae-mock.js";
import { aeHarness, type AeHarness } from "../testing/ae-harness.js";

function saved(options: Parameters<typeof aeHarness>[0] = {}) {
  const h = aeHarness(options);
  h.mock.project.save(new h.mock.es.File(path.join(h.dir, "promo.aep")));
  const comp = h.mock.addComp({ name: "Main" });
  return { h, comp };
}

/** After Effects must not render inside an undo group, and every render queue change happens inside one. */
function expectRenderOutsideGroups(h: AeHarness) {
  const queue = h.mock.project.renderQueue;
  expect(queue.undoDepthAtRender.every((depth) => depth === 0)).toBe(true);
  expect(h.mock.state.queueChangeDepths.filter((depth) => depth === 0)).toEqual([]);
  expect(h.mock.state.undoDepth).toBe(0);
}

function partials(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".zenvi-partial-"));
}

describe("ae_render", () => {
  test("H.264 (the 40 Mbps template) next to the saved project, in one undo step; the render runs outside it", () => {
    const { h, comp } = saved();
    const receipt = h.callValidated("ae_render");
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(receipt.data).toMatchObject({
      comp_id: comp.id,
      output: path.join(h.dir, "Renders", "Main.mp4"),
      template: "H.264 - Match Render Settings - 40 Mbps",
      codec: "h264",
      mode: "render_now",
      render_queue_index: 1,
      status: "done",
    });
    expect(receipt.data.size_bytes).toBeGreaterThan(0);
    expect(h.mock.project.renderQueue.item(1).renderSettings).toBe("Best Settings");
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Render comp"]);
    expect(h.mock.project.renderQueue.undoDepthAtRender).toEqual([0]);
    expectRenderOutsideGroups(h);
  });

  test("renders only its own queue item: the others are unchecked while queueing and checked again in a second undo step", () => {
    const { h, comp } = saved();
    const other = h.mock.addComp({ name: "Other", active: false });
    h.mock.project.renderQueue.items.add(other);
    h.mock.project.renderQueue.items.add(other).render = false;
    h.mock.state.queueChangeDepths.length = 0;
    const receipt = h.callValidated("ae_render");
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 2, data: { render_queue_index: 3 } });
    const queue = h.mock.project.renderQueue;
    expect(queue.rendered).toEqual([comp.id]);
    expect(queue.item(1)).toMatchObject({ status: RQItemStatus.QUEUED, render: true });
    expect(queue.item(2)).toMatchObject({ status: RQItemStatus.UNQUEUED, render: false });
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Render comp", "Zenvi: Render comp"]);
    expectRenderOutsideGroups(h);
  });

  test("falls back by version: ProRes 422 on 2022, Lossless before; the extension follows the format", () => {
    const v22 = saved({ version: "22.6x1" });
    const prores = v22.h.callValidated("ae_render", { output: path.join(v22.h.dir, "out.mp4") });
    expect(prores.data).toMatchObject({ template: "High Quality", codec: "prores422", output: path.join(v22.h.dir, "out.mov") });
    expect(prores.warnings).toContain('This After Effects has no h264 output template; rendered prores-422 ("High Quality")');
    expect(prores.warnings).toContain("Changed the output extension from .mp4 to .mov to match the format");

    const v18 = saved({ version: "18.4x2" });
    expect(v18.h.callValidated("ae_render").data).toMatchObject({ template: "Lossless", codec: "qtrle" });
    expect(v18.h.callValidated("ae_render", { preset: "prores-4444", overwrite: true }).data).toMatchObject({ template: "Lossless with Alpha" });
  });

  test("queue_only and media_encoder; work area span; an exact template", () => {
    const { h, comp } = saved();
    comp.workAreaStart = 2;
    comp.workAreaDuration = 3;
    const queued = h.callValidated("ae_render", { mode: "queue_only", work_area_only: true, template: "Lossless with Alpha", output: path.join(h.dir, "a.mov") });
    expect(queued).toMatchObject({ undoSteps: 1, data: { mode: "queue_only", status: "queued", codec: "qtrle", size_bytes: null } });
    expect(h.mock.project.renderQueue.item(1)).toMatchObject({ timeSpanStart: 2, timeSpanDuration: 3 });
    expect(h.mock.project.renderQueue.rendered).toEqual([]);

    // The queue_only item stays queued but is not sent to Media Encoder with ours.
    const ame = h.callValidated("ae_render", { mode: "media_encoder", output: path.join(h.dir, "b.mp4") });
    expect(ame).toMatchObject({ status: "applied", undoSteps: 2 });
    expect(ame.summary).toContain("Queued \"Main\" in Adobe Media Encoder");
    expect(h.mock.project.renderQueue.sentToMediaEncoder).toEqual([comp.id]);
    expect(h.mock.project.renderQueue.item(1)).toMatchObject({ status: RQItemStatus.QUEUED, render: true });
    expectRenderOutsideGroups(h);
  });

  test("media_encoder when After Effects has nothing it can send: an error after queueing, the item stays queued", () => {
    const { h } = saved({ canQueueInAME: false });
    const receipt = h.callValidated("ae_render", { mode: "media_encoder", output: path.join(h.dir, "x.mp4") });
    // Outside dispatch's undo group the receipt cannot count the steps (null); the warning does.
    expect(receipt).toMatchObject({ status: "error", undoSteps: null, error: { code: "UNSUPPORTED" } });
    expect(receipt.summary).toContain("stays in the render queue as item 1");
    expect(receipt.warnings.join(" ")).toContain('This call made 1 undo step: Edit > Undo "Zenvi: Render comp" takes "Main" off the render queue again');
    expect(h.mock.project.renderQueue.numItems).toBe(1);
    expect(h.mock.project.renderQueue.sentToMediaEncoder).toEqual([]);
  });

  test("refusals before queueing: unsaved project without output, existing file, unknown template, busy queue, no Media Encoder API, empty work area", () => {
    const fresh = aeHarness();
    fresh.mock.addComp();
    expect(fresh.callValidated("ae_render")).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });

    const { h, comp } = saved();
    const existing = h.file("taken.mp4");
    expect(h.callValidated("ae_render", { output: existing }).error?.message).toContain("already exists");
    expect(h.callValidated("ae_render", { template: "Nope", output: path.join(h.dir, "x.mov") })).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    (h.mock.project.renderQueue as unknown as { queueInAME: unknown }).queueInAME = undefined;
    expect(h.callValidated("ae_render", { mode: "media_encoder", output: path.join(h.dir, "x.mp4") })).toMatchObject({ status: "refused", error: { code: "UNSUPPORTED" } });
    comp.workAreaDuration = 0;
    expect(h.callValidated("ae_render", { work_area_only: true, output: path.join(h.dir, "w.mp4") })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    h.mock.project.renderQueue.rendering = true;
    expect(h.callValidated("ae_render", { output: path.join(h.dir, "y.mp4") })).toMatchObject({ status: "refused", error: { code: "BUSY" } });
    expect(h.mock.project.renderQueue.numItems).toBe(0);
    for (const receipt of [fresh, h]) expect(receipt.mock.state.queueChangeDepths.filter((depth) => depth === 0)).toEqual([]);
  });

  test("overwrite renders to a staging file and replaces the old file only when the render finished", () => {
    const { h } = saved();
    const target = h.file("final.mp4", "old");
    const replaced = h.callValidated("ae_render", { output: target, overwrite: true });
    expect(replaced).toMatchObject({ status: "applied", data: { output: target } });
    expect(readFileSync(target, "utf8")).toContain("rendered Main");
    expect(partials(h.dir)).toEqual([]);

    h.mock.project.renderQueue.failNextRender = true;
    const failed = h.callValidated("ae_render", { output: target, overwrite: true });
    expect(failed).toMatchObject({ status: "error", undoSteps: null, error: { code: "HOST_ERROR" } });
    expect(failed.summary).toContain("status err_stopped");
    expect(readFileSync(target, "utf8")).toContain("rendered Main");
    expect(partials(h.dir)).toEqual([]);
  });

  test("a literal % in the project's folder: the default Renders output lands there, not in a URI-decoded folder", () => {
    const h = aeHarness();
    const dir = path.join(h.dir, "Project%20files");
    mkdirSync(dir);
    // As After Effects holds it: the File for the real path (its % passed as %25).
    h.mock.project.save(new h.mock.es.File(path.join(dir, "promo.aep").replace(/%/g, "%25")));
    h.mock.addComp({ name: "Main" });
    const receipt = h.callValidated("ae_render");
    expect(receipt).toMatchObject({ status: "applied", data: { output: path.join(dir, "Renders", "Main.mp4") } });
    expect(receipt.data.size_bytes).toBeGreaterThan(0);
    expect(existsSync(path.join(h.dir, "Project files"))).toBe(false);
  });

  test("a failed render to a new file removes the partial file", () => {
    const { h } = saved();
    h.mock.project.renderQueue.failNextRender = true;
    const target = path.join(h.dir, "new.mp4");
    expect(h.callValidated("ae_render", { output: target })).toMatchObject({ status: "error" });
    expect(existsSync(target)).toBe(false);
  });

  test("a failed render with other queued items says it made two undo steps", () => {
    const { h } = saved();
    h.mock.project.renderQueue.items.add(h.mock.addComp({ name: "Other", active: false }));
    h.mock.project.renderQueue.failNextRender = true;
    const failed = h.callValidated("ae_render", { output: path.join(h.dir, "f.mp4") });
    expect(failed).toMatchObject({ status: "error" });
    expect(failed.warnings.join(" ")).toContain('2 undo steps ("Zenvi: Render comp" twice)');
    expect(h.mock.project.renderQueue.item(1)).toMatchObject({ render: true, status: RQItemStatus.QUEUED });
  });
});

describe("ae_render_for_zenvi", () => {
  test("H.264 into the temp renders folder; everything a linked clip needs, SPEC 3.6 link included; the queue is left clean", () => {
    const { h, comp } = saved();
    const receipt = h.callValidated("ae_render_for_zenvi");
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 2 });
    const data = receipt.data as Record<string, unknown>;
    expect(path.dirname(data.path as string)).toBe(path.join(h.dir, "zenvi-link", "renders"));
    expect(path.basename(data.path as string)).toMatch(new RegExp(`^Main-${comp.id}-\\d{8}-\\d{6}\\.mp4$`));
    expect(statSync(data.path as string).size).toBeGreaterThan(0);
    expect(data).toMatchObject({
      comp_id: comp.id,
      comp_name: "Main",
      project: path.join(h.dir, "promo.aep"),
      width: 1920,
      height: 1080,
      fps: 30,
      fps_rational: { num: 30, den: 1 },
      duration: 10,
      duration_frames: 300,
      codec: "h264",
      alpha: false,
    });
    expect(data.link).toEqual({
      version: 1,
      kind: "aftereffects",
      source: { project_dir: null, entry: null, composition: "Main", composition_key: comp.id, file: null, line: null, aep: path.join(h.dir, "promo.aep") },
      props: {},
      render: {
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: { num: 30, den: 1 },
        duration_frames: 300,
        output: data.path,
        rendered_at: data.rendered_at,
        fingerprint: null,
      },
      state: "fresh",
      error: null,
    });
    expect(data.rendered_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(h.mock.project.renderQueue.numItems).toBe(0);
    // Queue in one undo step, render outside any, remove the finished item in a second step.
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Render for Zenvi", "Zenvi: Render for Zenvi"]);
    expect(h.mock.state.queueChangeDepths).toEqual([1, 1]);
    expectRenderOutsideGroups(h);
  });

  test("alpha renders ProRes 4444; NTSC rates are rational; an unsaved project warns", () => {
    const h = aeHarness();
    h.mock.addComp({ name: "Overlay", frameRate: 29.97, duration: 2 });
    const receipt = h.callValidated("ae_render_for_zenvi", { alpha: true, output: path.join(h.dir, "overlay.mov") });
    expect(receipt.data).toMatchObject({ codec: "prores4444", template: "High Quality with Alpha", fps_rational: { num: 30000, den: 1001 }, duration_frames: 60, project: null });
    expect((receipt.data.link as { source: { aep: unknown } }).source.aep).toBeNull();
    expect(receipt.warnings.join(" ")).toContain("unsaved");
    expect(existsSync(path.join(h.dir, "overlay.mov"))).toBe(true);
  });

  test("refuses without an active comp, while the queue is rendering, and for an empty work area, before queueing anything", () => {
    const h = aeHarness();
    expect(h.callValidated("ae_render_for_zenvi")).toMatchObject({ status: "refused", error: { code: "NO_ACTIVE_COMP" } });
    const comp = h.mock.addComp();
    comp.workAreaDuration = 0;
    expect(h.callValidated("ae_render_for_zenvi", { work_area_only: true })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    h.mock.project.renderQueue.rendering = true;
    expect(h.callValidated("ae_render_for_zenvi")).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "BUSY" } });
    expect(h.mock.project.renderQueue.numItems).toBe(0);
    expect(h.mock.state.undoGroups).toEqual([]);
  });

  test.each([
    ["2023+, opaque: H.264", "26.3x12", undefined, false, "H.264 - Match Render Settings - 40 Mbps", "h264", null],
    ["2023+, alpha: ProRes 4444", "26.3x12", undefined, true, "High Quality with Alpha", "prores4444", null],
    ["2022, opaque: no H.264, so ProRes 4444", "22.6x1", undefined, false, "High Quality with Alpha", "prores4444", "no h264 output template; rendered prores-4444"],
    ["2022, alpha: ProRes 4444", "22.6x1", undefined, true, "High Quality with Alpha", "prores4444", null],
    ["2021, opaque: QuickTime Animation", "18.4x2", undefined, false, "Lossless", "qtrle", "no h264 output template; rendered lossless"],
    ["2021, alpha: QuickTime Animation with alpha", "18.4x2", undefined, true, "Lossless with Alpha", "qtrle", "no prores-4444 output template; rendered lossless-alpha"],
    ["opaque with only Lossless with Alpha left", "18.4x2", ["Lossless with Alpha", "Photoshop"], false, "Lossless with Alpha", "qtrle", "rendered lossless-alpha"],
  ] as const)("only codecs Zenvi links: %s", (_label, version, templates, alpha, template, codec, warning) => {
    const h = aeHarness(templates ? { version, outputTemplates: [...templates] } : { version });
    h.mock.addComp({ name: "Main", duration: 1 });
    const receipt = h.callValidated("ae_render_for_zenvi", { alpha });
    expect(receipt.status).toBe("applied");
    expect(receipt.data).toMatchObject({ template, codec, alpha });
    expect((receipt.data.link as { render: { codec: string } }).render.codec).toBe(codec);
    expect(["h264", "prores4444", "qtrle"]).toContain(codec);
    if (warning) expect(receipt.warnings.join(" ")).toContain(warning);
    else expect(receipt.warnings.filter((w) => w.includes("output template"))).toEqual([]);
  });

  test("never ProRes 422: refuses when no linkable template exists, and an explicit ProRes 422 template", () => {
    const none = aeHarness({ outputTemplates: ["High Quality", "Photoshop", "AIFF 48kHz"] });
    none.mock.addComp();
    const refused = none.callValidated("ae_render_for_zenvi");
    expect(refused).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "UNSUPPORTED" } });
    expect(refused.summary).toContain("h264, prores4444, qtrle");
    expect(none.mock.project.renderQueue.numItems).toBe(0);

    const h = aeHarness();
    h.mock.addComp();
    expect(h.callValidated("ae_render_for_zenvi", { template: "High Quality" })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.callValidated("ae_render_for_zenvi", { template: "H.264 - Match Render Settings - 15 Mbps" }).data).toMatchObject({ codec: "h264" });
    expect(h.mock.project.renderQueue.numItems).toBe(0);
  });

  test("the first render reads the output templates from its own queue item; later refusals need no undo group at all", () => {
    const h = aeHarness({ outputTemplates: ["High Quality", "Photoshop"] });
    h.mock.addComp();
    // Nothing queued and nothing remembered: the item is added, read, and removed again in the same group.
    expect(h.callValidated("ae_render_for_zenvi")).toMatchObject({ status: "refused", undoSteps: 0 });
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Render for Zenvi"]);
    expect(h.mock.state.queueChangeDepths).toEqual([1, 1]);
    expect(h.host.evaluate("ZenviLink.state.ae.outputTemplates.join('|')")).toBe("High Quality|Photoshop");
    // Remembered now (even after the panel evaluates the host script again): refused before any change.
    h.host.evaluate(h.host.bundle.text);
    expect(h.callValidated("ae_render_for_zenvi")).toMatchObject({ status: "refused", undoSteps: 0 });
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Render for Zenvi"]);
    expect(h.mock.state.queueChangeDepths).toEqual([1, 1]);
  });

  test("an existing output needs overwrite; it is replaced only by a finished render", () => {
    const { h } = saved();
    const target = h.file("clip.mp4", "old");
    const refused = h.callValidated("ae_render_for_zenvi", { output: target });
    expect(refused).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "INVALID_ARGUMENT" } });
    expect(refused.summary).toContain("already exists; pass overwrite: true");
    expect(h.mock.project.renderQueue.numItems).toBe(0);

    h.mock.project.renderQueue.failNextRender = true;
    expect(h.callValidated("ae_render_for_zenvi", { output: target, overwrite: true })).toMatchObject({ status: "error" });
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(partials(h.dir)).toEqual([]);
    // The failed item stays in the queue for inspection.
    expect(h.mock.project.renderQueue.numItems).toBe(1);
    h.mock.project.renderQueue.item(1).remove();

    const replaced = h.callValidated("ae_render_for_zenvi", { output: target, overwrite: true });
    expect(replaced).toMatchObject({ status: "applied", undoSteps: 2, data: { path: target } });
    expect(readFileSync(target, "utf8")).toContain("rendered Main");
    expect(partials(h.dir)).toEqual([]);
  });

  test("an output in a folder with a literal % is rendered there, and replaced through a staging file next to it", () => {
    const { h } = saved();
    for (const name of ["Project%20files", "100% done"]) {
      const dir = path.join(h.dir, name);
      mkdirSync(dir);
      const target = path.join(dir, "clip.mp4");
      const first = h.callValidated("ae_render_for_zenvi", { output: target });
      expect(first, name).toMatchObject({ status: "applied", data: { path: target } });
      expect(first.data.size_bytes, name).toBeGreaterThan(0);
      writeFileSync(target, "old");
      const replaced = h.callValidated("ae_render_for_zenvi", { output: target, overwrite: true });
      expect(replaced, name).toMatchObject({ status: "applied", data: { path: target } });
      expect(readFileSync(target, "utf8"), name).toContain("rendered Main");
      expect(partials(dir), name).toEqual([]);
    }
    expect(existsSync(path.join(h.dir, "Project files"))).toBe(false);
  });

  test("the default output is always a new file", () => {
    const { h } = saved();
    const first = h.callValidated("ae_render_for_zenvi").data.path as string;
    const second = h.callValidated("ae_render_for_zenvi").data.path as string;
    expect(second).not.toBe(first);
    expect(existsSync(first) && existsSync(second)).toBe(true);
  });

  test("other queued items render neither with ours nor stay unchecked; tidying them shares the second undo step", () => {
    const { h, comp } = saved();
    const other = h.mock.addComp({ name: "Other", active: false });
    h.mock.project.renderQueue.items.add(other);
    h.mock.state.queueChangeDepths.length = 0;
    const receipt = h.callValidated("ae_render_for_zenvi");
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 2 });
    const queue = h.mock.project.renderQueue;
    expect(queue.rendered).toEqual([comp.id]);
    expect(queue.numItems).toBe(1);
    expect(queue.item(1)).toMatchObject({ status: RQItemStatus.QUEUED, render: true });
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Render for Zenvi", "Zenvi: Render for Zenvi"]);
    expectRenderOutsideGroups(h);
  });

  test("work area only; a failed render is an error and stays in the queue for inspection", () => {
    const { h, comp } = saved();
    comp.workAreaStart = 1;
    comp.workAreaDuration = 2;
    expect(h.callValidated("ae_render_for_zenvi", { work_area_only: true }).data).toMatchObject({ duration: 2, duration_frames: 60 });
    h.mock.project.renderQueue.failNextRender = true;
    const failed = h.callValidated("ae_render_for_zenvi");
    expect(failed).toMatchObject({ status: "error", undoSteps: null, error: { code: "HOST_ERROR" } });
    expect(failed.warnings.join(" ")).toContain('This call made 1 undo step: Edit > Undo "Zenvi: Render for Zenvi"');
    expect(h.mock.project.renderQueue.numItems).toBe(1);
    expect(readdirSync(path.join(h.dir, "zenvi-link", "renders"))).toHaveLength(1);
  });
});
