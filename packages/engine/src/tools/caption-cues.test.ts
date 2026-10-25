import { describe, expect, it } from "vitest";
import { buildCaptionText, displayText, drawnLines, formatCueTime, parseCaptionText, safeText } from "./caption-cues.js";
import { captionTop, CaptionStyle, isHeavyFont, styleFromEffect, THIN_OUTLINE } from "./caption-style.js";
import { createProject } from "../model/defaults.js";
import type { Effect } from "../model/types.js";

const SRT = `1
00:00:00,500 --> 00:00:03,000
Welcome back to my channel.

2
00:00:03,200 --> 00:00:07,500
Today we are exploring the city.

3
00:00:07,700 --> 00:00:11,000
First stop: my favorite coffee shop.
`;

// Ported from zenvi-core develop tests/test_editor_tools_titles_text_captions.py (caption_cues).
describe("caption cue text (caption_cues.py)", () => {
  it("round-trips the Captions dock's format", () => {
    const text = buildCaptionText([
      { start: 0.5, end: 3, text: "Welcome back" },
      { start: 3.2, end: 7.5, text: "Two\nlines" },
    ]);
    expect(text.startsWith("00:00:00:500 --> 00:00:03:000\nWelcome back\n\n00:00:03:200 --> 00:00:07:500\nTwo\nlines")).toBe(true);
    expect(parseCaptionText(text)).toEqual([
      { start: 0.5, end: 3, text: "Welcome back" },
      { start: 3.2, end: 7.5, text: "Two\nlines" },
    ]);
    expect(formatCueTime(1.001)).toBe("00:00:01:001");
    expect(formatCueTime(3725.5)).toBe("01:02:05:500");
    expect(buildCaptionText([])).toBe("");
  });

  it("reads raw SRT like libopenshot does", () => {
    const cues = parseCaptionText(SRT);
    expect(cues.map((c) => c.start)).toEqual([0.5, 3.2, 7.7]);
    // The SRT index line "2" follows the first cue's text; libopenshot draws only lines longer than one character.
    expect(drawnLines(cues[0]!.text)).toEqual(["Welcome back to my channel."]);
  });

  it("would cut a cue at a time in its text; safeText prevents it", () => {
    expect(parseCaptionText("00:00:01:000 --> 00:00:04:000\nMeet at 10:30 today\n\n")[0]!.text).toBe("Meet at");
    const [safe, changed] = safeText("Meet at 10:30 today");
    expect(changed).toBe(true);
    expect(safe).toBe("Meet at 10​:30 today");
    const text = buildCaptionText([{ start: 1, end: 4, text: safe }]);
    expect(displayText(parseCaptionText(text)[0]!.text)).toBe("Meet at 10:30 today");
    expect(displayText("old 10∶30 style")).toBe("old 10:30 style");
  });

  it("keeps one-letter and NOTE lines drawable", () => {
    const [safe, changed] = safeText("I\n\nNOTE: this matters");
    expect(changed).toBe(true);
    const lines = safe.split("\n");
    expect(drawnLines(safe)).toEqual(lines);
    expect(lines).toHaveLength(2);
    expect(displayText(safe)).toBe("I\nNOTE: this matters");
    expect(safeText("🔥")[0]).toBe("🔥"); // two UTF-16 units: already drawn
  });
});

describe("caption styles (titles_text_captions.py CaptionStyle)", () => {
  it("maps a preset to Caption properties on a vertical frame", () => {
    const project = createProject({ profile: "FHD Vertical 1080p 30 fps" });
    const style = new CaptionStyle({ style: "reels" });
    style.resolveFont();
    const props = style.properties(project, 2) as Record<string, { Points: { co: { Y: number } }[] }>;
    // 0.075 of the 1080 px short side = 81 px; Caption scales by width / 600 -> 45.
    expect(props.font_size!.Points[0]!.co.Y).toBe(45);
    expect(props.caption_font as unknown).toBe("Arial Black");
    expect(props.stroke_width!.Points[0]!.co.Y).toBeGreaterThan(0);
    expect(props.background_alpha!.Points[0]!.co.Y).toBe(0);
    const top = props.top!.Points[0]!.co.Y;
    expect(top).toBeGreaterThan(0.6);
    expect(top).toBeLessThan(0.8);
  });

  it("thins a preset outline on a font that is not heavy, unless asked for", () => {
    const yellow = new CaptionStyle({ style: "yellow", font: "Georgia" });
    yellow.resolveFont();
    expect(yellow.summary().stroke_width).toBe(THIN_OUTLINE);
    const explicit = new CaptionStyle({ style: "yellow", font: "Georgia", stroke_width: 0.1 });
    explicit.resolveFont();
    expect(explicit.summary().stroke_width).toBe(0.1);
    expect(isHeavyFont("Arial Black")).toBe(true);
  });

  it("reads a look back from an effect and restyles on top of it", () => {
    const project = createProject({ profile: "FHD 1080p 30 fps" });
    const style = new CaptionStyle({ style: "boxed", background_color: "#ff000080" });
    const effect = { id: "E", class_name: "Caption", type: "Caption", ...style.properties(project) } as unknown as Effect;
    const look = styleFromEffect(effect, project);
    expect(look).toMatchObject({ text_size: 0.05, background_color: "#ff0000", background_opacity: 0.502, position: "bottom", padding: 0.45, corner: 0.05 });
    const restyled = new CaptionStyle({ style: "", position: "top" }, look);
    expect(restyled.summary()).toMatchObject({ background_color: "#ff0000", position: "top" });
    expect(captionTop("top", 54, 1, 1080, 2, false)).toBeLessThan(0.12);
  });

  it("refuses unknown looks", () => {
    expect(() => new CaptionStyle({ style: "comic" })).toThrow("style must be one of ['boxed', 'classic', 'minimal', 'reels', 'yellow']");
    expect(() => new CaptionStyle({ position: "middle" })).toThrow("position must be one of ['bottom', 'center', 'top']");
    expect(() => new CaptionStyle({ text_color: "nope" })).toThrow("text_color: unrecognised color 'nope'");
  });
});
