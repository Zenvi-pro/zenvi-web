/**
 * Caption looks: the style presets of zenvi-core's caption tools and their
 * mapping to libopenshot Caption effect properties
 * (src/classes/editor_tools/titles_text_captions.py `CAPTION_STYLES`,
 * `CaptionStyle`, `caption_top`, `style_from_effect`).
 *
 * Sizes are frame-relative: text size is a fraction of the frame's shorter
 * side; outline, padding and corner are fractions of the text size. Caption
 * scales every size by frame width / 600, so stored sizes are in those units.
 */

import type { Effect, Project } from "../model/types.js";
import { pyRound } from "../model/rounding.js";
import { colorHexAlpha, colorKeyframes, constantKeyframe, isVertical, keyframeValueAt, projectSize, pyRoundTo, toolError } from "./titles-text.js";

export interface CaptionLook {
  text_size: number;
  text_color: string;
  stroke_color: string;
  stroke_width: number;
  background_color: string;
  background_opacity: number;
  position: string;
  font: string;
  padding: number;
  corner: number;
  fade: number;
  text_alpha?: number;
  line_spacing?: number;
}

export const CAPTION_STYLES: Readonly<Record<string, Readonly<CaptionLook>>> = {
  classic: { text_size: 0.05, text_color: "#ffffff", stroke_color: "#000000", stroke_width: 0.0, background_color: "#000000", background_opacity: 0.6, position: "bottom", font: "", padding: 0.35, corner: 0.15, fade: 0.0 },
  reels: { text_size: 0.075, text_color: "#ffffff", stroke_color: "#000000", stroke_width: 0.09, background_color: "#000000", background_opacity: 0.0, position: "bottom", font: "Arial Black", padding: 0.3, corner: 0.15, fade: 0.0 },
  minimal: { text_size: 0.045, text_color: "#ffffff", stroke_color: "#202020", stroke_width: 0.035, background_color: "#000000", background_opacity: 0.0, position: "bottom", font: "", padding: 0.3, corner: 0.15, fade: 0.1 },
  yellow: { text_size: 0.055, text_color: "#ffe14d", stroke_color: "#000000", stroke_width: 0.07, background_color: "#000000", background_opacity: 0.0, position: "bottom", font: "Arial Black", padding: 0.3, corner: 0.15, fade: 0.0 },
  boxed: { text_size: 0.05, text_color: "#ffffff", stroke_color: "#000000", stroke_width: 0.0, background_color: "#000000", background_opacity: 0.85, position: "bottom", font: "", padding: 0.45, corner: 0.05, fade: 0.0 },
};

export const CAPTION_POSITIONS = ["bottom", "center", "top"] as const;

/** libopenshot fills then strokes each glyph, so thick outlines only read on heavy fonts. */
const HEAVY_FONT_HINTS = ["black", "heavy", "impact", "extrabold", "ultra"];
/** Preset outlines are thinned to this on fonts that are not heavy. */
export const THIN_OUTLINE = 0.035;

export function isHeavyFont(font: string): boolean {
  const low = String(font ?? "").toLowerCase();
  return HEAVY_FONT_HINTS.some((hint) => low.includes(hint));
}

/** The style arguments of add/edit_captions_tool, with the desktop's "keep" sentinels (0, "", -1). */
export interface CaptionStyleArgs {
  style?: string;
  font?: string;
  text_size?: number;
  text_color?: string;
  stroke_color?: string;
  stroke_width?: number;
  background_color?: string;
  background_opacity?: number;
  position?: string;
  fade_seconds?: number;
}

/** True when the arguments ask for any look change (`edit_captions`'s `restyle`). */
export function restyleRequested(args: CaptionStyleArgs): boolean {
  return Boolean(
    args.style ||
      args.font ||
      args.text_size ||
      String(args.text_color ?? "").trim() ||
      String(args.stroke_color ?? "").trim() ||
      (args.stroke_width ?? -1) >= 0 ||
      String(args.background_color ?? "").trim() ||
      (args.background_opacity ?? -1) >= 0 ||
      args.position ||
      (args.fade_seconds ?? -1) >= 0,
  );
}

/** `caption_top`: the top margin that puts a block of `lines` at the bottom / centre / top safe area. */
export function captionTop(position: string, fontPx: number, lineSpacing: number, height: number, lines: number, vertical: boolean): number {
  const ls = 1.2 * fontPx;
  const h = height;
  let top: number;
  if (position === "top") {
    const safe = vertical ? 0.12 : 0.06;
    top = safe - (0.45 * fontPx) / h;
  } else if (position === "center") {
    top = 0.5 - (ls - 0.25 * fontPx) / h;
  } else {
    const safe = vertical ? 0.2 : 0.08;
    const block = ls + Math.max(0, lines - 1) * ls * lineSpacing + 0.3 * fontPx;
    top = 1 - safe - block / h;
  }
  return Math.max(0, Math.min(0.95, top));
}

/** `CaptionStyle`: a resolved caption look that converts to Caption properties. */
export class CaptionStyle {
  readonly values: CaptionLook;
  readonly textAlpha: number;
  private readonly explicitStroke: boolean;

  constructor(args: CaptionStyleArgs, base?: CaptionLook) {
    const preset = args.style ?? "classic";
    if (preset && !(preset in CAPTION_STYLES)) toolError(`style must be one of [${Object.keys(CAPTION_STYLES).sort().map((s) => `'${s}'`).join(", ")}]`);
    const values: CaptionLook = { ...(base ?? CAPTION_STYLES[preset || "classic"]!) };
    if (preset && base !== undefined) {
      Object.assign(values, CAPTION_STYLES[preset]);
      values.text_alpha = 1;
    }
    if (args.text_size) values.text_size = Number(args.text_size);
    if (args.font) values.font = String(args.font).trim();
    if (String(args.text_color ?? "").trim()) [values.text_color, values.text_alpha] = colorHexAlpha(args.text_color, "text_color");
    if (String(args.stroke_color ?? "").trim()) values.stroke_color = colorHexAlpha(args.stroke_color, "stroke_color")[0];
    this.explicitStroke = (args.stroke_width ?? -1) >= 0;
    if (this.explicitStroke) values.stroke_width = Number(args.stroke_width);
    if (String(args.background_color ?? "").trim()) {
      const [hex, alpha] = colorHexAlpha(args.background_color, "background_color");
      values.background_color = hex;
      // '#RRGGBBAA' says how opaque the box is; naming a box colour asks for a visible box.
      if (alpha < 1) values.background_opacity = alpha;
      else if ((Number(values.background_opacity) || 0) <= 0) values.background_opacity = 0.6;
    }
    if ((args.background_opacity ?? -1) >= 0) values.background_opacity = Number(args.background_opacity);
    this.textAlpha = Number(values.text_alpha ?? 1);
    if (args.position) {
      if (!(CAPTION_POSITIONS as readonly string[]).includes(args.position)) toolError(`position must be one of ['bottom', 'center', 'top']`);
      values.position = args.position;
    }
    if ((args.fade_seconds ?? -1) >= 0) values.fade = Number(args.fade_seconds);
    this.values = values;
  }

  /**
   * `resolve_font` with no font list (web hosts cannot tell which fonts are
   * installed): the font is kept as given; a preset outline is thinned on a
   * font that is not heavy unless the caller asked for that outline.
   */
  resolveFont(): void {
    const v = this.values;
    if (v.font) v.font = v.font.trim().replace(/^['"]+|['"]+$/g, "");
    if (!this.explicitStroke && !isHeavyFont(v.font) && (Number(v.stroke_width) || 0) > THIN_OUTLINE) v.stroke_width = THIN_OUTLINE;
  }

  /** The Caption effect properties for this look on `project` (`properties`). */
  properties(project: Project, lines = 2): Record<string, unknown> {
    const v = this.values;
    const [w, h] = projectSize(project);
    const short = Math.min(w, h);
    const fontPx = Math.max(4, Number(v.text_size) * short);
    const toUnits = 600 / w;
    const lineSpacing = Number(v.line_spacing ?? 1);
    const vertical = isVertical(project);
    const top = captionTop(v.position, fontPx, lineSpacing, h, lines, vertical);
    const margin = vertical ? 0.06 : 0.08;
    return {
      caption_font: v.font || "sans",
      font_size: constantKeyframe(pyRoundTo(fontPx * toUnits, 3)),
      font_alpha: constantKeyframe(pyRoundTo(this.textAlpha, 4)),
      color: colorKeyframes(v.text_color),
      stroke: colorKeyframes(v.stroke_color),
      stroke_width: constantKeyframe(pyRoundTo(Number(v.stroke_width) * fontPx * toUnits, 3)),
      background: colorKeyframes(v.background_color),
      background_alpha: constantKeyframe(pyRoundTo(Number(v.background_opacity), 4)),
      background_padding: constantKeyframe(pyRoundTo(Number(v.padding ?? 0.35) * fontPx * toUnits, 3)),
      background_corner: constantKeyframe(pyRoundTo(Number(v.corner ?? 0.15) * fontPx * toUnits, 3)),
      left: constantKeyframe(margin),
      right: constantKeyframe(margin),
      top: constantKeyframe(pyRoundTo(top, 4)),
      bottom: constantKeyframe(0),
      line_spacing: constantKeyframe(lineSpacing),
      fade_in: constantKeyframe(Number(v.fade ?? 0)),
      fade_out: constantKeyframe(Number(v.fade ?? 0)),
      apply_before_clip: false,
    };
  }

  /** `summary`: the look as the receipt reports it. */
  summary(): Record<string, unknown> {
    const v = this.values;
    return {
      text_size: v.text_size,
      font: v.font || "sans",
      text_color: v.text_color,
      stroke_color: v.stroke_color,
      stroke_width: v.stroke_width,
      background_color: v.background_color,
      background_opacity: v.background_opacity,
      position: v.position,
      fade_seconds: v.fade ?? 0,
    };
  }
}

function effectColor(effect: Readonly<Record<string, unknown>>, name: string, fallback: string): string {
  const c = effect[name];
  if (typeof c !== "object" || c === null) return fallback;
  const channels = ["red", "green", "blue"].map((k) => keyframeValueAt((c as Record<string, unknown>)[k], 1, 0));
  if (channels.some((n) => !Number.isFinite(n))) return fallback;
  return `#${channels.map((n) => Math.max(0, Math.min(255, pyRound(n))).toString(16).padStart(2, "0")).join("")}`;
}

/** `style_from_effect`: the frame-relative look of a Caption effect (for restyling and listing). */
export function styleFromEffect(effect: Readonly<Effect>, project: Project): CaptionLook {
  const e = effect as unknown as Readonly<Record<string, unknown>>;
  const [w, h] = projectSize(project);
  const short = Math.min(w, h);
  const units = w / 600;
  const kf = (name: string, fallback: number): number => keyframeValueAt(e[name], 1, fallback);
  const fontPx = kf("font_size", 30) * units;
  const top = kf("top", 0.75);
  const font = e.caption_font;
  return {
    text_size: short ? pyRoundTo(fontPx / short, 4) : 0.05,
    font: font === undefined || font === null || font === "" || font === "sans" ? "" : String(font),
    text_color: effectColor(e, "color", "#ffffff"),
    text_alpha: kf("font_alpha", 1),
    stroke_color: effectColor(e, "stroke", "#000000"),
    stroke_width: fontPx ? pyRoundTo((kf("stroke_width", 0) * units) / fontPx, 4) : 0,
    background_color: effectColor(e, "background", "#000000"),
    background_opacity: kf("background_alpha", 0),
    position: top < 0.3 ? "top" : top < 0.6 ? "center" : "bottom",
    padding: fontPx ? pyRoundTo((kf("background_padding", 20) * units) / fontPx, 4) : 0.35,
    corner: fontPx ? pyRoundTo((kf("background_corner", 10) * units) / fontPx, 4) : 0.15,
    fade: kf("fade_in", 0),
    line_spacing: kf("line_spacing", 1),
  };
}
