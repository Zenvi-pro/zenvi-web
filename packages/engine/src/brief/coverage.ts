/**
 * The brief's footage plan against the bin: which storyboard shots the
 * person's own media covers, which stock or generated files already cover,
 * and what is still missing, with the one call that fetches each kind
 * (gather_stock_footage_tool in coherence mode, generate_broll_set_tool).
 *
 * Bench SK2: style examples cut from stock of unrelated shoots scored
 * 3.4-4.2/10, mostly for footage that did not belong to one film. Knowing
 * what is missing before fetching lets one coherent gather (or one
 * generated set) fill the gaps instead of a search per shot.
 */

import { isAudioOnlyMedia } from "../model/media.js";
import type { Project, ProjectFile } from "../model/types.js";
import { wordMatch } from "../stock/stock.js";
import type { Brief } from "./brief.js";
import { inventoryFiles } from "./inventory.js";

/** Where a bin file came from. */
export type FootageOrigin = "media" | "stock" | "generate";

/** covered: a file plays it; fetch / generate: still to get; ask: the person's file, not named or not there; built: motion, 3D or type. */
export type ShotStatus = "covered" | "fetch" | "generate" | "ask" | "built";

export interface ShotCoverage {
  /** Storyboard start ("2.5s") or the shot plan's beat. */
  at: string;
  picture: string;
  source: Brief["storyboard"][number]["source"];
  status: ShotStatus;
  file_id?: string;
  /** Where the covering file came from. */
  origin?: FootageOrigin;
  reason?: string;
}

export interface NextCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface FootageCoverage {
  shots: ShotCoverage[];
  /** Seconds of the brief per footage shot. */
  seconds_per_shot: number | null;
  counts: Record<ShotStatus, number>;
  /** The person's picture files no shot uses and the timeline does not play. */
  unused_media: string[];
  next: NextCall[];
}

/** A word match at least this good names the file that covers a shot without a file_id. */
const MATCH = 0.5;
/** Most shots a gather or a generated set is asked for in one call (the tools' own limits). */
const MAX_QUERIES = 12;
const MAX_SET = 8;
/** Seconds per footage shot past which the plan is a slideshow (the styles cut every 1.5-3 s). */
const THIN_SECONDS = 4;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const GENERATED_SOURCES = new Set(["kling_t2v", "ai_image_generation", "broll_set"]);

/** Stock (gather and import_stock_media name downloads pexels_<id>.mp4), generated (stamped ai_generated), or the person's. */
export function footageOrigin(file: ProjectFile): FootageOrigin {
  const ai = record(file.ai_metadata);
  if (ai.source === "pexels" || /(^|[\\/])pexels_\d+\.mp4$/i.test(String(file.path ?? ""))) return "stock";
  const tags = String((file as { tags?: unknown }).tags ?? "").split(",").map((t) => t.trim());
  if (tags.includes("ai_generated") || GENERATED_SOURCES.has(String(ai.source ?? ""))) return "generate";
  return "media";
}

/** Everything a file says about its picture: the query or prompt it was made from, the indexer's words, its name. */
function fileText(file: ProjectFile): string {
  const ai = record(file.ai_metadata);
  return [ai.query, ai.broll_shot, ai.prompt, ai.short_summary, ai.description, file.name, String(file.path ?? "").split(/[\\/]/).pop()]
    .filter((v) => typeof v === "string")
    .join(" ");
}

function isPicture(file: ProjectFile): boolean {
  return !isAudioOnlyMedia(file) && !/\.svg$/i.test(String(file.path ?? ""));
}

interface Row {
  at: string;
  picture: string;
  source: ShotCoverage["source"];
  file_id?: string;
}

function rowsOf(brief: Brief): Row[] {
  if (brief.storyboard.length > 0) return brief.storyboard.map((r) => ({ at: `${r.start}s`, picture: r.picture, source: r.source, file_id: r.file_id }));
  return brief.shots.map((s, i) => ({ at: s.beat ?? `shot ${i + 1}`, picture: s.note, source: s.source, file_id: s.file_id }));
}

/** The best word match for `picture` among `files`, unassigned files first. */
function bestFile(picture: string, files: readonly ProjectFile[], assigned: ReadonlySet<string>): ProjectFile | null {
  let best: ProjectFile | null = null;
  let bestScore = MATCH - 1e-9;
  for (const file of files) {
    const score = wordMatch(picture, fileText(file)) - (assigned.has(String(file.id)) ? 0.25 : 0);
    if (score > bestScore) {
      best = file;
      bestScore = score;
    }
  }
  return best;
}

/** What the bin covers of the brief's shot plan, and the calls that fetch or generate the rest. */
export function footageCoverage(project: Project, brief: Brief): FootageCoverage {
  const files = inventoryFiles(project).filter(isPicture);
  const byId = new Map(files.map((f) => [String(f.id), f]));
  const own = files.filter((f) => footageOrigin(f) === "media");
  const fetched = files.filter((f) => footageOrigin(f) !== "media");
  const assigned = new Set<string>();
  const rows = rowsOf(brief);
  // Named files first, so a word match never takes a file a row asked for.
  for (const row of rows) if (row.file_id && byId.has(row.file_id)) assigned.add(row.file_id);

  const planned: (ShotCoverage | null)[] = rows.map((row) => {
    const base = { at: row.at, picture: row.picture, source: row.source };
    if (row.source === "motion" || row.source === "3d" || row.source === "title") return { ...base, status: "built" };
    if (row.file_id) {
      const file = byId.get(row.file_id);
      return file
        ? { ...base, status: "covered", file_id: row.file_id, origin: footageOrigin(file) }
        : { ...base, status: row.source === "media" ? "ask" : row.source === "stock" ? "fetch" : "generate", reason: `file ${row.file_id} is not in the bin` };
    }
    // The person's media first: their footage belongs to the film; then what was fetched or generated already.
    const match = bestFile(row.picture, own, assigned) ?? bestFile(row.picture, fetched, assigned);
    if (!match) return null;
    assigned.add(String(match.id));
    return { ...base, status: "covered", file_id: String(match.id), origin: footageOrigin(match) };
  });
  // Rows no words matched, once every word match has its file.
  const shots = rows.map((row, i): ShotCoverage => {
    const done = planned[i];
    if (done) return done;
    const base = { at: row.at, picture: row.picture, source: row.source };
    // Bench P5: agents plan rows without file ids over files with no words to match (unindexed shot_01.mp4,
    // import_stock_media_tool's pexels_<id>.mp4 without its query): the next file of that origin no row has taken stands in.
    const origin: FootageOrigin = row.source === "media" ? "media" : row.source === "stock" ? "stock" : "generate";
    const next = files.find((f) => footageOrigin(f) === origin && !assigned.has(String(f.id)));
    if (next) {
      assigned.add(String(next.id));
      return { ...base, status: "covered", file_id: String(next.id), origin, reason: "assumed: name its file_id in the storyboard" };
    }
    if (row.source === "media") return { ...base, status: "ask", reason: own.length > 0 ? "no file of yours shows it: name its file_id, or fetch / generate it" : "the bin has no footage of yours" };
    return { ...base, status: row.source === "stock" ? "fetch" : "generate" };
  });

  const counts: Record<ShotStatus, number> = { covered: 0, fetch: 0, generate: 0, ask: 0, built: 0 };
  for (const s of shots) counts[s.status] += 1;
  const used = new Set(project.clips.map((c) => String(c.file_id ?? "")));
  const unused = own.filter((f) => !assigned.has(String(f.id)) && !used.has(String(f.id))).map((f) => String(f.id));

  // The look the fetched and generated shots should match: the first of the person's files the plan uses, else their first file.
  const anchor = shots.find((s) => s.status === "covered" && s.origin === "media")?.file_id ?? own[0]?.id;
  const next: NextCall[] = [];
  const toFetch = shots.filter((s) => s.status === "fetch").map((s) => s.picture.slice(0, 200));
  if (toFetch.length > 0) {
    const queries = [...new Set(toFetch)].slice(0, MAX_QUERIES);
    next.push({
      tool: "gather_stock_footage_tool",
      args: { queries, count: Math.min(30, Math.ceil(toFetch.length * 1.5)), coherence: "shoot", ...(anchor ? { match_file_id: String(anchor) } : {}) },
    });
  }
  const toGenerate = shots.filter((s) => s.status === "generate").map((s) => s.picture);
  if (toGenerate.length > 0) {
    const style = [brief.palette, ...brief.direction.filter((d) => /palette|camera|finish|art/i.test(d.axis)).map((d) => d.pick)].filter(Boolean).join("; ").slice(0, 400);
    next.push({
      tool: "generate_broll_set_tool",
      args: { shots: [...new Set(toGenerate)].slice(0, MAX_SET), ...(style ? { style } : {}), ...(anchor ? { reference_file_id: String(anchor) } : {}) },
    });
  }
  const footage = shots.length - counts.built;
  const perShot = footage > 0 ? Math.round((brief.length_seconds / footage) * 10) / 10 : null;
  return { shots, counts, seconds_per_shot: perShot, unused_media: unused, next };
}

/** The coverage as receipt lines; none when the brief plans no footage. */
export function coverageLines(coverage: FootageCoverage, project: Project): string[] {
  const { counts, shots } = coverage;
  const footage = shots.length - counts.built;
  if (footage === 0) return [];
  const origins = (o: FootageOrigin) => shots.filter((s) => s.status === "covered" && s.origin === o).length;
  const covered = [origins("media") && `${origins("media")} by your media`, origins("stock") && `${origins("stock")} by stock`, origins("generate") && `${origins("generate")} generated`].filter(Boolean);
  const missing = [counts.fetch && `${counts.fetch} to fetch`, counts.generate && `${counts.generate} to generate`, counts.ask && `${counts.ask} need a file from the person`].filter(Boolean);
  const lines = [
    `Footage: ${counts.covered}/${footage} shots covered${covered.length ? ` (${covered.join(", ")})` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}.`,
  ];
  if (coverage.seconds_per_shot !== null && coverage.seconds_per_shot > THIN_SECONDS) {
    lines.push(
      `Thin: ${footage} footage shot(s) for the whole piece, one every ${coverage.seconds_per_shot} s. Product, brand and explainer edits cut every 1.5-3 s: ` +
        "plan more shots (several moments of one file count), and fetch or generate what the bin lacks.",
    );
  }
  for (const s of shots.filter((r) => r.status === "fetch" || r.status === "generate" || r.status === "ask").slice(0, 8)) {
    lines.push(`- ${s.at} "${s.picture.slice(0, 80)}": ${s.status}${s.reason ? ` (${s.reason})` : ""}`);
  }
  if (coverage.unused_media.length > 0) {
    const names = coverage.unused_media.slice(0, 5).map((id) => {
      const file = project.files.find((f) => String(f.id) === id);
      return `${id} ${String(file?.name || String(file?.path ?? "").split(/[\\/]/).pop())}`;
    });
    lines.push(`Your media no shot uses: ${names.join(", ")}${coverage.unused_media.length > 5 ? ` and ${coverage.unused_media.length - 5} more` : ""}. Use it before stock: it belongs to the film.`);
  }
  for (const call of coverage.next) lines.push(`Next: ${call.tool} ${JSON.stringify(call.args)}`);
  if (coverage.next.length > 0) lines.push("Then cut, and unify_grade_tool on the assembled set so every source shares one grade.");
  return lines;
}
