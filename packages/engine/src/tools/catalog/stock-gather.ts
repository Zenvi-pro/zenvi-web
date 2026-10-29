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
 *
 * coherence=shoot turns "distinct" toward "one film" (tools/stock-coherence.ts):
 * contributors who shot several of the searches come first and takes of
 * one shoot are welcome; a clip whose light, grade or lens sits far from
 * the set's (or from match_file_id, the person's own footage) waits behind
 * every clip that fits and is taken only when nothing closer is left.
 * Every import records its query and contributor, so a later gather and the
 * brief's footage plan (brief/coverage.ts) know where it came from.
 */

import { z } from "zod";
import { addFile } from "../../ops/files.js";
import { pickStockFile, sameShoot, stockRelevance, type PexelsVideo } from "../../stock/stock.js";
import { NEAR_DUPLICATE_BITS, frameHash, hashDistance } from "../../stock/frame-hash.js";
import { mediaFileProject, renderPixels, secondsToFrame } from "../color-frames.js";
import { COHERENT_LOOK, coherenceOrder, creatorReach, lookDistance, lookOf, type StockLook } from "../stock-coherence.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, refused } from "../receipt.js";
import type { ImportedMedia } from "../types.js";
import { provisionalFile } from "./clips.js";
import { record, rememberFile } from "./common.js";
import type { ProjectFile } from "../../model/types.js";

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
  coherence: z
    .enum(["off", "shoot"])
    .optional()
    .describe(
      "shoot: footage for ONE film - contributors who shot several of the queries first, takes of one shoot allowed, clips whose light, grade and lens are far from the set's held back. " +
        "Use it for product, brand and explainer edits (default off: the most varied clips, for montages).",
    ),
  match_file_id: z.string().trim().min(1).max(40).optional().describe("coherence=shoot: a media-bin file (the person's own footage) whose look the stock should match. Default: the first clip taken."),
});

type Args = z.infer<typeof input>;

interface Candidate {
  video: PexelsVideo;
  query: string;
  link: string;
  score?: number;
}

interface Taken extends Candidate {
  media: ImportedMedia;
  /** Distance from the set's look (coherence=shoot), squared tolerances. */
  distance?: number;
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

/** The frame 40 % into a clip as a hash and a look, nulls where it cannot be rendered (or is flat). */
async function probeFrame(call: ToolCall, file: ProjectFile, withLook: boolean): Promise<{ hash: boolean[] | null; look: StockLook | null }> {
  if (!call.host.frames) return { hash: null, look: null };
  const duration = Number(file.duration) || 0;
  try {
    const project = mediaFileProject(call.doc.project, file, duration);
    const { pixels } = await renderPixels(call, project, secondsToFrame(project, duration * 0.4), HASH_WIDTH);
    return { hash: frameHash(pixels), look: withLook ? lookOf(pixels) : null };
  } catch {
    return { hash: null, look: null };
  }
}

/** Contributors of the stock already in the project (this tool records them). */
function knownCreators(files: readonly ProjectFile[]): Set<string> {
  const users = new Set<string>();
  for (const f of files) {
    const ai = record(f.ai_metadata);
    if (ai.source === "pexels" && typeof ai.creator === "string" && ai.creator) users.add(ai.creator);
  }
  return users;
}

export const stockGatherTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Gather stock footage",
    description:
      "Search Pexels with several queries at once and import the best distinct clips in ONE call: ranked by how well each page matches its query, the orientation and length you ask for, " +
      "taken round-robin so every query gets clips, without duplicates (the same video, takes of one shoot, clips already in the project, frames that look the same). " +
      "Returns one line per imported file (file_id, length, size, query). Use it instead of search_pexels_videos_tool + import_stock_media_tool per clip when a montage needs many sources: " +
      "a cut at 3-4 shots a second wants 10-15 different clips so none comes back within 3 s. " +
      "coherence='shoot' gathers for ONE film instead (product, brand, explainer): one contributor's shoot across the queries where it exists, matching light, grade and lens (match_file_id: the person's footage), so the cut does not look like clips of unrelated shoots. One undo step.",
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
      const coherent = args.coherence === "shoot";
      if (args.match_file_id && !coherent) return refused(TOOL, "Error: match_file_id needs coherence='shoot'.");
      const matchFile = args.match_file_id ? project.files.find((f) => String(f.id) === args.match_file_id) : undefined;
      if (args.match_file_id && !matchFile) return refused(TOOL, `Error: media-bin file ${args.match_file_id} not found.`);

      const warnings: string[] = [];
      const found = await Promise.all(
        queries.map((q) =>
          call.host.stock!.searchPexelsVideos(q, { perPage: PER_QUERY, signal: call.signal }).catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
        ),
      );
      const skipped = { already_imported: 0, duplicate: 0, same_shoot: 0, looks_the_same: 0, off_look: 0, wrong_orientation: 0, wrong_length: 0, download_failed: 0 };
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
        return usable
          .map((c, k) => ({ c, k, score: stockRelevance(c.video, query) }))
          .sort((a, b) => b.score - a.score || a.k - b.k)
          .map((e) => ({ ...e.c, score: e.score }));
      });
      const reach = coherent ? creatorReach(lists, knownCreators(project.files)) : new Map<string, number>();
      if (coherent) lists.forEach((list, i) => (lists[i] = coherenceOrder(list, reach)));
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
          else if (!coherent && others.some((p) => sameShoot(p.video, c.video))) skipped.same_shoot += 1;
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
      // coherence=shoot: the look the set keeps (the person's file, else the first clip taken) and the clips that missed it.
      let anchor: StockLook | null = matchFile ? (await probeFrame(call, matchFile, true)).look : null;
      if (matchFile && !anchor) warnings.push(`Could not measure ${args.match_file_id}'s look on this surface: the first clip taken sets it.`);
      const held: Taken[] = [];
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
          const { hash, look } = await probeFrame(call, provisionalFile(result, { id: "GATHERPROBE" }), coherent);
          if (hash && hashes.some((h) => hashDistance(h, hash) <= NEAR_DUPLICATE_BITS)) {
            skipped.looks_the_same += 1;
            continue;
          }
          if (hash) hashes.push(hash);
          if (coherent && look) {
            anchor ??= look;
            const distance = lookDistance(look, anchor);
            if (distance > COHERENT_LOOK) {
              skipped.off_look += 1;
              held.push({ ...c, media: result, distance });
              continue;
            }
            taken.push({ ...c, media: result, distance });
            continue;
          }
          taken.push({ ...c, media: result });
        }
        fill(count - taken.length);
      }
      // Clips off the look fill in only when nothing closer is left, closest first.
      const fillers = held.sort((a, b) => a.distance! - b.distance!).slice(0, Math.max(0, count - taken.length));
      if (fillers.length > 0) {
        skipped.off_look -= fillers.length;
        taken.push(...fillers);
        warnings.push(`${fillers.length} clip(s) are off the set's look (light, grade or lens): unify_grade_tool pulls them in, or add queries a shoot of the set covers.`);
      }
      if (taken.length === 0) return refused(TOOL, `Error: no clip could be imported for ${queries.map((q) => `'${q}'`).join(", ")}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
      if (taken.length < count) warnings.push(`Imported ${taken.length} of ${count}: the queries ran out of distinct clips. Add queries (other subjects, angles, places) for more.`);

      const files = call.commit(
        (tx) =>
          taken.map((t) => {
            const file = addFile(tx, t.media, { dedupe: true });
            const stock = { source: "pexels", query: t.query, creator: t.video.user_name ?? "", pexels_id: t.video.id };
            tx.update(["files", { id: file.id }], { ai_metadata: { ...record(file.ai_metadata), ...stock } });
            return file;
          }),
        `Gather stock footage (${taken.length})`,
      );
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
        ...(t.distance !== undefined ? { look_distance: Math.round(t.distance * 10) / 10 } : {}),
      }));
      const dropped = Object.entries(skipped).filter(([, n]) => n > 0);
      const lines = [
        `Imported ${rows.length} clip(s) from ${queries.length} search(es)${dropped.length ? ` (skipped: ${dropped.map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")})` : ""}:`,
        ...rows.map((r) => `  file_id=${r.file_id}  ${r.duration_seconds}s  ${r.width}×${r.height}  '${r.query}'`),
      ];
      let coherence: Record<string, unknown> | undefined;
      if (coherent) {
        const creators = new Map<string, number>();
        for (const r of rows) creators.set(r.user, (creators.get(r.user) ?? 0) + 1);
        const top = [...creators].sort((a, b) => b[1] - a[1])[0]!;
        const reference = args.match_file_id ?? rows[0]!.file_id;
        coherence = { creators: creators.size, top_creator: top[0], top_creator_clips: top[1], look_reference: reference, measured: anchor !== null };
        lines.push(
          `One film: ${creators.size} contributor(s), ${top[1]} clip(s) from ${top[0] || "one contributor"}${anchor ? `; look matched to ${reference}` : "; looks not measured on this surface"}. ` +
            `Next: cut them, then unify_grade_tool reference_file_id=${reference} so every shot shares one grade.`,
        );
      }
      return applied(TOOL, lines.join("\n"), { warnings, data: { files: rows, skipped, queries, ...(coherence ? { coherence } : {}) } });
    },
  }),
];
