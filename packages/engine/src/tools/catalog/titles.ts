/**
 * add_title_tool (add_captions_tool is in captions.ts).
 *
 * Port of zenvi-core develop 1f80cb3d0 src/classes/editor_tools/titles_text.py
 * `add_title`, with the title rules of classes/title_svg.py
 * (titles/title-svg.ts) that list_title_templates_tool and edit_title_tool
 * share: the template's text fields filled from text / subtitle / lines
 * (unfilled placeholders blanked), font, weight, style, size, text and
 * background colours, long lines shrunk to fit, then one clip on the lowest
 * free track above the picture (a new "Titles" track on top when none is
 * free), anchored where the template's text sits (or `screen_position`),
 * lifted clear of the platform UI on vertical video, with optional fades.
 * On a frame that is not 16:9 the artboard grows to the frame's aspect
 * around the drawing (titles/artboard.ts), with the anchor and the lift
 * baked in, so a card with a background fills the frame instead of showing
 * bars (a Zenvi rule the desktop's add_title does not have yet).
 * One undo step adds the file and the clip.
 *
 * Templates are the 50 bundled SVGs (`ToolHost.assets`); the desktop also
 * reads the user's template folder. A template can also be an existing .svg
 * title: an absolute path, or the path of an SVG in the project (Zenvi
 * Cloud keeps titles at `@assets/title/…`), read through the host. Fonts
 * are checked against the fonts the host renders titles with where it can
 * list them (`FrameHost.fontFamilies`), and taken as given where it cannot
 * (the browser), as the desktop does without Qt's font list.
 */

import { pyRound } from "../../model/rounding.js";
import { addFile } from "../../ops/files.js";
import { placeOverlayClip } from "../../ops/overlays.js";
import { fitArtboardToFrame, type ArtboardPlacement } from "../../titles/artboard.js";
import { getTitleTemplate, suggestTitleTemplates } from "../../titles/templates.js";
import {
  artboardSize,
  backgroundColor,
  centerLines,
  parseTitleSvg,
  setFieldText,
  textZone,
  titleFields,
  titleSvgText,
  uniqueTitleName,
  type TitleDoc,
} from "../../titles/title-svg.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyReprString } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { ContractInput } from "../schemas.gen.js";
import {
  GRAVITY,
  constantKeyframe,
  fadeAlpha,
  fpsOfProject,
  guarded,
  isVertical,
  projectSize,
  planOverlayTrack,
  pyRoundTo,
  snapToFrame,
  summaryLine,
  toolError,
  trackInfo,
  warningNote,
  type ScreenPosition,
} from "../titles-text.js";
import { text } from "./common.js";
import { outlineTitle, titleFontFamilies, titleFontWarnings } from "../fonts.js";
import { TitleStyle, assignTexts, fieldRows, readProjectSvg, writeTitle } from "./title-templates.js";

/** #183's add_title_tool tried these in order when no template was named (titles_text.DEFAULT_TEMPLATES). */
const DEFAULT_TEMPLATES = ["Bar_1", "Standard_1", "Footer_1"] as const;

/** The one-centred-line template text is drawn with when the named template is a colour card (no text field). */
const TEXT_OVER_CARD = "Text_Card";

/** Where a template's text zone anchors its artboard (titles_text.ZONE_POSITION). */
const ZONE_POSITION: Readonly<Record<"top" | "center" | "bottom", ScreenPosition>> = {
  top: "top_center",
  center: "center",
  bottom: "bottom_center",
};

/**
 * titles_text.VERTICAL_SAFE_OFFSET: on 9:16 video the platforms' UI (Reels,
 * TikTok, Shorts) covers bands at the bottom and top, so a title anchored
 * there is lifted clear of it by this share of the frame height
 * (libopenshot `location_y`). It moves a 16:9 title artboard in any portrait
 * frame, by the desktop's amounts; motion/layout.ts's PLATFORM_BANDS is a
 * different rule (where a motion template's own words may sit in a frame at
 * least 1.6 times as tall as wide), so the two are not shared.
 */
const VERTICAL_SAFE_OFFSET: Readonly<Partial<Record<ScreenPosition, number>>> = { bottom_center: -0.12, top_center: 0.06 };

/** Where Best Fit and `posKey`'s gravity put the artboard on the frame. */
function placementOf(posKey: ScreenPosition, lift: number): ArtboardPlacement {
  const [v, h = "center"] = posKey === "center" ? ["center"] : posKey.split("_");
  return { v: v as ArtboardPlacement["v"], h: h as ArtboardPlacement["h"], lift };
}

function basename(path: string): string {
  return String(path ?? "").split(/[\\/]/).pop() ?? "";
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LoadedTemplate {
  /** The template's name (file stem), e.g. "Bar_1". */
  name: string;
  /** Its file name, e.g. "Bar_1.svg". */
  file: string;
  svg: string;
}

function unknownTemplate(raw: string): never {
  const hint = suggestTitleTemplates(raw).join(", ") || DEFAULT_TEMPLATES.join(", ");
  return toolError(`unknown title template ${pyReprString(raw)}; close matches: ${hint} (list_title_templates_tool lists them all)`);
}

/**
 * `_resolve_template` + `_load_doc`: blank is the first default template,
 * a name is a bundled template, an .svg path (absolute, or a title in the
 * project) is that title, read through the host.
 */
async function loadTemplate(call: ToolCall, template: string): Promise<LoadedTemplate> {
  const raw = template.trim();
  const project = call.doc.project;
  const inProject = project.files.find((f) => String(f.path ?? "") === raw);
  if (raw && raw.toLowerCase().endsWith(".svg") && (isAbsolutePath(raw) || inProject)) {
    // The desktop's find_template: a path it cannot read is not a template.
    const storage = call.host.storage;
    if (!inProject && !storage?.readText) return unknownTemplate(raw);
    try {
      const svg = inProject ? await readProjectSvg(call, inProject) : await storage!.readText!(raw);
      return { name: basename(raw).replace(/\.svg$/i, ""), file: basename(raw), svg };
    } catch (error) {
      call.host.log?.(`title template ${raw}: ${errorMessage(error)}`);
      return unknownTemplate(raw);
    }
  }
  const bundled = raw ? getTitleTemplate(raw) : DEFAULT_TEMPLATES.map((name) => getTitleTemplate(name)).find(Boolean);
  if (!bundled) return unknownTemplate(raw);
  try {
    return { name: bundled.id, file: bundled.file, svg: await call.host.assets!.readText(bundled.assetPath) };
  } catch (error) {
    return toolError(`cannot read title SVG ${bundled.file}: ${errorMessage(error)}`);
  }
}

async function addTitle(call: ToolCall, input: ContractInput<"add_title_tool">) {
  const tool = "add_title_tool";
  if (!call.host.media!.writeGenerated) return unavailable(tool, "it cannot store generated title images.");
  const lines = (input.lines ?? []).map(String);
  const body = String(input.text ?? "");
  const subtitle = String(input.subtitle ?? "");
  const given = Boolean(body.trim() || subtitle.trim() || lines.some((v) => v.trim()));
  const colourCard = !given && Boolean(String(input.background_color ?? "").trim());
  // A blank title with a background colour is a colour card (agents cut white flash frames this way).
  let template = await loadTemplate(call, String(input.template ?? "").trim() || (colourCard ? "Solid_Color" : ""));
  const parse = (t: LoadedTemplate): TitleDoc => {
    try {
      return parseTitleSvg(t.svg);
    } catch (error) {
      return toolError(`cannot read title SVG ${t.file}: ${errorMessage(error)}`);
    }
  };
  let doc = parse(template);
  let slots = titleFields(doc);
  const warnings: string[] = [];
  let card = false;
  let colour = String(input.background_color ?? "");
  if (slots.length === 0 && given) {
    // Agents name Solid_Color for "this text on a coloured frame": draw the text on a text template over the card's colour.
    card = true;
    const cardTemplate = template;
    const [cardColour, cardAlpha] = backgroundColor(doc);
    template = await loadTemplate(call, TEXT_OVER_CARD);
    doc = parse(template);
    slots = titleFields(doc);
    // '#rrggbb', plus the card's opacity as '#rrggbbaa' when it is not opaque.
    if (!colour.trim() && cardAlpha > 0) colour = cardColour + (cardAlpha >= 1 ? "" : pyRound(cardAlpha * 255).toString(16).padStart(2, "0"));
    warnings.push(`${cardTemplate.name} has no text; drew the text with ${template.name} over ${colour.trim() ? `the colour ${colour.trim()}` : "the video"}`);
  }
  const name = template.name;
  if (slots.length > 0 && !given && !colourCard) toolError("add_title_tool needs text (or subtitle / lines), or a background_color for a blank colour card");
  const style = new TitleStyle({ ...input, background_color: colour });
  const values = assignTexts(slots, body, subtitle, lines, name, true);

  const project = call.doc.project;
  const fps = fpsOfProject(project);
  const position = snapToFrame(project, Number(input.position_seconds ?? 0));
  // `_frames`: whole frames, at least one.
  const duration = Math.max(1, pyRound(Number(input.duration_seconds ?? 5) * fps)) / fps;
  const end = position + duration;
  const track = String(input.track ?? "");
  // Where it goes, before anything is written: a refused call leaves no file and no undo step.
  planOverlayTrack(project, position, end, track);
  const taken = project.files.map((f) => String(f.path ?? "")).filter((p) => p.toLowerCase().endsWith(".svg")).map(basename);
  const families = await titleFontFamilies(call);
  style.resolveFont(families);

  for (const slot of slots) if (values.has(slot.index)) setFieldText(slot, values.get(slot.index)!);
  const styleInfo = style.apply(doc, families);
  if (card) centerLines(doc);
  const zone = textZone(slots, artboardSize(doc)[1]);
  const wanted = input.screen_position ?? "auto";
  const posKey: ScreenPosition = ZONE_POSITION[wanted === "auto" ? zone : wanted] ?? "center";
  const lift = isVertical(project) ? (VERTICAL_SAFE_OFFSET[posKey] ?? 0) : 0;
  const [frameW, frameH] = projectSize(project);
  const reshaped = fitArtboardToFrame(doc, { width: frameW, height: frameH }, placementOf(posKey, lift));
  const fitted = style.fit(doc, slots);

  const firstText = slots.map((s) => values.get(s.index) ?? "").find((v) => v.trim()) || name;
  const fileName = uniqueTitleName(text(input.file_name) || firstText, taken);
  const outlined = await outlineTitle(call, titleSvgText(doc));
  if (typeof outlined === "string") toolError(outlined.replace(/^Error: /, ""));
  const media = await writeTitle(call, fileName, outlined.svg);

  const fadeIn = Number(input.fade_in_seconds ?? 0);
  const fadeOut = Number(input.fade_out_seconds ?? 0);
  const placed = call.commit((tx) => {
    const { layer, created, moved } = planOverlayTrack(tx.project, position, end, track);
    const file = addFile(tx, media, { mediaType: "image" });
    const props: Record<string, unknown> = { gravity: GRAVITY[posKey] };
    // A title fitted to the frame carries its lift in its viewBox.
    if (lift && !reshaped) props.location_y = constantKeyframe(lift);
    const alpha = fadeAlpha(tx.project, 0, duration, fadeIn, fadeOut);
    if (alpha) props.alpha = alpha;
    const clip = placeOverlayClip(tx, { fileId: file.id, position, duration, layer, newTrackLabel: "Titles", props });
    return { fileId: file.id, clipId: clip.id, layer, created, moved };
  });

  const shown =
    slots
      .map((s) => (values.get(s.index) ?? "").trim())
      .filter(Boolean)
      .join(" / ") || name;
  const t = trackInfo(call.doc.project, placed.layer);
  const summary =
    `Added title ${pyReprString(shown)} (${name}) on track ${t.track ?? "None"} at ${pyFixed(position, 2)}-${pyFixed(end, 2)}s` +
    `${placed.created ? " on a new track" : ""}.`;
  const data: Record<string, unknown> = {
    timeline_clip_id: placed.clipId,
    file_id: placed.fileId,
    path: media.path,
    file_name: basename(media.path),
    template: name,
    fields: fieldRows(slots),
    position: pyRoundTo(position, 3),
    duration: pyRoundTo(duration, 3),
    end: pyRoundTo(end, 3),
    new_track: placed.created,
    screen_position: posKey,
    ...t,
    ...styleInfo,
  };
  if (fadeIn || fadeOut) Object.assign(data, { fade_in: fadeIn, fade_out: fadeOut });
  if (Object.keys(fitted).length > 0) data.text_shrunk_to_fit = fitted;
  if (lift) data.lifted_for_vertical_ui = lift;
  if (placed.moved) warnings.push(placed.moved);
  if (warnings.length > 0) data.warnings = warnings;
  return applied(tool, summaryLine(summary + warningNote(warnings)), {
    data,
    warnings: [...warnings, ...titleFontWarnings(outlined)],
  });
}

export const titleTools: CatalogTool[] = [
  contractTool("add_title_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media", "assets"],
    run: (call, input) => guarded("add_title_tool", () => addTitle(call, input)),
  }),
];
