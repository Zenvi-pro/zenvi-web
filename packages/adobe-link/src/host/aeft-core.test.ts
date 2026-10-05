import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ImportOptions, createAeMock, type AeMockOptions, type FootageItem } from "../testing/ae-mock.js";
import { loadHostScript, type LoadedHostScript } from "../testing/host-script.js";

function load(options: AeMockOptions = {}) {
  const mock = createAeMock({ tempDir: mkdtempSync(path.join(os.tmpdir(), "zenvi-link-ae-")), ...options });
  const host = loadHostScript("aeft", mock.globals);
  return { mock, host };
}

/** A test-only tool that resolves `args.comp` / `args.layer` with the core helpers. */
function addProbe(host: LoadedHostScript): void {
  host.evaluate(`ZenviLink.register("ae_t_probe", function (args) {
    var AE = ZenviLink.ae;
    var comp = args.layer !== undefined && typeof args.layer === "number" && args.comp === undefined ? null : AE.findComp(args.comp);
    var data = {comp_id: comp ? comp.id : null};
    if (args.layer !== undefined) {
      var layer = AE.findLayer(comp, args.layer);
      data.layer = AE.layerRef(layer);
    }
    return ZenviLink.ok("probe", data);
  });`);
}

describe("ae_get_state", () => {
  test("untitled project with no active comp", () => {
    const { host } = load();
    const receipt = host.dispatch("ae_get_state");
    expect(receipt.status).toBe("ok");
    expect(receipt.summary).toBe("After Effects 26.3x12, untitled project, no active comp, render queue empty");
    expect(receipt.data).toMatchObject({
      app: { name: "Adobe After Effects", version: "26.3x12" },
      project: { path: null, name: null, num_items: 0 },
      active_comp: null,
      selection: { items: [], layers: [] },
      render_queue: { num_items: 0, rendering: false, items: [] },
    });
  });

  test("saved project, active comp, selection and render queue", () => {
    const { mock, host } = load();
    const projectFile = new mock.es.File(path.join(mock.es.state.tempDir, "promo.aep"));
    mock.project.save(projectFile);
    const comp = mock.addComp({ name: "Promo", width: 1080, height: 1920, frameRate: 25, duration: 12 });
    mock.project.dirty = true;
    const title = comp.layers.addText("Launch day");
    title.selected = true;
    comp.selected = true;
    const queued = mock.project.renderQueue.items.add(comp);
    queued.outputModule(1).file = new mock.es.File(path.join(mock.es.state.tempDir, "promo.mov"));

    const receipt = host.dispatch("ae_get_state");
    expect(receipt.summary).toBe(
      `After Effects 26.3x12, project "promo.aep" (unsaved changes), active comp "Promo" (id ${comp.id}, 1080x1920, 25 fps, 12 s, 1 layer), 1 layer selected, render queue: 1 item`,
    );
    expect(receipt.data).toMatchObject({
      project: { path: projectFile.fsName, name: "promo.aep", dirty: true },
      active_comp: { comp_id: comp.id, width: 1080, height: 1920, fps: 25, duration: 12, num_layers: 1, work_area: { start: 0, duration: 12 } },
      selection: {
        items: [{ id: comp.id, name: "Promo", type: "comp" }],
        layers: [{ layer_id: title.id, comp_id: comp.id, layer_index: 1, name: "Launch day", type: "text" }],
      },
      render_queue: { num_items: 1, items: [{ index: 1, comp_id: comp.id, comp_name: "Promo", status: "queued", output: path.join(mock.es.state.tempDir, "promo.mov") }] },
    });
  });
});

describe("findComp", () => {
  test("active comp, by id, by exact name", () => {
    const { mock, host } = load();
    const a = mock.addComp({ name: "A" });
    const b = mock.addComp({ name: "B", active: false });
    addProbe(host);
    expect(host.dispatch("ae_t_probe", {}).data).toEqual({ comp_id: a.id });
    expect(host.dispatch("ae_t_probe", { comp: b.id }).data).toEqual({ comp_id: b.id });
    expect(host.dispatch("ae_t_probe", { comp: "B" }).data).toEqual({ comp_id: b.id });
  });

  test.each([
    ["no active comp", undefined, "NO_ACTIVE_COMP", /No comp is active/],
    ["missing id", 999, "NOT_FOUND", /No project item has id 999/],
    ["missing name", "Nope", "NOT_FOUND", /No comp is named "Nope"/],
    ["ambiguous name", "Twin", "INVALID_ARGUMENT", /2 comps are named "Twin" \(ids \d+, \d+\); pass the comp id/],
    ["not a comp", "folder", "INVALID_ARGUMENT", /is a folder, not a comp/],
  ])("%s", (_label, ref, code, message) => {
    const { mock, host } = load();
    mock.addComp({ name: "Twin", active: false });
    mock.addComp({ name: "Twin", active: false });
    const folder = mock.project.items.addFolder("Footage");
    addProbe(host);
    const receipt = host.dispatch("ae_t_probe", ref === "folder" ? { comp: folder.id } : ref === undefined ? {} : { comp: ref });
    expect(receipt.status).toBe("refused");
    expect(receipt.error?.code).toBe(code);
    expect(receipt.summary).toMatch(message);
  });
});

describe("findLayer", () => {
  test("by id (any comp), {index} and exact name", () => {
    const { mock, host } = load();
    const comp = mock.addComp({ name: "Main" });
    const bottom = comp.layers.addSolid([1, 0, 0], "Red", 1920, 1080, 1);
    const top = comp.layers.addText("Title");
    addProbe(host);
    expect(host.dispatch("ae_t_probe", { layer: bottom.id }).data.layer).toEqual({ layer_id: bottom.id, comp_id: comp.id, layer_index: 2, name: "Red", type: "solid" });
    expect(host.dispatch("ae_t_probe", { layer: { index: 1 } }).data.layer).toMatchObject({ layer_id: top.id, layer_index: 1 });
    expect(host.dispatch("ae_t_probe", { layer: "Red" }).data.layer).toMatchObject({ layer_id: bottom.id });
  });

  test.each([
    ["missing id", 9999, "NOT_FOUND", /No layer has id 9999/],
    ["index out of range", { index: 3 }, "NOT_FOUND", /has 2 layers; there is no layer index 3/],
    ["missing name", "Ghost", "NOT_FOUND", /has no layer named "Ghost"/],
    ["ambiguous name", "Twin", "INVALID_ARGUMENT", /2 layers in "Main" are named "Twin" \(indexes 1, 2\)/],
  ])("%s", (_label, ref, code, message) => {
    const { mock, host } = load();
    const comp = mock.addComp({ name: "Main" });
    comp.layers.addNull().name = "Twin";
    comp.layers.addNull().name = "Twin";
    addProbe(host);
    const receipt = host.dispatch("ae_t_probe", { comp: comp.id, layer: ref });
    expect(receipt.status).toBe("refused");
    expect(receipt.error?.code).toBe(code);
    expect(receipt.summary).toMatch(message);
  });

  test("a layer id from another comp is refused when a comp was named", () => {
    const { mock, host } = load();
    const main = mock.addComp({ name: "Main" });
    const other = mock.addComp({ name: "Other", active: false });
    const layer = other.layers.addNull();
    addProbe(host);
    const receipt = host.dispatch("ae_t_probe", { comp: main.id, layer: layer.id });
    expect(receipt.error?.code).toBe("NOT_FOUND");
    expect(receipt.summary).toContain(`is in comp "Other" (id ${other.id}), not in "Main"`);
  });

  test("layer ids need After Effects 22+", () => {
    const { mock, host } = load({ version: "18.4x2" });
    const comp = mock.addComp();
    comp.layers.addNull();
    addProbe(host);
    const receipt = host.dispatch("ae_t_probe", { comp: comp.id, layer: 101 });
    expect(receipt.error?.code).toBe("UNSUPPORTED");
    expect(host.dispatch("ae_t_probe", { comp: comp.id, layer: { index: 1 } }).data.layer).toMatchObject({ layer_id: null, layer_index: 1 });
  });
});

test("layer types", () => {
  const { mock, host } = load();
  const comp = mock.addComp();
  const footage = mock.project.importFile(new ImportOptions(writeFile(mock, "clip.mov"))) as FootageItem;
  const audio = mock.project.importFile(new ImportOptions(writeFile(mock, "music.wav"))) as FootageItem;
  const precomp = mock.addComp({ name: "Pre", active: false });
  comp.layers.add(footage);
  comp.layers.add(audio);
  comp.layers.add(precomp);
  comp.layers.addSolid([0, 0, 0], "Solid", 100, 100, 1);
  comp.layers.addNull();
  const adjustment = comp.layers.addSolid([1, 1, 1], "Adjust", 100, 100, 1);
  adjustment.adjustmentLayer = true;
  comp.layers.addText("T");
  comp.layers.addShape();
  comp.layers.addCamera("Cam", [960, 540]);
  comp.layers.addLight("Light", [960, 540]);
  const types = host.evaluate(`(function () {
    var comp = app.project.activeItem, out = [];
    for (var i = 1; i <= comp.numLayers; i += 1) { out.push(ZenviLink.ae.layerType(comp.layer(i))); }
    return out.join(",");
  }())`);
  expect(types).toBe("light,camera,shape,text,adjustment,null,solid,precomp,audio,footage");
});

function writeFile(mock: ReturnType<typeof createAeMock>, name: string) {
  const file = new mock.es.File(path.join(mock.es.state.tempDir, name));
  file.open("w");
  file.write("x");
  file.close();
  return file;
}
