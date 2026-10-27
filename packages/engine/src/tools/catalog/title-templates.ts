/**
 * Title templates and editing titles: list_title_templates_tool, edit_title_tool.
 *
 * Ports of zenvi-core develop src/classes/editor_tools/titles_text.py with
 * the title rules of classes/title_svg.py (titles/title-svg.ts). Templates
 * are the 50 bundled SVGs (`ToolHost.assets`); the desktop also lists the
 * user's own template folder, which web surfaces do not have. A project
 * title's SVG is read through the host (`StorageHost.readText`; bundled
 * emoji through the assets).
 *
 * Editing writes a new SVG through `MediaHost.writeGenerated`. The desktop
 * points the title's Project Files entry at the new version (same file id);
 * here the new version is a new entry that takes the old one's place in
 * every clip and in the bin, in the same undo step, because web hosts store
 * media by content and never change the bytes behind a file id. Fonts are
 * checked against the fonts the host renders titles with where it can list
 * them (`FrameHost.fontFamilies`: the CLI, Zenvi Cloud), and taken as given
 * where it cannot (the browser), like the desktop without Qt's list.
 */

import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { addFile, removeFile } from "../../ops/files.js";
import { useFileForClip } from "../../ops/overlays.js";
import { textSpan } from "../../titles/artboard.js";
import { TITLE_TEMPLATES } from "../../titles/templates.js";
import {
  applyFont,
  artboardSize,
  backgroundColor,
  duplicatePattern,
  fieldByRole,
  fitField,
  fontFamily,
  freeName,
  installedFontForTitle,
  parseTitleSvg,
  rectNodes,
  setBackground,
  setFieldText,
  setTextColor,
  textColor,
  textNodes,
  textZone,
  titleFields,
  titleSvgText,
  tspanNodes,
  versionName,
  type TextField,
  type TitleDoc,
} from "../../titles/title-svg.js";
import { contractTool, unavailable, type ToolCall } from "../define.js";
import { pyReprString } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { AssetHost, ImportedMedia } from "../types.js";
import {
  OVERLAY_ROLE,
  colorHexAlpha,
  guarded,
  isLocked,
  pyRoundTo,
  resolveFont,
  summaryLine,
  toolError,
  uiTrackNumber,
} from "../titles-text.js";
import { missingGlyphWarnings, outlineTitle, titleFontFamilies } from "../fonts.js";
import { animatedCatalog } from "./animated-titles.js";

/** What each bundled template looks like (titles_text.py TEMPLATE_PURPOSE, from rendering all 50). */
const TEMPLATE_PURPOSE: Readonly<Record<string, string>> = {
  Bar_1: "centre title on a glossy blue bar, with a reflection",
  Bar_2: "centre title + subtitle on a glossy blue bar",
  Bar_3: "lower third: gold title on a dark bar across the bottom",
  Box: "full-screen card: purple background, cyan frame, title + subtitle",
  Bubbles_1: "title + subtitle under floating bubbles",
  Bubbles_2: "title + subtitle with bubbles around the frame",
  Camera_Border: "camera viewfinder corners around a small title",
  Cloud_1: "title + subtitle inside a cartoon cloud",
  Cloud_2: "three lines in three cartoon clouds",
  Creative_Commons_1: "music credit card (song, author, CC licence) on black",
  Creative_Commons_2: "music credit card with a URL line, on black",
  Film_Rating_1: "green 'approved for all audiences' trailer card",
  Film_Rating_2: "green trailer rating card: R",
  Film_Rating_3: "green trailer rating card: G",
  Film_Rating_4: "green trailer rating card: PG-13",
  Flames: "title + subtitle over flames along the bottom",
  Flare: "full-screen card: colourful light flare, big title + subtitle",
  Footer_1: "small footer text, bottom left",
  Footer_2: "small footer text, bottom centre",
  Footer_3: "small footer text, bottom right",
  Gold_1: "gold title, centre",
  Gold_2: "gold title + subtitle, centre",
  Gold_Bottom: "gold title, bottom centre",
  Gold_Top: "gold title, top centre",
  Gray_Box_1: "title in a grey box, top left",
  Gray_Box_2: "title + subtitle in a grey box, top left",
  Gray_Box_3: "lower third: title in a grey box, bottom right",
  Gray_Box_4: "lower third: name + role in a grey box, bottom right",
  Header_1: "small header text, top left",
  Header_2: "small header text, top centre",
  Header_3: "small header text, top right",
  OpenShot: "full-screen card: pink-to-blue gradient, white title + subtitle (end card)",
  Oval_1: "title + subtitle inside a blue oval vignette",
  Oval_2: "title + subtitle inside a blue oval frame",
  Oval_3: "title at the top and subtitle at the bottom of a blue oval",
  Oval_4: "title with reflection inside a blue oval",
  Post_it: "yellow sticky note with four lines",
  Ribbon_1: "subtitle + title on a blue ribbon across the top",
  Ribbon_2: "title + subtitle on a blue ribbon across the top",
  Ribbon_3: "title ribbon at the top, subtitle ribbon at the bottom",
  Smoke_1: "title + subtitle between dark smoke at top and bottom",
  Smoke_2: "title + subtitle with dark smoke",
  Smoke_3: "title with reflection between dark smoke",
  Solid_Color: "solid full-screen colour card with no text (set background_color)",
  Standard_1: "plain title + subtitle, centre",
  Standard_2: "plain title with a reflection, centre",
  Standard_3: "three centred lines",
  Standard_4: "four centred lines (credits)",
  Sunset: "glowing gradient title, centre",
  Text_Card: "solid colour card with one centred line of text (set background_color)",
  TV_Rating: "small TV rating badge (TV / G), top left",
};

function basename(path: string): string {
  return String(path ?? "").split(/[\\/]/).pop() ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `_field_rows`. */
export function fieldRows(slots: readonly TextField[]): { index: number; role: string; text: string }[] {
  return slots.map((s) => ({ index: s.index, role: s.role, text: s.text.trim() }));
}

// ---------------------------------------------------------------------------
// Styles (titles_text.py `_Style`)
// ---------------------------------------------------------------------------

export interface TitleStyleArgs {
  font?: string;
  font_weight?: "" | "bold" | "normal";
  font_style?: "" | "italic" | "normal";
  font_scale?: number;
  text_color?: string;
  background_color?: string;
  fit_text?: boolean;
}

/** Validated font / colour / size changes for a title document (`_Style`). */
export class TitleStyle {
  /** As given until `resolveFont` matches it to an installed family. */
  font: string;
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  readonly fontScale: number;
  readonly textColor: [string, number] | null;
  readonly background: [string, number] | null;
  readonly fitText: boolean;

  constructor(args: TitleStyleArgs) {
    const weight = args.font_weight ?? "";
    const style = args.font_style ?? "";
    if (!["", "bold", "normal"].includes(weight)) toolError("font_weight must be '', 'bold' or 'normal'");
    if (!["", "italic", "normal"].includes(style)) toolError("font_style must be '', 'italic' or 'normal'");
    this.font = String(args.font ?? "").trim();
    this.bold = weight === "" ? null : weight === "bold";
    this.italic = style === "" ? null : style === "italic";
    this.fontScale = Number(args.font_scale || 1);
    this.textColor = String(args.text_color ?? "").trim() ? colorHexAlpha(args.text_color, "text_color") : null;
    this.background = String(args.background_color ?? "").trim() ? colorHexAlpha(args.background_color, "background_color") : null;
    this.fitText = args.fit_text ?? true;
  }

  get changesAnything(): boolean {
    return Boolean(this.font || this.bold !== null || this.italic !== null || Math.abs(this.fontScale - 1) > 1e-9 || this.textColor || this.background);
  }

  /**
   * `resolve_font`: the requested family matched against the host's fonts
   * (refused when it is not installed); taken as given when the host cannot
   * list them (`families` null, the browser).
   */
  resolveFont(families: readonly string[] | null): void {
    if (this.font) this.font = resolveFont(this.font, families);
  }

  /**
   * `apply`: write the changes; returns the receipt fields they produce. With
   * no font requested, a template font the host does not have becomes the
   * Title Editor's installed fallback (`installed_font_for_title`).
   */
  apply(doc: TitleDoc, families: readonly string[] | null = null): Record<string, unknown> {
    const info: Record<string, unknown> = {};
    const nodes = [...textNodes(doc), ...tspanNodes(doc)];
    if (!this.font) {
      const [missing, installed] = installedFontForTitle(doc, families);
      if (installed) {
        applyFont(nodes, { family: installed });
        info.font = installed;
        info.font_replaced = missing;
      }
    }
    if (this.font || this.bold !== null || this.italic !== null || Math.abs(this.fontScale - 1) > 1e-9) {
      applyFont(nodes, { family: this.font || null, italic: this.italic, bold: this.bold, sizeRatio: this.fontScale });
    }
    if (this.textColor) {
      setTextColor(doc, ...this.textColor);
      info.text_color = this.textColor[0];
    }
    if (this.background) {
      if (rectNodes(doc).length === 0) toolError("this title has no background shape to colour");
      setBackground(doc, ...this.background);
      info.background_color = this.background[0];
    }
    if (this.font) info.font = this.font;
    return info;
  }

  /** `_fit`: shrink fields that would run off the artboard; {field index: ratio}. */
  fit(doc: TitleDoc, slots: readonly TextField[]): Record<string, number> {
    const fitted: Record<string, number> = {};
    if (!this.fitText) return fitted;
    // A title fitted to its frame's aspect is fitted to its title-safe span (titles/artboard.ts).
    const span = textSpan(doc);
    for (const slot of slots) {
      const ratio = fitField(slot, span.width, 0.35, span.left);
      if (ratio < 0.999) fitted[String(slot.index)] = pyRoundTo(ratio, 3);
    }
    return fitted;
  }
}

/** Python list repr of strings: ['title', 'subtitle']. */
function pyList(items: readonly string[]): string {
  return `[${items.map((s) => pyReprString(s)).join(", ")}]`;
}

/** `_assign_texts`: map text / subtitle / lines onto the fields (index → new text). */
export function assignTexts(slots: readonly TextField[], text: string, subtitle: string, lines: readonly string[], name: string, blankRest: boolean): Map<number, string> {
  const values = new Map<number, string>();
  const count = slots.length;
  if (lines.length > 0) {
    if (lines.length > count) {
      toolError(
        `${name} has ${count} text field(s) ${pyList(slots.map((s) => s.role))} but ${lines.length} lines were given; ` +
          "pick a template with more lines (Standard_3 has 3, Standard_4 and Post_it have 4)",
      );
    }
    lines.forEach((value, i) => values.set(slots[i]!.index, String(value)));
  } else {
    const parts = String(text ?? "")
      .split("\n")
      .map((p) => p.trim());
    while (parts.length > 0 && !parts[parts.length - 1]) parts.pop();
    const sub = fieldByRole(slots, "subtitle");
    if (subtitle.trim() && !sub) toolError(`${name} has a single text line; drop subtitle or use a two-line template such as Standard_1, Bar_2 or Gray_Box_4`);
    const main = fieldByRole(slots, "title");
    let order = [main, sub].filter((s): s is TextField => s !== undefined);
    order = [...order, ...slots.filter((s) => !order.includes(s))];
    if (subtitle.trim()) {
      order = order.filter((s) => s !== sub);
      values.set(sub!.index, subtitle.trim());
    }
    if (parts.length > order.length) {
      toolError(`${name} has ${count} text field(s) but the text has ${parts.length} lines; use a template with more lines (Standard_3, Standard_4, Post_it) or pass lines=[...]`);
    }
    parts.forEach((value, i) => {
      if (i < order.length) values.set(order[i]!.index, value);
    });
  }
  if (blankRest) for (const slot of slots) if (!values.has(slot.index)) values.set(slot.index, "");
  return values;
}

// ---------------------------------------------------------------------------
// Reading templates and project titles
// ---------------------------------------------------------------------------

const templateCache = new WeakMap<AssetHost, Promise<Record<string, unknown>[]>>();

/** `_template_entry` for every bundled template, read once per asset host. */
function templateEntries(call: ToolCall): Promise<Record<string, unknown>[]> {
  const assets = call.host.assets!;
  let pending = templateCache.get(assets);
  if (!pending) {
    pending = Promise.all(
      TITLE_TEMPLATES.map(async (t) => {
        const entry: Record<string, unknown> = { name: t.id, label: t.name, source: "bundled" };
        let doc: TitleDoc;
        try {
          doc = parseTitleSvg(await assets.readText(t.assetPath));
        } catch (error) {
          entry.error = `unreadable: ${errorMessage(error)}`;
          return entry;
        }
        const slots = titleFields(doc);
        const [, h] = artboardSize(doc);
        const main = fieldByRole(slots, "title") ?? slots[0];
        const [color, alpha] = main ? textColor(doc, main.nodes[0]) : ["", 0];
        const [bg, bgAlpha] = backgroundColor(doc);
        Object.assign(entry, {
          purpose: TEMPLATE_PURPOSE[t.id] ?? "",
          zone: textZone(slots, h),
          fields: fieldRows(slots),
          text_color: color,
          background: { color: bg, opacity: pyRoundTo(bgAlpha, 3) },
          font: fontFamily(doc),
        });
        if (alpha < 0.999) entry.text_opacity = pyRoundTo(alpha, 3);
        return entry;
      }),
    );
    pending.catch(() => templateCache.delete(assets));
    templateCache.set(assets, pending);
  }
  return pending;
}

/** `_matches`: every query word in the entry's name, label, purpose, zone and field texts. */
function matches(entry: Record<string, unknown>, query: string): boolean {
  if (!query) return true;
  const fields = Array.isArray(entry.fields) ? (entry.fields as { text?: string }[]) : [];
  const hay = [entry.name, entry.label, entry.purpose, entry.zone, entry.title, ...fields.map((f) => f.text)]
    .map((v) => (typeof v === "string" ? v : ""))
    .join(" ")
    .toLowerCase()
    .replaceAll("_", " ");
  return query
    .toLowerCase()
    .replaceAll("_", " ")
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** SVG files in the bin that can be titles (not the transparent overlay carrier). */
function titleFiles(project: Project): ProjectFile[] {
  return project.files.filter((f) => String(f.path ?? "").toLowerCase().endsWith(".svg") && f.zenvi_role !== OVERLAY_ROLE);
}

/** A bin SVG's text: bundled emoji from the assets, anything else through the host's storage. */
export async function readProjectSvg(call: ToolCall, file: ProjectFile): Promise<string> {
  const path = String(file.path ?? "");
  if (path.startsWith("@emojis/") && call.host.assets) return call.host.assets.readText(`emojis/${path.slice("@emojis/".length)}`);
  const readText = call.host.storage?.readText;
  if (!readText) throw new Error("this Zenvi surface cannot read project files");
  return readText.call(call.host.storage, path);
}

function clipsOf(project: Project, fileId: string): Clip[] {
  return project.clips.filter((c) => c.file_id === fileId);
}

/** `_project_titles`. */
async function projectTitles(call: ToolCall, query: string): Promise<Record<string, unknown>[]> {
  const project = call.doc.project;
  const out: Record<string, unknown>[] = [];
  for (const f of titleFiles(project)) {
    const path = String(f.path);
    const entry: Record<string, unknown> = { file_id: f.id, name: f.name || basename(path), path };
    try {
      const doc = parseTitleSvg(await readProjectSvg(call, f));
      entry.fields = fieldRows(titleFields(doc));
      entry.text_color = textColor(doc)[0];
    } catch (error) {
      entry.error = `unreadable: ${errorMessage(error)}`;
    }
    entry.clips = clipsOf(project, String(f.id)).map((c) => {
      const position = Number(c.position) || 0;
      const length = (Number(c.end) || 0) - (Number(c.start) || 0);
      return { timeline_clip_id: c.id, track: uiTrackNumber(project, c.layer), position: pyRoundTo(position, 3), end: pyRoundTo(position + length, 3) };
    });
    if (matches(entry, query)) out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which title to edit (`_resolve_title`)
// ---------------------------------------------------------------------------

/** `_svg_file`: only SVG titles that are not overlay carriers can be edited. */
function svgTitle(file: ProjectFile): ProjectFile {
  const path = String(file.path ?? "");
  if (!path.toLowerCase().endsWith(".svg")) toolError(`${pyReprString(String(file.name || basename(path)))} is not a title (only .svg titles can be edited)`);
  if (file.zenvi_role === OVERLAY_ROLE) toolError("that clip is a caption/timer overlay; use edit_captions_tool or add_timer_tool");
  return file;
}

async function resolveTitle(call: ToolCall, clipId: string, fileId: string, titleQuery: string): Promise<[ProjectFile, string]> {
  const project = call.doc.project;
  const fileById = (id: string): ProjectFile | undefined => project.files.find((f) => f.id === id);
  if (clipId) {
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) return toolError(`no timeline clip with id=${pyReprString(clipId)}`);
    const file = fileById(String(clip.file_id ?? ""));
    if (!file) return toolError(`clip ${clip.id} has no project file`);
    return [svgTitle(file), clip.id];
  }
  if (fileId) {
    const file = fileById(fileId);
    if (!file) return toolError(`no project file with id=${pyReprString(fileId)}`);
    return [svgTitle(file), ""];
  }
  const titles = titleFiles(project);
  if (titleQuery) {
    const q = titleQuery.toLowerCase();
    const scored: [number, ProjectFile][] = [];
    for (const f of titles) {
      const name = String(f.name || basename(String(f.path)));
      let texts: string[] = [];
      try {
        texts = titleFields(parseTitleSvg(await readProjectSvg(call, f))).map((s) => s.text.trim());
      } catch {
        texts = [];
      }
      const hay = [name.toLowerCase(), ...texts.map((t) => t.toLowerCase())];
      if (hay.some((h) => h === q)) scored.push([2, f]);
      else if (hay.some((h) => h.includes(q))) scored.push([1, f]);
    }
    if (scored.length === 0) toolError(`no title in the project matches ${pyReprString(titleQuery)} (list_title_templates_tool kind=project lists them)`);
    const best = Math.max(...scored.map(([s]) => s));
    const top = scored.filter(([s]) => s === best).map(([, f]) => f);
    if (top.length > 1) {
      toolError(
        `${top.length} titles match ${pyReprString(titleQuery)}: ` +
          top
            .slice(0, 6)
            .map((f) => `${f.id} (${f.name || basename(String(f.path))})`)
            .join(", ") +
          "; pass file_id or timeline_clip_id",
      );
    }
    return [top[0]!, ""];
  }
  const selected = (call.host.ui?.selectedIds?.() ?? [])
    .map((id) => project.clips.find((c) => c.id === id))
    .filter((c): c is Clip => Boolean(c) && String(c!.reader?.path ?? "").toLowerCase().endsWith(".svg"));
  if (selected.length === 1) {
    const file = fileById(String(selected[0]!.file_id ?? ""));
    if (file) return [svgTitle(file), selected[0]!.id];
  }
  if (titles.length === 1) return [titles[0]!, ""];
  return toolError(`which title? pass timeline_clip_id, file_id or title_query (${titles.length} titles in the project; list_title_templates_tool kind=project lists them)`);
}

export async function writeTitle(call: ToolCall, name: string, svg: string): Promise<ImportedMedia> {
  const media = call.host.media!;
  let path: string;
  try {
    path = await media.writeGenerated!(name, new TextEncoder().encode(svg), "image/svg+xml");
  } catch (error) {
    return toolError(`failed to write title SVG: ${errorMessage(error)}`);
  }
  try {
    return { path, info: await media.probe(path), name };
  } catch {
    return toolError(`could not import ${name} into Project Files`);
  }
}

export const titleTemplateTools = [
  contractTool("list_title_templates_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    requires: ["assets"],
    run: (call, input) =>
      guarded("list_title_templates_tool", async () => {
        const kind = input.kind ?? "static";
        const query = String(input.query ?? "").trim();
        const data: Record<string, unknown> = { kind };
        const counts: string[] = [];
        if (kind === "static" || kind === "all") {
          const templates = (await templateEntries(call)).filter((e) => matches(e, query));
          data.templates = templates;
          counts.push(`${templates.length} title template(s)`);
        }
        if (kind === "animated" || kind === "all") {
          const { rows, renderer } = animatedCatalog(query);
          data.animated = rows;
          data.renderer = renderer;
          counts.push(`${rows.length} animated title(s) (${rows.filter((r) => r.renders_here).length} render here as 2D keyframed titles)`);
        }
        if (kind === "project" || kind === "all") {
          const titles = await projectTitles(call, query);
          data.project_titles = titles;
          counts.push(`${titles.length} title(s) in the project`);
        }
        const summary = `Found ${counts.join(", ")}${query ? ` matching ${pyReprString(query)}` : ""}.`;
        return applied("list_title_templates_tool", summary, { data }, 0);
      }),
  }),

  contractTool("edit_title_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media", "storage"],
    run: (call, input) =>
      guarded("edit_title_tool", async () => {
        const tool = "edit_title_tool";
        if (!call.host.media!.writeGenerated) return unavailable(tool, "it cannot store generated title images.");
        const lines = (input.lines ?? []).map(String);
        const text = String(input.text ?? "");
        const subtitle = String(input.subtitle ?? "");
        const scope = input.scope ?? "all_clips";
        const style = new TitleStyle(input);
        const hasText = Boolean(text.trim() || subtitle.trim() || lines.length > 0);
        if (!hasText && !style.changesAnything && scope !== "duplicate") {
          toolError("nothing to change: pass text, subtitle, lines, font, colours or font_scale (or scope='duplicate' to copy the title)");
        }
        const [file, clipId] = await resolveTitle(call, String(input.timeline_clip_id ?? "").trim(), String(input.file_id ?? "").trim(), String(input.title_query ?? "").trim());
        const project = call.doc.project;
        const clips = clipsOf(project, String(file.id));
        if (scope === "this_clip" && !clipId) toolError("scope='this_clip' needs timeline_clip_id (the clip that gets its own copy)");
        const srcPath = String(file.path ?? "");
        let source: string;
        try {
          source = await readProjectSvg(call, file);
        } catch (error) {
          return toolError(`the title file could not be read: ${srcPath} (${errorMessage(error)})`);
        }
        let doc: TitleDoc;
        try {
          doc = parseTitleSvg(source);
        } catch (error) {
          return toolError(`cannot read title SVG ${basename(srcPath)}: ${errorMessage(error)}`);
        }
        const slots = titleFields(doc);
        const name = String(file.name || basename(srcPath));
        if (hasText && slots.length === 0) toolError(`${name} has no text to change`);
        const values = hasText ? assignTexts(slots, text, subtitle, lines, name, false) : new Map<number, string>();
        const families = await titleFontFamilies(call);
        style.resolveFont(families);

        const scopeUsed = scope === "this_clip" && clips.length <= 1 ? "all_clips" : scope;
        const affected = scopeUsed === "all_clips" ? clips : clips.filter((c) => c.id === clipId);
        if (scopeUsed !== "duplicate") {
          const locked = affected.filter((c) => isLocked(project, c.layer));
          if (locked.length > 0) {
            toolError(`title clip(s) on locked track(s): ${locked.map((c) => `${c.id} (track ${uiTrackNumber(project, c.layer)})`).join(", ")}; unlock first`);
          }
        }

        const before = titleSvgText(doc);
        for (const slot of slots) if (values.has(slot.index)) setFieldText(slot, values.get(slot.index)!);
        const styleInfo = style.apply(doc, families);
        const fitted = style.fit(doc, slots);
        const after = fieldRows(slots);
        const svg = titleSvgText(doc);
        if (scopeUsed !== "duplicate" && svg === before) toolError("the title already looks like that; nothing changed");

        const taken = titleFiles(project).map((f) => basename(String(f.path)));
        let outName: string | null;
        if (scopeUsed === "all_clips") outName = versionName(srcPath, taken);
        else {
          const [prefix, offset] = duplicatePattern(basename(srcPath));
          const free = freeName(prefix, offset, taken);
          outName = free === null ? null : `${free}.svg`;
        }
        if (!outName) toolError(scopeUsed === "all_clips" ? `no free version name for ${pyReprString(basename(srcPath))}` : "no free name for the copy");
        const outlined = await outlineTitle(call, svg);
        if (typeof outlined === "string") toolError(outlined.replace(/^Error: /, ""));
        const media = await writeTitle(call, outName, outlined.svg);

        const result = call.commit((tx) => {
          if (scopeUsed === "all_clips") {
            const fresh = addFile(tx, media, { name, mediaType: "image" });
            const ids = clipsOf(tx.project, String(file.id)).map((c) => useFileForClip(tx, c.id, fresh.id).id);
            removeFile(tx, String(file.id), { removeClips: false });
            return { fileId: fresh.id, clipIds: ids };
          }
          const fresh = addFile(tx, media, { mediaType: "image" });
          if (scopeUsed === "this_clip") {
            useFileForClip(tx, clipId, fresh.id);
            return { fileId: fresh.id, clipIds: [clipId] };
          }
          return { fileId: fresh.id, clipIds: [] as string[] };
        });

        const shown = after.map((r) => r.text).filter(Boolean).join(" / ") || name;
        let summary: string;
        if (scopeUsed === "all_clips") summary = `Updated title ${pyReprString(shown)} on ${result.clipIds.length} clip(s).`;
        else if (scopeUsed === "this_clip") summary = `Gave clip ${clipId} its own edited title ${pyReprString(shown)}.`;
        else summary = `Duplicated the title as ${pyReprString(basename(media.path))} (${pyReprString(shown)}); it is in Project Files.`;
        const data: Record<string, unknown> = {
          scope: scopeUsed,
          file_id: result.fileId,
          source_file_id: file.id,
          path: media.path,
          timeline_clip_ids: result.clipIds,
          fields: after,
          ...styleInfo,
        };
        if (scope !== scopeUsed) data.note = "the title is used by only this clip, so it was edited in place";
        if (Object.keys(fitted).length > 0) data.text_shrunk_to_fit = fitted;
        const notes =
          scopeUsed === "all_clips"
            ? [`The edited title is a new Project Files entry (${result.fileId}) that replaced ${file.id} in every clip; use the new file_id from now on.`]
            : [];
        return applied(tool, summaryLine(summary), { data, notes, warnings: missingGlyphWarnings(outlined.missing) });
      }),
  }),
];
