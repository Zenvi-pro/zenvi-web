/**
 * gather_stock_footage_tool: several Pexels searches and the best N distinct
 * clips imported in one call, with a compact list back.
 *
 * Bench round 3: agents searched once or twice per story beat and stopped to
 * save spend (a search plus an import per clip is ~two calls and a page of
 * results each), so montages cycled 7-10 sources and shots came back within
 * 3 s in 16 of 28 runs. One call that searches, ranks, dedupes and imports
 * costs one result of a line per clip.
 *
 * Distinct means: not the same Pexels video twice, not two takes of one
 * shoot (same contributor, same page words: stock/stock.ts sameShoot), not
 * already in the project, and, where the host can render frames, not a
 * frame that looks the same as one already taken (stock/frame-hash.ts).
 */

import { z } from "zod";
import { addFile } from "../../ops/files.js";
import { pickStockFile, sameShoot, stockRelevance, type PexelsVideo } from "../../stock/stock.js";
import { NEAR_DUPLICATE_BITS, frameHash, hashDistance } from "../../stock/frame-hash.js";
import { mediaFileProject, renderPixels, secondsToFrame } from "../color-frames.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, refused } from "../receipt.js";
import type { ImportedMedia } from "../types.js";
import { provisionalFile } from "./clips.js";
import { rememberFile } from "./common.js";

const TOOL = "gather_stock_footage_tool";
/** Downloads at once. */
const BATCH = 4;
/** Results asked of Pexels per query (its page size cap is 80; deeper pages drift off the subject). */
const PER_QUERY = 15;
/** Width the near-duplicate check renders a frame at. */
const HASH_WIDTH = 48;

type Orientation = "portrait" | "landscape" | "square";
const shape = (w: number, h: number): Orientation => (h > w ? "portrait" : w > h ? "landscape" : "square");

const input = z.strictObject({
  queries: z
    .union([z.array(z.string().trim().min(1).max(200)).min(1).max(12), z.string().trim().min(1).max(1200)])
    .describe("What the footage shows, one search per shot idea, e.g. ['nautilus shell macro', 'spiral galaxy', 'hurricane from space']. A string is split on ';' or new lines."),
  count: z
    .union([z.int().min(1).max(30), z.string().regex(/^\d+$/)])
    .optional()
    .describe("Clips to import in all (1-30, default 8), taken round-robin across the queries, best first."),
  orientation: z.enum(["any", "portrait", "landscape"]).optional().describe("Keep only this orientation (default: the project's; any takes both)."),
  min_seconds: z.number().min(0).max(60).optional().describe("Shortest clip wanted, seconds (default 3)."),
  max_seconds: z.number().min(1).max(600).optional().describe("Longest clip wanted, seconds (default 60: long takes download slowly)."),
});

type Args = z.infer<typeof input>;

interface Candidate {
  video: PexelsVideo;
  query: string;
  link: string;
}

interface Taken extends Candidate {
  media: ImportedMedia;
}

function queryList(raw: Args["queries"]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[;\n]+/);
  return [...new Set(list.map((q) => q.trim()).filter(Boolean))].slice(0, 12);
}

/** Pexels ids already in the project (import_stock_media_tool names downloads pexels_<id>.mp4). */
function importedIds(paths: readonly string[]): Set<number> {
  const ids = new Set<number>();
  for (const p of paths) {
    const m = /pexels_(\d+)\.mp4$/i.exec(p);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

async function download(call: ToolCall, c: Candidate): Promise<ImportedMedia | string> {
  try {
    return await call.host.media!.importUrl!(c.link, { filename: `pexels_${c.video.id}.mp4`, signal: call.signal });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The frame 40 % into a downloaded clip as a hash, or null where it cannot be rendered or is flat. */
async function hashOf(call: ToolCall, media: ImportedMedia): Promise<boolean[] | null> {
  if (!call.host.frames) return null;
  const file = provisionalFile(media, { id: "GATHERPROBE" });
  const duration = Number(file.duration) || 0;
  try {
    const project = mediaFileProject(call.doc.project, file, duration);
    const { pixels } = await renderPixels(call, project, secondsToFrame(project, duration * 0.4), HASH_WIDTH);
    return frameHash(pixels);
  } catch {
    return null;
  }
}

export const stockGatherTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Gather stock footage",
    description:
      "Search Pexels with several queries at once and import the best distinct clips in ONE call: ranked by how well each page matches its query, the orientation and length you ask for, " +
      "taken round-robin so every query gets clips, without duplicates (the same video, takes of one shoot, clips already in the project, frames that look the same). " +
      "Returns one line per imported file (file_id, length, size, query). Use it instead of search_pexels_videos_tool + import_stock_media_tool per clip when a montage needs many sources: " +
      "a cut at 3-4 shots a second wants 10-15 different clips so none comes back within 3 s. One undo step.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["stock", "media"],
    run: async (call, args: Args) => {
      if (!call.host.media?.importUrl) return unavailable(TOOL, "it cannot download media from URLs.");
      const queries = queryList(args.queries);
      if (queries.length === 0) return refused(TOOL, "Error: give at least one query.");
      const count = Math.max(1, Math.min(30, Math.trunc(Number(args.count ?? 8)) || 8));
      const minSeconds = args.min_seconds ?? 3;
      const maxSeconds = args.max_seconds ?? 60;
      if (maxSeconds < minSeconds) return refused(TOOL, "Error: max_seconds must be at least min_seconds.");
      const project = call.doc.project;
      const portrait = project.height > project.width;
      const want = args.orientation ?? (portrait ? "portrait" : "landscape");

      const warnings: string[] = [];
      const found = await Promise.all(
        queries.map((q) =>
          call.host.stock!.searchPexelsVideos(q, { perPage: PER_QUERY, signal: call.signal }).catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
        ),
      );
      const skipped = { already_imported: 0, duplicate: 0, same_shoot: 0, looks_the_same: 0, wrong_orientation: 0, wrong_length: 0, download_failed: 0 };
      const have = importedIds(project.files.map((f) => String(f.path ?? "")));
      // Each query's usable results, best first.
      const lists: Candidate[][] = found.map((result, i) => {
        const query = queries[i]!;
        if (typeof result === "string") {
          warnings.push(`Search '${query}' failed: ${result}`);
          return [];
        }
        const usable: Candidate[] = [];
        for (const video of result.videos) {
          if (have.has(video.id)) {
            skipped.already_imported += 1;
            continue;
          }
          if (want !== "any" && shape(video.width, video.height) !== want) {
            skipped.wrong_orientation += 1;
            continue;
          }
          if (!(video.duration >= minSeconds && video.duration <= maxSeconds)) {
            skipped.wrong_length += 1;
            continue;
          }
          const link = pickStockFile(video, project.width, portrait)?.link;
          if (link) usable.push({ video, query, link });
        }
        // Stable: Pexels' own order breaks ties.
        return usable.map((c, k) => ({ c, k, score: stockRelevance(c.video, query) })).sort((a, b) => b.score - a.score || a.k - b.k).map((e) => e.c);
      });
      const empty = queries.filter((_, i) => lists[i]!.length === 0);
      if (empty.length > 0) warnings.push(`No usable results for ${empty.map((q) => `'${q}'`).join(", ")}: try other words${want !== "any" ? ` or orientation=any` : ""}.`);

      // Round-robin across the queries; a candidate is checked against everything downloaded or queued.
      const picked: Candidate[] = [];
      const order: Candidate[] = [];
      const takeFrom = (list: Candidate[]): Candidate | null => {
        while (list.length > 0) {
          const c = list.shift()!;
          const others = [...picked, ...order];
          if (others.some((p) => p.video.id === c.video.id)) skipped.duplicate += 1;
          else if (others.some((p) => sameShoot(p.video, c.video))) skipped.same_shoot += 1;
          else return c;
        }
        return null;
      };
      // One pass over the queries per round keeps the mix even: query 1, query 2, ... then query 1 again.
      const fill = (n: number) => {
        while (order.length < n) {
          const before = order.length;
          for (const list of lists) {
            if (order.length >= n) break;
            const c = takeFrom(list);
            if (c) order.push(c);
          }
          if (order.length === before) break;
        }
      };

      const taken: Taken[] = [];
      const hashes: boolean[][] = [];
      fill(count);
      while (taken.length < count && order.length > 0) {
        const batch = order.splice(0, BATCH);
        picked.push(...batch);
        const results = await Promise.all(batch.map((c) => download(call, c)));
        for (const [i, result] of results.entries()) {
          const c = batch[i]!;
          if (typeof result === "string") {
            skipped.download_failed += 1;
            warnings.push(`Pexels ${c.video.id} ('${c.query}') did not download: ${result}`);
            continue;
          }
          if (taken.length >= count) continue;
          const hash = await hashOf(call, result);
          if (hash && hashes.some((h) => hashDistance(h, hash) <= NEAR_DUPLICATE_BITS)) {
            skipped.looks_the_same += 1;
            continue;
          }
          if (hash) hashes.push(hash);
          taken.push({ ...c, media: result });
        }
        fill(count - taken.length);
      }
      if (taken.length === 0) return refused(TOOL, `Error: no clip could be imported for ${queries.map((q) => `'${q}'`).join(", ")}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
      if (taken.length < count) warnings.push(`Imported ${taken.length} of ${count}: the queries ran out of distinct clips. Add queries (other subjects, angles, places) for more.`);

      const files = call.commit((tx) => taken.map((t) => addFile(tx, t.media, { dedupe: true })), `Gather stock footage (${taken.length})`);
      rememberFile(call, String(files[files.length - 1]!.id));
      const rows = taken.map((t, i) => ({
        file_id: String(files[i]!.id),
        query: t.query,
        duration_seconds: t.video.duration,
        width: t.video.width,
        height: t.video.height,
        orientation: shape(t.video.width, t.video.height),
        pexels_id: t.video.id,
        user: t.video.user_name ?? "",
        page_url: t.video.url ?? `https://www.pexels.com/video/${t.video.id}/`,
      }));
      const dropped = Object.entries(skipped).filter(([, n]) => n > 0);
      const lines = [
        `Imported ${rows.length} clip(s) from ${queries.length} search(es)${dropped.length ? ` (skipped: ${dropped.map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")})` : ""}:`,
        ...rows.map((r) => `  file_id=${r.file_id}  ${r.duration_seconds}s  ${r.width}×${r.height}  '${r.query}'`),
      ];
      return applied(TOOL, lines.join("\n"), { warnings, data: { files: rows, skipped, queries } });
    },
  }),
];
