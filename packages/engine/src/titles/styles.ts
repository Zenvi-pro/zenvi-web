/**
 * Title styles: what add_title_tool draws, and the spec a title is built from.
 *
 * Port of zenvi-core src/classes/hyperframes_titles.py (`STYLES`, `spec`,
 * `is_opaque`, `title_spec`). The desktop renders a spec as a HyperFrames
 * composition; here the motion host renders it as the `title` Zenvi Motion
 * block (packages/motion/src/blocks/title), and a surface without one draws
 * it with the engine's keyframed layers (titles/native.ts). The spec rides on
 * the file record as the desktop writes it (`ai_metadata.source` =
 * "hyperframes_title", `ai_metadata.title`), so either app can edit it.
 */

export const TITLE_SOURCE = "hyperframes_title";
export const DEFAULT_TITLE_STYLE = "headline";
export const TITLE_ZONES = ["top", "center", "bottom"] as const;
export type TitleZone = (typeof TITLE_ZONES)[number];

export const TITLE_STYLE_IDS = ["headline", "lower_third", "end_card", "bold_box", "kicker", "credits"] as const;
export type TitleStyleId = (typeof TITLE_STYLE_IDS)[number];

export interface TitleStyleInfo {
  label: string;
  zone: TitleZone;
  fields: readonly ("title" | "subtitle" | "lines")[];
  /** Paints the whole frame (opaque unless its background is see-through). */
  fullFrame?: boolean;
  description: string;
}

export const TITLE_STYLES: Readonly<Record<TitleStyleId, TitleStyleInfo>> = {
  headline: {
    label: "Headline",
    zone: "center",
    fields: ["title", "subtitle"],
    description: "Big bold title whose words rise one by one out of a mask, an accent rule drawing under it and an optional subtitle fading up. Openers, chapter titles, hooks.",
  },
  lower_third: {
    label: "Lower third",
    zone: "bottom",
    fields: ["title", "subtitle"],
    description: "Name (title) and role (subtitle) on a dark plate that wipes in behind an accent bar, bottom left. Speaker and interview intros, locations.",
  },
  end_card: {
    label: "End card",
    zone: "center",
    fields: ["title", "subtitle"],
    fullFrame: true,
    description: "Full-frame card (background_color, default near-black) with a large title easing in and a tracked uppercase subtitle. Endings, 'Thanks for watching', section cards.",
  },
  bold_box: {
    label: "Bold box",
    zone: "center",
    fields: ["title", "subtitle"],
    description: "Social-style text: each line on a solid box (accent_color, default white) that wipes in, dark text. Hooks and punchy statements on reels, shorts and TikToks.",
  },
  kicker: {
    label: "Kicker",
    zone: "top",
    fields: ["title", "subtitle"],
    description: "Small tracked uppercase label between two thin rules, with an optional second line. Place and date stamps, chapter labels, small headers.",
  },
  credits: {
    label: "Credits",
    zone: "center",
    fields: ["lines"],
    description: "One line per entry (lines), fading up in turn; more than six lines roll up the screen over the title's duration. Credits, lists, thank-yous.",
  },
};

/** More lines than this roll instead of fading in place. */
export const ROLL_LINES = 6;
export const FULL_FRAME_BACKGROUND = "#0b0b0f";

export interface TitleSpec {
  style: TitleStyleId;
  title: string;
  subtitle: string;
  lines: string[];
  /** '#rrggbb[aa]' or '' (the style's). */
  text_color: string;
  accent_color: string;
  background_color: string;
  font: string;
  font_scale: number;
  zone: TitleZone;
}

export class TitleSpecError extends Error {}

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const FONT = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

function hex(value: string, what: string): string {
  const v = value.trim();
  if (v && !HEX.test(v)) throw new TitleSpecError(`${what} must be '#RRGGBB' or '#RRGGBBAA'`);
  return v;
}

export function isTitleStyle(value: string): value is TitleStyleId {
  return (TITLE_STYLE_IDS as readonly string[]).includes(value);
}

export interface TitleSpecInput {
  style: string;
  title?: string;
  subtitle?: string;
  lines?: readonly string[];
  text_color?: string;
  accent_color?: string;
  background_color?: string;
  font?: string;
  font_scale?: number;
  /** '' = the style's own place. */
  zone?: string;
}

/** `spec`: the validated description of a title (colours already '#rrggbb[aa]'). */
export function titleSpec(input: TitleSpecInput): TitleSpec {
  const style = input.style;
  if (!isTitleStyle(style)) throw new TitleSpecError(`unknown title style '${style}'; choose one of: ${TITLE_STYLE_IDS.join(", ")}`);
  const entry = TITLE_STYLES[style];
  let lines = (input.lines ?? []).map((v) => String(v).trim()).filter(Boolean);
  let title = String(input.title ?? "").trim();
  let subtitle = String(input.subtitle ?? "").trim();
  if (entry.fields.includes("lines")) {
    if (lines.length === 0) lines = [...title.split("\n"), subtitle].map((v) => v.trim()).filter(Boolean);
    title = "";
    subtitle = "";
  } else if (lines.length > 0) {
    [title, subtitle] = style === "bold_box" ? [lines.join("\n"), ""] : [lines[0]!, lines.slice(1).join(" ")];
    lines = [];
  } else if (title.includes("\n") && style !== "bold_box") {
    // 'Jane Doe\nFounder': the second line is the subtitle, as in a lower third's name and role
    const cut = title.indexOf("\n");
    const rest = title.slice(cut + 1);
    title = title.slice(0, cut).trim();
    subtitle = [rest, subtitle].map((v) => v.trim()).filter(Boolean).join(" ");
  }
  const zone = input.zone || entry.zone;
  if (!(TITLE_ZONES as readonly string[]).includes(zone)) throw new TitleSpecError(`screen_position must be one of: auto, ${TITLE_ZONES.join(", ")}`);
  const scale = Number(input.font_scale ?? 1) || 1;
  if (scale < 0.2 || scale > 5) throw new TitleSpecError("font_scale must be between 0.2 and 5");
  const background = hex(String(input.background_color ?? ""), "background_color");
  if (!(title || subtitle || lines.length > 0 || background)) throw new TitleSpecError("a title needs text (or subtitle / lines), or a background_color for a blank colour card");
  const font = String(input.font ?? "").trim();
  if (font && !FONT.test(font)) throw new TitleSpecError("font must be a family name such as 'Georgia' or 'Playfair Display'");
  return {
    style,
    title,
    subtitle,
    lines,
    text_color: hex(String(input.text_color ?? ""), "text_color"),
    accent_color: hex(String(input.accent_color ?? ""), "accent_color"),
    background_color: background,
    font,
    font_scale: scale,
    zone: zone as TitleZone,
  };
}

/** The full-frame background a spec paints, or '' (transparent). */
export function titleBackground(s: TitleSpec): string {
  return s.background_color || (TITLE_STYLES[s.style].fullFrame ? FULL_FRAME_BACKGROUND : "");
}

/** `is_opaque`: the render paints every pixel (a full-frame card with a solid background). */
export function isOpaqueTitle(s: TitleSpec): boolean {
  const bg = titleBackground(s);
  return Boolean(bg) && (bg.length === 7 || bg.slice(7).toLowerCase() === "ff");
}

/** What a title shows, for summaries: 'Tokyo / Shibuya'. */
export function titleShown(s: TitleSpec): string {
  return [s.title, s.subtitle, ...s.lines].filter(Boolean).join(" / ") || "colour card";
}

/** The receipt's `fields`: {title, subtitle} or {lines}. */
export function titleFieldsOf(s: TitleSpec): Record<string, unknown> {
  return s.lines.length > 0 ? { lines: [...s.lines] } : { title: s.title, subtitle: s.subtitle };
}

/** `title_spec`: the spec of a title file (its Project Files record), else null. */
export function titleSpecOf(file: Readonly<Record<string, unknown>> | undefined): TitleSpec | null {
  const ai = file?.ai_metadata as Record<string, unknown> | undefined;
  if (!ai || typeof ai !== "object" || ai.source !== TITLE_SOURCE) return null;
  const s = ai.title as TitleSpec | undefined;
  return s && typeof s === "object" && isTitleStyle(String(s.style)) ? s : null;
}

/** `_hf_metadata`: the ai_metadata a title file carries. */
export function titleMetadata(s: TitleSpec, seconds: number): Record<string, unknown> {
  return {
    source: TITLE_SOURCE,
    title: s,
    title_duration: Math.round(seconds * 1e6) / 1e6,
    analyzed: true,
    short_summary: `${TITLE_STYLES[s.style].label} title: ${titleShown(s)}`,
  };
}

/** Two specs that draw the same title. */
export function sameTitleSpec(a: TitleSpec, b: TitleSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
