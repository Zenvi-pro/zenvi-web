import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { fakeInstall, loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";
import { TICKS_PER_SECOND } from "../testing/premiere-mock.js";

const H264 = "4E49434B_48323634";
const QUICKTIME = "4E49434B_4D6F6F56";

describe("premiere_capture_frame", () => {
  test("exports the playhead frame as a PNG in the temp folder and returns its path", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.sequence.setPlayerPosition(String(Math.round(2.5 * TICKS_PER_SECOND)));
    const receipt = fx.call("premiere_capture_frame", {});
    expect(receipt.status).toBe("ok");
    expect(receipt.summary).toBe('Captured 00:00:02:15 (2.5 s) of "Main" at 1920x1080');
    const image = String(receipt.data.image_path);
    expect(image.startsWith(path.join(fx.dir, "tmp", "zenvi-link"))).toBe(true);
    expect(path.basename(image)).toMatch(/^zenvi-frame-\d+-\d+\.png$/);
    expect(readFileSync(image).subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(receipt.data).toMatchObject({ time: 2.5, timecode: "00:00:02:15", frame: 75, width: 1920, height: 1080 });
    expect(fx.mock.state.qeCalls.some((call) => call.startsWith("sequence.exportFramePNG(00:00:02:15, zenvi-frame-"))).toBe(true);
    expect(receipt.undoSteps).toBe(0);
  });

  test("a time is snapped to a frame; drop-frame sequences format with semicolons", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.sequence.videoDisplayFormat = 102;
    const receipt = fx.call("premiere_capture_frame", { time: 1.01 });
    expect(receipt.data).toMatchObject({ time: 1, timecode: "00;00;01;00" });
    expect(receipt.warnings).toEqual(["Snapped time 1.01 s to the frame grid: 1 s (frame 30 at 30 fps)"]);
  });

  test("no file is an error; no exportFramePNG is unsupported", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    fx.mock.state.qeFrameExport = "silent";
    expect(fx.call("premiere_capture_frame", {})).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    const fx2 = loadPremiere();
    standardEdit(fx2);
    fx2.mock.state.qeFrameExport = "missing";
    expect(fx2.call("premiere_capture_frame", {}).error?.code).toBe("UNSUPPORTED");
  });
});

describe("premiere_export", () => {
  test("h264-high: finds Media Encoder's Match Source preset, queues the job and starts the batch", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    fx.mock.project.path = path.join(fx.dir, "work", "trip.prproj");
    const install = fakeInstall(fx, {
      premierePresets: [`${QUICKTIME}/H.264 Match Source.epr`],
      encoderPresets: [`${H264}/Match Source - High bitrate.epr`, `${H264}/Match Source - Adaptive High Bitrate.epr`, `${H264}/YouTube 1080p Full HD.epr`],
    });
    fx.mock.state.ameStatus = "ISNOTRUNNING";
    const receipt = fx.call("premiere_export", {});
    expect(receipt.status).toBe("applied");
    const output = path.join(fx.dir, "work", "Zenvi Exports", "Main.mp4");
    expect(receipt.data).toMatchObject({
      job: { id: "101", via: "media_encoder", status: "queued" },
      output,
      preset: { name: "Match Source - Adaptive High Bitrate", path: install.files[`${H264}/Match Source - Adaptive High Bitrate.epr`] },
      range: "entire",
    });
    expect(fx.mock.app.encoder?.jobs[0]).toMatchObject({ output, workArea: 0, removeOnCompletion: 1 });
    expect(fx.mock.app.encoder).toMatchObject({ launched: 1, started: 1 });
    expect(receipt.warnings).toEqual(["Started Adobe Media Encoder"]);
  });

  test("prores-422 direct: renders inside Premiere and checks the file", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    fakeInstall(fx, { premierePresets: [`${QUICKTIME}/Apple ProRes 422 HQ.epr`, `${QUICKTIME}/Apple ProRes 422.epr`, `${QUICKTIME}/Apple ProRes 4444.epr`] });
    const output = path.join(fx.dir, "out", "master");
    const receipt = fx.call("premiere_export", { preset: "prores-422", via: "direct", range: "in-out", output });
    expect(receipt.status).toBe("applied");
    expect(receipt.data).toMatchObject({ output: `${output}.mov`, job: { via: "direct", status: "done" }, preset: { name: "Apple ProRes 422" } });
    expect(fx.mock.state.calls).toContain(`exportAsMediaDirect(${output}.mov, Apple ProRes 422.epr, 1)`);
  });

  test("an .epr path is used as given; an existing output needs overwrite", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const preset = fx.file("custom.epr", "<epr/>");
    const output = fx.file("taken.mp4", "old");
    expect(fx.call("premiere_export", { preset, output }).summary).toContain("already exists; pass overwrite: true");
    const receipt = fx.call("premiere_export", { preset, output, overwrite: true, via: "direct" });
    expect(receipt.status).toBe("applied");
    expect(readFileSync(output, "utf8")).toBe("rendered");
  });

  test("h264-social-vertical needs a 9:16 sequence", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    fakeInstall(fx, { encoderPresets: [`${H264}/Match Source - Adaptive High Bitrate.epr`] });
    const refused = fx.call("premiere_export", { preset: "h264-social-vertical" });
    expect(refused.summary).toContain("needs a 9:16 sequence");
    fx.mock.project.addSequence({ name: "Reel", width: 1080, height: 1920 });
    expect(fx.call("premiere_export", { preset: "h264-social-vertical" }).status).toBe("applied");
  });

  test("no matching preset is refused with what is installed; no Media Encoder is refused", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    fakeInstall(fx, { encoderPresets: [`${H264}/YouTube 1080p Full HD.epr`], userPresets: ["My Preset.epr"] });
    const receipt = fx.call("premiere_export", { preset: "prores-422" });
    expect(receipt.error?.code).toBe("NOT_FOUND");
    expect(receipt.summary).toContain("Found 2 presets, e.g. YouTube 1080p Full HD, My Preset");
    fx.mock.state.ameStatus = "ISNOTINSTALLED";
    const preset = fx.file("custom.epr", "<epr/>");
    expect(fx.call("premiere_export", { preset }).summary).toContain("Adobe Media Encoder is not installed");
    expect(fx.mock.app.encoder?.jobs).toEqual([]);
  });
});

describe("premiere_export_xml", () => {
  test("writes FCP XML to a new temp file by default, with dialogs suppressed", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_export_xml", {});
    expect(receipt.status).toBe("applied");
    const file = String(receipt.data.path);
    expect(file.startsWith(path.join(fx.dir, "tmp", "zenvi-link", "Main-"))).toBe(true);
    expect(readFileSync(file, "utf8")).toContain('<xmeml version="4">');
    expect(fx.mock.state.calls).toContain(`exportAsFinalCutProXML(${file}, 1)`);
    expect(receipt.data).toMatchObject({ sequence_id: edit.sequence.sequenceID, name: "Main" });
    expect(receipt.undoSteps).toBe(0);
  });

  test("a chosen path; existing files need overwrite; other extensions are refused", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const target = path.join(fx.dir, "xml", "main.xml");
    expect(fx.call("premiere_export_xml", { output: target }).status).toBe("applied");
    expect(fx.call("premiere_export_xml", { output: target }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_export_xml", { output: target, overwrite: true }).status).toBe("applied");
    expect(fx.call("premiere_export_xml", { output: path.join(fx.dir, "main.fcpxml") }).error?.code).toBe("INVALID_ARGUMENT");
  });
});

describe("premiere_import_xml", () => {
  test("imports into Zenvi Imports, opens the new sequence and reports offline media", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const xml = fx.file(
      "zenvi.xml",
      '<?xml version="1.0"?><xmeml version="4"><sequence><name>Zenvi Timeline</name><media><file><pathurl>file:///missing/clip.mov</pathurl></file></media></sequence></xmeml>',
    );
    const receipt = fx.call("premiere_import_xml", { path: xml });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Imported "zenvi.xml": "Zenvi Timeline" (1920x1080, 30 fps, 12 s), opened');
    expect(receipt.data).toMatchObject({ sequences: [expect.objectContaining({ name: "Zenvi Timeline" })], offline: [{ name: "clip.mov" }], created_bins: ["Zenvi Imports"] });
    expect(receipt.warnings).toEqual(["1 media item offline (missing at the XML's paths): clip.mov"]);
    expect(fx.mock.project.activeSequence?.name).toBe("Zenvi Timeline");
  });

  test("refusals and failures: not .xml, missing, no sequence imported", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    expect(fx.call("premiere_import_xml", { path: fx.file("a.edl") }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_import_xml", { path: "/nope/a.xml" }).error?.code).toBe("NOT_FOUND");
    const xml = fx.file("empty.xml", "<xmeml/>");
    fx.mock.project.importFiles = () => true;
    const receipt = fx.call("premiere_import_xml", { path: xml, bin: "/" });
    expect(receipt).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
  });
});

describe("files the tools write", () => {
  test("export paths are created; stale frame files are replaced", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const target = path.join(fx.dir, "deep", "er", "main.xml");
    fx.call("premiere_export_xml", { output: target });
    expect(existsSync(target)).toBe(true);
    writeFileSync(path.join(fx.dir, "tmp", "keep.txt"), "x");
    expect(fx.call("premiere_capture_frame", {}).status).toBe("ok");
  });
});
