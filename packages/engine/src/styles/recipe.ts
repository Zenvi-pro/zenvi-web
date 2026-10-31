/**
 * The styles library as compact text for tools (find_style_tool,
 * get_style_tool, get_technique_tool) and for the builders: the same
 * markdown files the zenvi-styles skill reads (library.gen.ts), cut to what
 * an edit needs. The ablation of integration 10 (fleet ab10, 36 runs) found
 * no agent ever opened a style file, so the library now reaches agents
 * through tools on every surface, at most ~1.5 k tokens a call.
 */

import { styleScores } from "../brief/auto.js";

/** One file of the library (library.gen.ts `STYLE_FILES`). */
export interface StyleFile {
  id: string;
  kind: "style" | "technique" | "family" | "method";
  path: string;
  summary: string;
  markdown: string;
}

/** The front matter fields the tools read. */
export interface StyleMeta {
  categories: string[];
  tools: string[];
  pace: string;
  mood: string[];
  aspect: string[];
  pairs_with: string[];
  avoid_with: string[];
}

/** A get_style text stays under ~1.5 k tokens: prose and tool calls run about 3.6 characters a token. */
export const STYLE_TEXT_MAX = 5400;
/** A technique is a smaller unit: ~1.2 k tokens. */
export const TECHNIQUE_TEXT_MAX = 4400;

function listOf(value: string | undefined): string[] {
  if (!value) return [];
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((v) => v.trim().replace(/^["']|["']$/g, ""))
    .filter((v) => v.length > 0);
}

/** The front matter (`key: value` lines between `---`) and the body after it. */
export function splitFrontMatter(markdown: string): { fields: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (!m) return { fields: {}, body: markdown };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!.trim();
  }
  return { fields, body: markdown.slice(m[0].length) };
}

export function styleMeta(file: StyleFile): StyleMeta {
  const { fields } = splitFrontMatter(file.markdown);
  return {
    categories: listOf(fields.categories),
    tools: listOf(fields.tools),
    pace: (fields.pace ?? "").replace(/^["']|["']$/g, ""),
    mood: listOf(fields.mood),
    aspect: listOf(fields.aspect),
    pairs_with: listOf(fields.pairs_with),
    avoid_with: listOf(fields.avoid_with),
  };
}

interface Section {
  heading: string;
  text: string;
}

/** The H1 title, the text before the first `##` and every `##` section. */
function sections(body: string): { title: string; intro: string; sections: Section[] } {
  const parts = body.split(/^## /m);
  const head = parts[0] ?? "";
  const title = /^# (.+)$/m.exec(head)?.[1]?.trim() ?? "";
  const intro = head.replace(/^# .+$/m, "").trim();
  return {
    title,
    intro,
    sections: parts.slice(1).map((p) => {
      const nl = p.indexOf("\n");
      return { heading: (nl < 0 ? p : p.slice(0, nl)).trim(), text: (nl < 0 ? "" : p.slice(nl + 1)).trim() };
    }),
  };
}

/** Markdown reflowed: paragraphs joined onto one line, list items, table rows and code lines kept one a line. */
function reflow(text: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // A code block is one call a line: kept as lines, the fence dropped.
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (line !== "") out.push(line);
      continue;
    }
    if (line === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const starts = /^([-*] |\d+\. |\| |- \[)/.test(line);
    if (!starts && out.length > 0 && out[out.length - 1] !== "") out[out.length - 1] += ` ${line}`;
    else out.push(line);
  }
  return out.join("\n").replace(/\n{2,}/g, "\n").trim();
}

/** `text` cut to `max` characters at the last line or sentence end before it, marked with "…". */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". ") + 1, head.lastIndexOf("; ") + 1);
  return `${(cut > max * 0.5 ? head.slice(0, cut) : head.replace(/\s+\S*$/, "")).trimEnd()} …`;
}

function findSection(all: readonly Section[], pattern: RegExp): Section | undefined {
  return all.find((s) => pattern.test(s.heading));
}

/** Seconds a structure row is for: "15 s", "30 s", "60-90 s" (the first number). */
function rowSeconds(cell: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)/.exec(cell);
  return m ? Number(m[1]) : undefined;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A beats cell's leading times ("0-4 cold open · 4 drop") scaled by `factor`; shot lengths inside a beat stay. */
function scaleBeats(cell: string, factor: number): string {
  return cell
    .split(" · ")
    .map((seg) => seg.replace(/^(\s*)(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?(?=\s)/, (_m, pad: string, a: string, b?: string) => `${pad}${round1(Number(a) * factor)}${b === undefined ? "" : `-${round1(Number(b) * factor)}`}`))
    .join(" · ");
}

/** The beats for `seconds`: the structure table's nearest row, its times scaled to the asked length. */
export function beatsFor(structure: Section, seconds: number): string {
  const rows = structure.text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|\s*-/.test(l.trim()))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const body = rows.slice(1);
  const lengths = body.map((r) => rowSeconds(r[0] ?? ""));
  const sized = body.map((r, i) => ({ r, s: lengths[i] })).filter((x): x is { r: string[]; s: number } => x.s !== undefined && /\bs\b|sec/.test(x.r[0] ?? ""));
  const after = structure.text.replace(/^\|.*$/gm, "").trim();
  if (sized.length === 0) {
    // A director recipe's table: one structure (its heading says the length), "t | what" rows.
    const lines = body.map((r) => `- ${r[0]}: ${r.slice(1).join(" · ")}`);
    return clip([`(${structure.heading.replace(/^Structure\s*/, "").replace(/^\(|\)$/g, "") || "as written"})`, ...lines, after ? reflow(after) : ""].filter(Boolean).join("\n"), 1100);
  }
  const best = sized.reduce((a, b) => (Math.abs(b.s - seconds) < Math.abs(a.s - seconds) ? b : a));
  const factor = seconds / best.s;
  const beats = Math.abs(factor - 1) < 0.05 ? best.r.slice(1).join(" · ") : scaleBeats(best.r.slice(1).join(" · "), factor);
  const from = Math.abs(factor - 1) < 0.05 ? `${best.r[0]}` : `${round1(seconds)} s, scaled from the ${best.r[0]} row`;
  return clip(`(${from}) ${beats}${after ? `\n${reflow(after)}` : ""}`, 1100);
}

/** Which sections a style's text keeps, under what label, and how long each may be. */
const STYLE_PARTS: readonly { label: string; heading: RegExp; max: number }[] = [
  { label: "Look", heading: /^Look/, max: 380 },
  { label: "Type", heading: /^Type/, max: 330 },
  { label: "Motion", heading: /^Motion/, max: 350 },
  { label: "Sound", heading: /^Sound/, max: 520 },
  // The tool sequence gets what the other parts leave (director recipes have no look, type or sound sections).
  { label: "Tool sequence", heading: /^(Tool sequence|Tools)$/, max: 0 },
  { label: "Finish", heading: /^Finish \(/, max: 700 },
  { label: "Finish checklist", heading: /^(Finish checklist|Checks)$/, max: 800 },
];

/**
 * One style's compact recipe for an edit of `seconds`: what it is, the beats
 * with timings for that length, look, type, motion, sound, the exact tool
 * sequence and the finish checklist. Reference moments, examples and
 * mix-and-match stay in the file (zenvi://styles/<id>).
 */
export function compactStyle(file: StyleFile, seconds: number): string {
  const meta = styleMeta(file);
  const doc = sections(splitFrontMatter(file.markdown).body);
  const out: string[] = [`# ${doc.title || file.id} (style ${file.id}; pace ${meta.pace || "any"}; ${meta.aspect.join(" ") || "any aspect"})`, file.summary];
  // Director recipes open with their character in prose; the zenvi-styles files have "When to use / not".
  const when = findSection(doc.sections, /^When to use/);
  if (when) out.push(`When: ${clip(reflow(when.text), 380)}`);
  else if (doc.intro) out.push(clip(reflow(doc.intro), 700));
  const structure = findSection(doc.sections, /^Structure/);
  if (structure) out.push(`## Beats ${beatsFor(structure, seconds)}`);
  const parts = STYLE_PARTS.map((part) => ({ part, s: findSection(doc.sections, part.heading) }));
  const fixed = parts.map(({ part, s }) => (s && part.max > 0 ? `## ${part.label}\n${clip(reflow(s.text), part.max)}` : ""));
  const borrow = meta.pairs_with.length > 0 ? `Borrow (get_technique_tool): ${meta.pairs_with.slice(0, 6).join(", ")}.` : "";
  const used = [...out, ...fixed, borrow].join("\n").length;
  parts.forEach(({ part, s }, i) => {
    if (s && part.max === 0) fixed[i] = `## ${part.label}\n${clip(reflow(s.text), Math.max(900, STYLE_TEXT_MAX - used - 40))}`;
  });
  out.push(...fixed.filter(Boolean));
  if (borrow) out.push(borrow);
  return clip(out.join("\n"), STYLE_TEXT_MAX);
}

const TECHNIQUE_PARTS: readonly { label: string; heading: RegExp; max: number }[] = [
  { label: "What it is", heading: /^What it is/, max: 500 },
  { label: "Build it in Zenvi", heading: /^Build it/, max: 2000 },
  { label: "Timing & taste", heading: /^Timing/, max: 800 },
  { label: "Sound", heading: /^Sound/, max: 380 },
  { label: "Common mistakes", heading: /^Common mistakes/, max: 380 },
];

/** One technique's build steps (or a family's or method's rules, cut to the same size). */
export function compactTechnique(file: StyleFile): string {
  const doc = sections(splitFrontMatter(file.markdown).body);
  const head = `# ${doc.title || file.id} (${file.kind} ${file.id})`;
  const parts = TECHNIQUE_PARTS.flatMap((part) => {
    const s = findSection(doc.sections, part.heading);
    return s ? [`## ${part.label}\n${clip(reflow(s.text), part.max)}`] : [];
  });
  if (parts.length === 0) {
    const all = [doc.intro, ...doc.sections.map((s) => `## ${s.heading}\n${s.text}`)].filter(Boolean).join("\n");
    return clip(`${head}\n${reflow(all)}`, TECHNIQUE_TEXT_MAX);
  }
  return clip([head, file.summary, ...parts].filter(Boolean).join("\n"), TECHNIQUE_TEXT_MAX);
}

/** The finish tools whose arguments a style sets (its look, its sound, its loudness). */
export const FINISH_TOOLS = ["unify_grade_tool", "apply_motion_transitions_tool", "auto_sound_design_tool", "master_audio_tool"] as const;

export interface StyleCall {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * The style's own finish calls: the first `tool {json}` the file writes for
 * each finish tool. A look written in prose ("`unify_grade_tool`, `warm_pop`
 * 0.3-0.4") becomes the call when `isLook` knows the id (the LUT table is the
 * tools'); the intensity is the middle of the range written after it.
 */
export function styleFinishCalls(file: StyleFile, isLook: (id: string) => boolean = () => false): StyleCall[] {
  const found = new Map<string, Record<string, unknown>>();
  // `tool {json}` (the styles) or `tool` `{json}` (the director recipes).
  for (const m of file.markdown.matchAll(/`([a-z_]+_tool)(?:`\s*`|\s*)(\{[^`]*\})`/g)) {
    const tool = m[1]!;
    if (!(FINISH_TOOLS as readonly string[]).includes(tool) || found.has(tool)) continue;
    try {
      const args = JSON.parse(m[2]!.replace(/\s+/g, " ")) as unknown;
      // Placeholders (`"<head clip>"`) are the reader's to fill: the call keeps the rest.
      if (args && typeof args === "object" && !Array.isArray(args)) found.set(tool, Object.fromEntries(Object.entries(args).filter(([, v]) => !(typeof v === "string" && /^<.*>$/.test(v)))));
    } catch {
      // Unquoted placeholders (`<drop>`): not a call to copy.
    }
  }
  const look = findSection(sections(splitFrontMatter(file.markdown).body).sections, /^Look/);
  if (!found.has("unify_grade_tool") && look && look.text.includes("`unify_grade_tool")) {
    const text = look.text.replace(/\s+/g, " ");
    const named = [...text.matchAll(/`([a-z0-9_]+)`(?:\s*(?:at|@)?\s*(\d?\.\d+)(?:\s*-\s*(\d?\.\d+))?)?/g)].find((m) => !m[1]!.endsWith("_tool") && isLook(m[1]!));
    const args: Record<string, unknown> = {};
    if (named) {
      args.look = named[1]!;
      if (named[2]) args.look_intensity = Math.round(((Number(named[2]) + Number(named[3] ?? named[2])) / 2) * 100) / 100;
    }
    found.set("unify_grade_tool", args);
  }
  return FINISH_TOOLS.flatMap((tool) => (found.has(tool) ? [{ tool, args: found.get(tool)! }] : []));
}

/** The style's finish checklist, one item a line, without the boxes. */
export function styleChecklist(file: StyleFile): string[] {
  const doc = sections(splitFrontMatter(file.markdown).body);
  const s = findSection(doc.sections, /^(Finish checklist|Checks)$/);
  if (!s) return [];
  const lines = reflow(s.text).split("\n");
  const items = lines.filter((l) => /^([-*] |\d+\. )/.test(l)).map((l) => l.replace(/^([-*] (\[.\] )?|\d+\. )/, "").trim());
  // The director recipes write their checks as prose: one check a sentence.
  return items.length > 0 ? items : lines.join(" ").split(/(?<=\.)\s+(?=[A-Z`])/).map((x) => x.trim()).filter(Boolean);
}

/** What the media bin holds, as far as choosing a style goes. */
export interface BinSignals {
  videos: number;
  images: number;
  /** Audio that is (or is named like) a voice. */
  voice: boolean;
  /** Audio that is not a voice: a bed to cut to. */
  music: boolean;
  /** The project's frame, e.g. "9:16". */
  aspect?: string;
}

export interface StylePick {
  id: string;
  score: number;
  summary: string;
  reasons: string[];
}

/** Front matter tools that mean the style is led by a voice. */
const SPEECH_TOOLS = new Set(["kinetic_captions_tool", "add_captions_tool", "generate_tts_and_add_to_timeline_tool", "get_transcript_tool", "transcribe_media_tool", "build_talking_head_tool", "build_explainer_tool"]);
/** Front matter tools that make pictures without footage. */
const MADE_TOOLS = new Set(["add_motion_block_tool", "add_3d_scene_tool", "add_motion_template_tool", "add_type_block_tool", "add_kinetic_title_tool"]);
const FAST = new Set(["fast", "frantic"]);

/**
 * The styles that fit a request and a bin, best first: the words the
 * request shares with each style (the auto brief's scoring, brief/auto.ts),
 * then what the bin holds (a voice, music, footage or none, many clips, the
 * frame). Every point has a reason.
 */
export function rankStyles(request: string, files: readonly StyleFile[], bin: BinSignals, count = 3): StylePick[] {
  const styles = files.filter((f) => f.kind === "style");
  const words = styleScores(request, styles.map((f) => ({ id: f.id, summary: `${f.summary} ${styleMeta(f).categories.join(" ").replace(/-/g, " ")} ${styleMeta(f).mood.join(" ")}` })));
  const picks = styles.map((f) => {
    const meta = styleMeta(f);
    const matched = words.get(f.id);
    let score = matched?.score ?? 0;
    const reasons: string[] = [];
    if (matched && matched.words.length > 0) reasons.push(`the request says ${matched.words.slice(0, 4).map((w) => `"${w}"`).join(", ")}`);
    const speech = meta.tools.some((t) => SPEECH_TOOLS.has(t));
    if (bin.voice && speech) {
      score += 2;
      reasons.push("the bin has a voice and this style is led by one");
    }
    if (!bin.voice && bin.videos + bin.images === 0 && meta.tools.some((t) => MADE_TOOLS.has(t))) {
      score += 1;
      reasons.push("no footage in the bin: this style makes its own pictures");
    }
    if (bin.music && !speech && FAST.has(meta.pace)) {
      score += 1;
      reasons.push("music in the bin to cut to");
    }
    if (bin.videos >= 10 && FAST.has(meta.pace)) {
      score += 1;
      reasons.push(`${bin.videos} clips feed a fast cut`);
    }
    if (bin.aspect && meta.aspect.length > 0 && !meta.aspect.includes(bin.aspect)) {
      score -= 1;
      reasons.push(`made for ${meta.aspect.join(" or ")}, the project is ${bin.aspect}`);
    }
    return { id: f.id, score, summary: f.summary, reasons };
  });
  // Ties keep the library's order (sorted by id) so the same request always gets the same answer.
  return picks.sort((a, b) => b.score - a.score).slice(0, count);
}

/** Ids of `kinds` that share a word with an unknown `id`, most shared first, for a refusal. */
export function nearestIds(id: string, files: readonly StyleFile[], kinds: readonly StyleFile["kind"][], count = 5): string[] {
  const want = new Set(id.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
  return files
    .filter((f) => kinds.includes(f.kind))
    .map((f) => ({ id: f.id, n: f.id.split("-").filter((w) => want.has(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
    .slice(0, count)
    .map((x) => x.id);
}
