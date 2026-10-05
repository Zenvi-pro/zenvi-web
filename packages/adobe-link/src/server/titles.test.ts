import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { TASTE } from "../taste.js";
import { FakeCanvas, fakeDocument } from "../testing/fake-canvas.js";
import { titlesModule, type TitleLayout } from "../testing/link-server.js";

const { layoutTitle, drawTitle, wrapLines, createCanvasRenderer, createTitlePreparer, titleFileName } = titlesModule;

/** What the host script's titleFrame sends: TASTE as injected into the host script (plain JSON). */
const taste = JSON.parse(JSON.stringify({ type: TASTE.type, layout: TASTE.layout, color: { palette: TASTE.color.palette } }));

/** 0.55 em per character, like the fake canvas. */
const measure = (font: string, text: string): number => text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]) * 0.55;

const layout = (args: Record<string, unknown>, width = 1920, height = 1080): TitleLayout =>
  layoutTitle({ style: "title", color: TASTE.color.palette.paper, ...args, width, height, taste }, measure);

describe("line breaks (TASTE 4)", () => {
  test("break at 32 characters on word boundaries, keep explicit breaks", () => {
    expect(wrapLines("Three things nobody tells you about editing", 32)).toEqual(["Three things nobody tells you", "about editing"]);
    expect(wrapLines("Ada Lovelace\nMathematician", 32)).toEqual(["Ada Lovelace", "Mathematician"]);
    expect(wrapLines("  Short  ", 32)).toEqual(["Short"]);
  });

  test("never leave a single word on the last line", () => {
    expect(wrapLines("abcdefg hijklmn opqrstu vwxyzab cdefghi", 32)).toEqual(["abcdefg hijklmn opqrstu", "vwxyzab cdefghi"]);
  });
});

describe("layoutTitle", () => {
  test("TASTE sizes and weights scale with the short side; vertical keeps the 1080 sizes", () => {
    expect(layout({}).font).toBe('700 72px Inter, "SF Pro Display", "Helvetica Neue", Arial, sans-serif');
    expect(layout({ style: "headline" })).toMatchObject({ fontSize: 96, weight: 800 });
    expect(layout({ style: "subtitle" })).toMatchObject({ fontSize: 44, weight: 500 });
    expect(layout({}, 3840, 2160).fontSize).toBe(144);
    expect(layout({}, 1080, 1920).fontSize).toBe(72);
    expect(layout({ font_size: 50, font: "Futura PT", weight: 600 }).font).toBe('600 50px "Futura PT", sans-serif');
  });

  test("centered titles sit in the middle of the frame", () => {
    const title = layout({ text: "Launch day" });
    expect(title).toMatchObject({ placement: "center", align: "center" });
    expect(title.lines).toEqual([{ text: "Launch day", x: 960, y: expect.any(Number), width: 10 * 72 * 0.55 }]);
    const blockTop = title.lines[0]!.y - 0.8 * 72;
    const blockBottom = title.lines[0]!.y + 0.22 * 72;
    expect((blockTop + blockBottom) / 2).toBeCloseTo(540, 5);
  });

  test("lower thirds start at title-safe x with the last baseline at 80 % (70 % on 9:16)", () => {
    const landscape = layout({ text: "Ada Lovelace\nMathematician", style: "lower-third" });
    expect(landscape).toMatchObject({ placement: "lower-third", align: "left", fontSize: 54 });
    expect(landscape.lines.map((line) => line.x)).toEqual([192, 192]);
    expect(landscape.lines[1]!.y).toBeCloseTo(864, 5);
    expect(landscape.lines[1]!.y - landscape.lines[0]!.y).toBeCloseTo(54 * TASTE.type.leading.headline, 5);
    const vertical = layout({ text: "Ada Lovelace", style: "lower-third" }, 1080, 1920);
    expect(vertical.lines[0]).toMatchObject({ x: 108, y: 1344 });
  });

  test("top and bottom placements respect title-safe and the 9:16 safe area", () => {
    const top = layout({ text: "Hook", placement: "top-center" }, 1080, 1920);
    expect(top.lines[0]!.y - 0.8 * 72).toBeCloseTo(1920 * 0.12, 5);
    const bottom = layout({ text: "Subscribe", placement: "bottom-center" });
    expect(bottom.lines[0]!.y + 0.22 * 72).toBeCloseTo(1080 * 0.9, 5);
    expect(layout({ text: "Corner", placement: "top-left" }).lines[0]).toMatchObject({ x: 192, y: 108 + 0.8 * 72 });
  });

  test("a line too wide for title-safe shrinks the type and says so", () => {
    const wide = layout({ text: "Supercalifragilisticexpialidocious", style: "headline" });
    expect(wide.fontSize).toBeLessThan(96);
    expect(Math.max(...wide.lines.map((line) => line.width))).toBeLessThanOrEqual(1920 * 0.8);
    expect(wide.warnings).toEqual([`Shrank the title from 96 px to ${wide.fontSize} px to keep it inside title-safe`]);
  });

  test("contrast: a soft shadow by default (TASTE 4), an optional box and stroke", () => {
    expect(layout({ text: "x" }).shadow).toEqual({ color: "rgba(0, 0, 0, 0.4)", blur: 16, offset: 0 });
    expect(layout({ text: "x" }, 3840, 2160).shadow?.blur).toBe(32);
    expect(layout({ text: "x", shadow: false }).shadow).toBeNull();
    const boxed = layout({ text: "Busy footage", box: {} });
    expect(boxed.box).toMatchObject({ color: "rgba(11, 11, 15, 0.45)" });
    expect(boxed.lines[0]!.y - 0.8 * 72 - (boxed.box?.y ?? 0)).toBeCloseTo(Math.round(0.4 * 72), 5);
    expect(layout({ text: "x", stroke: { color: [0, 0, 0], width: 3 }, color: "#FF5A36" })).toMatchObject({
      stroke: { color: "rgba(0, 0, 0, 1)", width: 3 },
      fill: "rgba(255, 90, 54, 1)",
    });
  });
});

describe("drawing", () => {
  test("drawTitle sizes the canvas to the frame and draws stroke, then fill, per line", () => {
    const canvas = new FakeCanvas();
    const title = layout({ text: "Ada Lovelace\nMathematician", style: "lower-third", stroke: { color: "#000000", width: 2 } });
    drawTitle(canvas, title);
    expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
    expect(canvas.ops.map((op) => `${op.op}:${op.text ?? ""}`)).toEqual([
      "clearRect:",
      "strokeText:Ada Lovelace",
      "fillText:Ada Lovelace",
      "strokeText:Mathematician",
      "fillText:Mathematician",
    ]);
    const fill = canvas.ops.find((op) => op.op === "fillText");
    expect(fill).toMatchObject({ x: 192, textAlign: "left", font: title.font, fillStyle: title.fill, shadowBlur: 16, shadowColor: "rgba(0, 0, 0, 0.4)" });
  });

  test("headlines get TASTE tracking where the canvas supports letterSpacing", () => {
    const canvas = new FakeCanvas();
    drawTitle(canvas, layout({ text: "Big", style: "headline" }));
    expect(canvas.ops.find((op) => op.op === "fillText")?.letterSpacing).toBe(`${-0.015 * 96}px`);
  });

  test("the canvas renderer returns the PNG at the frame size", () => {
    const document = fakeDocument();
    const renderer = createCanvasRenderer(document);
    const png = renderer.render(layout({ text: "Launch day" }));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1920, 1080]);
    expect(renderer.measure("700 72px Inter", "abc")).toBeCloseTo(3 * 72 * 0.55, 5);
  });

  test("file names are readable and change with what is drawn", () => {
    const a = titleFileName("Launch day!", layout({ text: "Launch day!" }));
    expect(a).toMatch(/^launch-day-[0-9a-f]{10}\.png$/);
    expect(titleFileName("Launch day!", layout({ text: "Launch day!" }))).toBe(a);
    expect(titleFileName("Launch day!", layout({ text: "Launch day!", color: "#FF5A36" }))).not.toBe(a);
  });
});

describe("the premiere_add_text preparer", () => {
  const frame = (project: string | null) => JSON.stringify({ ok: true, width: 1920, height: 1080, sequence_id: "seq-1", project, taste });

  test("renders next to a saved project and hands the host script `image` for that sequence", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "zenvi-titles-"));
    const prepare = createTitlePreparer({ renderer: createCanvasRenderer(fakeDocument()) });
    const scripts: string[] = [];
    const result = await prepare({
      args: { text: "Launch day", style: "title", color: "#F7F7F5" },
      evalScript: async (script) => (scripts.push(script), frame(path.join(root, "trip.prproj"))),
      tempDir: path.join(root, "tmp"),
    });
    expect(scripts).toEqual(['ZenviLink.ppro.titleFrame("{\\"sequence\\":null}")']);
    const file = String(result?.args?.image);
    expect(path.dirname(file)).toBe(path.join(root, "Zenvi Titles"));
    expect(readFileSync(file).subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(result).toMatchObject({ args: { sequence: "seq-1", text: "Launch day" }, warnings: [], data: { source: "rendered", rendered: { path: file, width: 1920, height: 1080, lines: ["Launch day"], font_size: 72 } } });
  });

  test("an unsaved project gets the temp folder and a warning", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "zenvi-titles-"));
    const prepare = createTitlePreparer({ renderer: createCanvasRenderer(fakeDocument()) });
    const result = await prepare({ args: { text: "Draft" }, evalScript: async () => frame(null), tempDir: path.join(root, "tmp") });
    expect(path.dirname(String(result?.args?.image))).toBe(path.join(root, "tmp", "titles"));
    expect(result?.warnings?.join(" ")).toContain("The project is not saved yet");
  });

  test("leaves image and mogrt calls, missing sequences and failed renders to the host script", async () => {
    const prepare = createTitlePreparer({ renderer: createCanvasRenderer(fakeDocument()) });
    let asked = 0;
    const evalScript = async () => (asked += 1, JSON.stringify({ ok: false }));
    expect(await prepare({ args: { text: "x", image: "/a.png" }, evalScript, tempDir: os.tmpdir() })).toBeNull();
    expect(await prepare({ args: { text: "  \n " }, evalScript, tempDir: os.tmpdir() })).toBeNull();
    expect(await prepare({ args: { text: "x", mogrt: "/a.mogrt" }, evalScript, tempDir: os.tmpdir() })).toBeNull();
    expect(asked).toBe(0);
    expect(await prepare({ args: { text: "x" }, evalScript, tempDir: os.tmpdir() })).toBeNull();
    const broken = createTitlePreparer({ renderer: { measure, render: () => { throw new Error("no canvas"); } } });
    const failed = await broken({ args: { text: "x" }, evalScript: async () => frame(null), tempDir: mkdtempSync(path.join(os.tmpdir(), "zenvi-titles-")) });
    expect(failed).toEqual({ warnings: ["Could not render the title image: no canvas"] });
  });

  test("the same title is rendered once and reused", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "zenvi-titles-"));
    const document = fakeDocument();
    const prepare = createTitlePreparer({ renderer: createCanvasRenderer(document) });
    const call = () => prepare({ args: { text: "Again" }, evalScript: async () => frame(path.join(root, "p.prproj")), tempDir: root });
    const first = await call();
    const rendered = document.canvases.length;
    const second = await call();
    expect(second?.args?.image).toBe(first?.args?.image);
    expect(existsSync(String(first?.args?.image))).toBe(true);
    expect(document.canvases.length).toBe(rendered);
  });
});
