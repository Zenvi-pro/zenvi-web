import { describe, expect, test } from "vitest";
import { ImportOptions, ParagraphJustification, type FootageItem, type Property, type PropertyGroup, type TextDocument, type TextLayer } from "../testing/ae-mock.js";
import { aeHarness } from "../testing/ae-harness.js";

function doc(layer: TextLayer): TextDocument {
  return ((layer.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Document") as Property).value as TextDocument;
}

/** Where the layer's first baseline (layer y = 0) and left edge land in the comp. */
function baseline(layer: TextLayer): [number, number] {
  const anchor = Array.from(layer.anchorPoint.value as number[]);
  const position = Array.from(layer.position.value as number[]);
  return [(position[0] as number) - (anchor[0] as number), (position[1] as number) - (anchor[1] as number)];
}

describe("ae_add_text", () => {
  test("a lazy call is a centred TASTE title: 72 px bold, -10 tracking, 1.1 leading, paper fill, inside title-safe", () => {
    const h = aeHarness();
    const comp = h.mock.addComp({ name: "Promo" });
    const receipt = h.callValidated("ae_add_text", { text: "Launch day" });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(receipt.data).toMatchObject({
      name: "Launch day",
      type: "text",
      style: "title",
      font: "HelveticaNeue-Bold",
      size: 72,
      placement: "center",
      justification: "center",
      shadow: false,
      in_point: 0,
      out_point: 10,
      block: { left: 744, top: 504, width: 432, height: 72, inside_title_safe: true },
    });
    expect(receipt.warnings).toEqual([]);
    const layer = comp.layer(1) as TextLayer;
    const text = doc(layer);
    expect(text).toMatchObject({ font: "HelveticaNeue-Bold", fontSize: 72, tracking: -10, leading: 79.2, justification: ParagraphJustification.CENTER_JUSTIFY });
    expect(Array.from(text.fillColor, (c) => Math.round(c * 255))).toEqual([247, 247, 245]);
    expect(Array.from(layer.position.value as number[])).toEqual([960, 540, 0]);
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Add text"]);
  });

  test("lower third: name at title-safe left with its baseline at 80 %, role 34 px below with a 0.25 x name-size gap, 5 s on screen", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const receipt = h.callValidated("ae_add_text", { text: "Jane Doe", subtitle: "Director", placement: "lower-third" });
    expect(receipt.data).toMatchObject({ style: "lower-third", size: 54, justification: "left", out_point: 5, block: { left: 192, inside_title_safe: true } });
    const name = comp.layer(2) as TextLayer;
    const role = comp.layer(1) as TextLayer;
    expect(baseline(name)).toEqual([192, 864]);
    expect(doc(role)).toMatchObject({ fontSize: 34, font: "HelveticaNeue" });
    expect(role.name).toBe("Jane Doe (subtitle)");
    // Role top = name bottom + 13.5 px gap.
    const nameRect = name.sourceRectAtTime(0, false);
    const roleRect = role.sourceRectAtTime(0, false);
    const nameBottom = baseline(name)[1] + nameRect.top + nameRect.height;
    const roleTop = baseline(role)[1] + roleRect.top;
    expect(roleTop - nameBottom).toBeCloseTo(13.5, 5);
    expect(role.outPoint).toBe(5);
  });

  test("vertical 9:16: lower-third baseline at 70 %, text kept out of the top 12 % / bottom 20 %", () => {
    const h = aeHarness();
    const comp = h.mock.addComp({ width: 1080, height: 1920 });
    const receipt = h.callValidated("ae_add_text", { text: "Jane Doe", placement: "lower-third" });
    expect(baseline(comp.layer(1) as TextLayer)).toEqual([108, 1344]);
    expect(receipt.data.block).toMatchObject({ title_safe: { left: 108, top: 230.4, right: 972, bottom: 1536 } });
    const top = h.callValidated("ae_add_text", { text: "Top", placement: "top-center" });
    expect(top.data.block).toMatchObject({ top: 230.4 });
  });

  test("long text breaks at balanced word boundaries; too-wide text shrinks to fit title-safe", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const broken = h.callValidated("ae_add_text", { text: "The quick brown fox jumps over the lazy dog again" });
    expect(broken.data.text).toBe("The quick brown fox jumps\nover the lazy dog again");
    expect(doc(comp.layer(1) as TextLayer).text).toBe("The quick brown fox jumps\rover the lazy dog again");
    expect(broken.warnings[0]).toContain("Broke the text into 2 lines");

    const kept = h.callValidated("ae_add_text", { text: "The quick brown fox jumps over the lazy dog again", auto_break: false, style: "caption" });
    expect(kept.data.text).toBe("The quick brown fox jumps over the lazy dog again");

    const wide = h.callValidated("ae_add_text", { text: "Supercalifragilisticexpialidocious!!!!!!", style: "headline" });
    expect(wide.data).toMatchObject({ size: 62, block: { inside_title_safe: true } });
    expect(wide.warnings.join(" ")).toContain("reduced its size from 96 to 62 px");
  });

  test("ALL CAPS labels get +80 tracking; a short hold warns about reading time", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const receipt = h.callValidated("ae_add_text", { text: "NEW EPISODE", style: "caption", duration: 1 });
    expect(doc(comp.layer(1) as TextLayer).tracking).toBe(80);
    expect(receipt.warnings.join(" ")).toContain("shorter than its reading time (2.1 s for 2 words");
  });

  test("fonts: Inter when installed, a missing requested font falls back with a warning, nothing installed keeps After Effects' font", () => {
    const withInter = aeHarness({ fonts: ["Inter-Bold", "Inter-Regular", "ArialMT"] });
    withInter.mock.addComp();
    expect(withInter.callValidated("ae_add_text", { text: "Hi" }).data.font).toBe("Inter-Bold");

    const h = aeHarness();
    h.mock.addComp();
    const missing = h.callValidated("ae_add_text", { text: "Hi", font: "Futura-Bold" });
    expect(missing.data.font).toBe("HelveticaNeue-Bold");
    expect(missing.warnings).toContain("Font Futura-Bold is not installed; used HelveticaNeue-Bold");

    const none = aeHarness({ fonts: [] });
    none.mock.addComp();
    const bare = none.callValidated("ae_add_text", { text: "Hi" });
    expect(bare.data.font).toBe("ArialMT");
    expect(bare.warnings[0]).toContain("None of Inter-Bold, SFProDisplay-Bold, HelveticaNeue-Bold, Arial-BoldMT is installed");
  });

  test("before After Effects 24 (no font list) a font that does not take is skipped", () => {
    const h = aeHarness({ version: "23.6x1" });
    const comp = h.mock.addComp();
    expect(h.callValidated("ae_add_text", { text: "Hi" }).data.font).toBe("HelveticaNeue-Bold");
    expect(doc(comp.layer(1) as TextLayer).font).toBe("HelveticaNeue-Bold");
  });

  test("over footage: a soft TASTE shadow (distance 0, 16 px, 40 %); an entrance preset at the start", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const clip = h.mock.project.importFile(new ImportOptions(new h.mock.es.File(h.file("beach.mov")))) as FootageItem;
    comp.layers.add(clip);
    const receipt = h.callValidated("ae_add_text", { text: "Sunset", animation: "slide-in", start: 1 });
    expect(receipt.data).toMatchObject({ shadow: true, animation: "slide-in", in_point: 1 });
    expect(receipt.data.animations).toEqual([expect.objectContaining({ preset: "slide-in", start: 1, end: 1.6 })]);
    const layer = comp.layer(1) as TextLayer;
    const shadow = (layer.property("ADBE Effect Parade") as PropertyGroup).property("Zenvi Shadow") as PropertyGroup;
    expect((shadow.property("Opacity") as Property).value).toBe(102);
    expect((shadow.property("Distance") as Property).value).toBe(0);
    expect((shadow.property("Softness") as Property).value).toBe(16);
    expect(layer.opacity.numKeys).toBe(2);
  });

  test("refuses empty text and a start after the comp", () => {
    const h = aeHarness();
    h.mock.addComp({ duration: 5 });
    expect(h.call("ae_add_text", { text: "   " })).toMatchObject({ status: "refused", undoSteps: 0 });
    expect(h.callValidated("ae_add_text", { text: "Hi", start: 6 })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.mock.state.undoDepth).toBe(0);
  });
});

describe("ae_set_text", () => {
  test("changes text, size, fill, stroke and tracking; before and after in the receipt", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const layer = comp.layers.addText("Old");
    const receipt = h.callValidated("ae_set_text", { layer: layer.id, text: "New\nline", size: 60, fill: "#FF5A36", stroke: "#000000", stroke_width: 3, tracking: 20 });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(receipt.data.before).toMatchObject({ text: "Old", size: 36 });
    expect(receipt.data.after).toMatchObject({ text: "New\nline", size: 60, fill: "#FF5A36", stroke: "#000000", stroke_width: 3, tracking: 20 });
    expect(h.callValidated("ae_set_text", { layer: layer.id, stroke: null }).data.after).toMatchObject({ stroke: null });
  });

  test("keyframed Source Text needs a time and gets a keyframe there", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const layer = comp.layers.addText("A");
    const source = (layer.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Document") as Property;
    source.setValueAtTime(0, source.value);
    expect(h.callValidated("ae_set_text", { layer: layer.id, text: "B" })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    h.callValidated("ae_set_text", { layer: layer.id, text: "B", time: 2 });
    expect(source.numKeys).toBe(2);
    expect((source.keyValue(2) as TextDocument).text).toBe("B");
    // A time after the comp is refused before anything changes (no partial-change warning).
    const late = h.callValidated("ae_set_text", { layer: layer.id, text: "C", time: 99 });
    expect(late).toMatchObject({ status: "refused", undoSteps: 0, warnings: [] });
    expect(source.numKeys).toBe(2);
  });

  test("refuses a non-text layer and an empty change", () => {
    const h = aeHarness();
    const comp = h.mock.addComp();
    const solid = comp.layers.addSolid([1, 1, 1], "S", 10, 10, 1);
    const text = comp.layers.addText("T");
    expect(h.callValidated("ae_set_text", { layer: solid.id, text: "x" })).toMatchObject({ status: "refused" });
    expect(h.callValidated("ae_set_text", { layer: text.id })).toMatchObject({ status: "refused", error: { message: expect.stringContaining("Nothing to change") } });
  });
});

describe("line breaking", () => {
  test("balanced lines of at most 32 characters, no orphan, existing breaks kept", () => {
    const h = aeHarness();
    const breakLines = (text: string) => JSON.parse(h.host.evaluate(`JSON.stringify(ZenviLink.ae.breakLines(${JSON.stringify(text)}, 32))`) as string);
    expect(breakLines("Short title")).toEqual({ text: "Short title", lines: 1, broke: false });
    expect(breakLines("Line one\nLine two")).toEqual({ text: "Line one\rLine two", lines: 2, broke: false });
    const three = breakLines("Every frame of this film was made by a small team over three summers").text.split("\r");
    expect(three.length).toBe(3);
    for (const line of three) expect(line.length).toBeLessThanOrEqual(32);
    expect(three.every((line: string) => line.includes(" "))).toBe(true);
  });

  test("a word longer than a line (a URL) gets a line of its own instead of failing", () => {
    const h = aeHarness();
    const breakLines = (text: string) => JSON.parse(h.host.evaluate(`JSON.stringify(ZenviLink.ae.breakLines(${JSON.stringify(text)}, 32))`) as string);
    const url = "https://example.com/campaigns/2026/autumn/launch-film";
    expect(breakLines(`Watch ${url}`)).toEqual({ text: `Watch\r${url}`, lines: 2, broke: true, longest: url.length });
    // The rest still shares lines: not one word per line.
    expect(breakLines(`Watch the film at ${url} today`).text).toBe(`Watch the film at\r${url}\rtoday`);
    h.mock.addComp();
    const receipt = h.callValidated("ae_add_text", { text: `Watch the film at ${url} today` });
    expect(receipt.status).toBe("applied");
    expect(receipt.data.text).toBe(`Watch the film at\n${url}\ntoday`);
    expect(receipt.warnings[0]).toContain(`one word is ${url.length} characters`);
  });
});
