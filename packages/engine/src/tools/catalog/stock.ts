/**
 * Stock search on every web surface: the tools the desktop Assistant has in
 * the Zenvi backend (core/tools/stock_media_tools.py), with the same names,
 * arguments and result lines. Find Pexels videos or Freesound music through
 * the host's backend; import_stock_media_tool then downloads one into the
 * project. The web adds what a chat needs to choose and credit: a rendition
 * sized for this project's frame, the orientation, the music's licence.
 */

import { z } from "zod";
import { matchTempo, parseTempoRange, rangeAround, splitTempoFromQuery, tempoDistance } from "../../stock/music.js";
import { clockTime, licenceName, licenceRank, pickStockFile, previewOf, type FreesoundSound } from "../../stock/stock.js";
import { searchFreesound, searchPexelsVideos } from "../backend.js";
import { directTool, type CatalogTool } from "../define.js";
import { canMeasurePreviews, measurePreview, type PreviewMeasure } from "../music-measure.js";
import { applied, refused } from "../receipt.js";

const SEARCH = { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true } as const;

/** Previews measured at once, and at most, per search. */
const MEASURE_BATCH = 4;
const MAX_MEASURED = 24;

interface MusicResult {
  sound_id: number;
  name: string;
  duration_seconds: number;
  licence: string;
  licence_url: string;
  user: string;
  tags: string[];
  preview_url: string;
  page_url: string;
  /** Measured from the preview (absent where the surface cannot measure). */
  bpm?: number | null;
  bpm_confidence?: number;
  bpm_also?: number[];
  bpm_match?: "double-time" | "half-time";
  loudness_db?: number;
  peak_db?: number;
  energy?: string;
}

const count = z
  .union([z.int(), z.string().regex(/^\d+$/)])
  .optional()
  .describe("How many results (1-16, default 8).");

function resultCount(raw: number | string | undefined): number {
  const n = Math.trunc(Number(raw ?? 8));
  return Math.max(1, Math.min(16, Number.isFinite(n) ? n : 8));
}

export const stockTools: CatalogTool[] = [
  directTool({
    name: "search_pexels_videos_tool",
    title: "Search stock videos",
    description:
      "Search Pexels stock videos (free to use, credit optional). Returns ids, durations, sizes and an MP4 link sized for this project's frame, " +
      "the project's orientation first. To add one: import_stock_media_tool with source='pexels', its video_id and link (and position_seconds to place it).",
    input: z.strictObject({
      query: z.string().trim().min(1).max(200).describe("What the footage shows, e.g. 'barista pouring latte art close up'."),
      count,
      orientation: z.enum(["any", "portrait", "landscape"]).optional().describe("Orientation to put first (default: the project's)."),
    }),
    annotations: SEARCH,
    requires: ["backend"],
    run: async (call, args) => {
      const tool = "search_pexels_videos_tool";
      const n = resultCount(args.count);
      // Ask for more than shown, so the wanted orientation can come first.
      const found = await searchPexelsVideos(call, args.query, Math.min(16, n * 2));
      if ("error" in found) return refused(tool, `Error: Pexels search failed: ${found.error}`);
      const project = call.doc.project;
      const portrait = project.height > project.width;
      const want = args.orientation ?? (portrait ? "portrait" : "landscape");
      const shape = (w: number, h: number) => (h > w ? "portrait" : w > h ? "landscape" : "square");
      const ranked = [...found.videos].sort((a, b) => Number(want !== "any" && shape(a.width, a.height) !== want) - Number(want !== "any" && shape(b.width, b.height) !== want));
      const results = ranked
        .map((v) => ({ video: v, file: pickStockFile(v, project.width, portrait) }))
        .filter((r) => r.file?.link)
        .slice(0, n)
        .map(({ video, file }) => ({
          video_id: video.id,
          duration_seconds: video.duration,
          width: video.width,
          height: video.height,
          orientation: shape(video.width, video.height),
          link: file!.link!,
          link_width: file!.width ?? null,
          link_height: file!.height ?? null,
          user: video.user_name ?? "",
          page_url: video.url ?? `https://www.pexels.com/video/${video.id}/`,
          image: video.image ?? null,
        }));
      if (results.length === 0) return applied(tool, `No Pexels videos found for '${args.query}'.`, { data: { query: args.query, total: 0, results } }, 0);
      const lines = [
        `Pexels results for '${args.query}' (${found.total.toLocaleString("en-US")} total):`,
        ...results.map((r) => `  id=${r.video_id}  duration=${clockTime(r.duration_seconds)}  res=${r.link_width ?? "?"}×${r.link_height ?? "?"}  ${r.orientation}  user=${r.user}  link=${r.link}`),
      ];
      return applied(tool, lines.join("\n"), { data: { query: args.query, total: found.total, results } }, 0);
    },
  }),

  directTool({
    name: "search_freesound_music_tool",
    title: "Search stock music",
    description:
      "Search Freesound music and sound effects. Returns ids, durations, licences and MP3 preview URLs, open licences first (CC0, then CC BY; " +
      "non-commercial last), then longer tracks. With bpm, bpm_range or energy, the previews are downloaded and measured (where the surface can) and each result gets its tempo (bpm, confidence, other octave readings), level (loudness_db) and energy; a plain search is not measured. " +
      "Do not put a tempo in the query (Freesound matches words, so '128 bpm' finds pages that mention a number): give bpm or bpm_range and the tracks are filtered by their measured tempo, " +
      "a half- or double-time reading counts. Words like '120 bpm' in the query are moved to bpm_range for you. " +
      "To add one: import_stock_media_tool with source='freesound', its sound_id and preview_url. Credit CC BY sounds (user and link) wherever the video is published.",
    input: z.strictObject({
      query: z.string().trim().min(1).max(200).describe("Genre or sound, e.g. 'upbeat lo-fi hip hop' or 'whoosh'. No tempo here: use bpm / bpm_range."),
      count,
      min_seconds: z
        .union([z.number().min(0).max(3600), z.string().regex(/^\d+(\.\d+)?$/)])
        .optional()
        .describe("Shortest track wanted, seconds (e.g. the video's length for a music bed)."),
      bpm: z
        .union([z.number().min(40).max(300), z.string().regex(/^\d+(\.\d+)?$/)])
        .optional()
        .describe("Wanted tempo, BPM: tracks within about 5% of it, or whose half or double reading is."),
      bpm_range: z
        .union([z.array(z.number().min(40).max(300)).length(2), z.string().max(40)])
        .optional()
        .describe("Wanted tempo range, [min, max] or 'min-max' BPM (instead of bpm), e.g. '150-170' for a hype cut."),
      mood: z.string().trim().max(100).optional().describe("Mood words added to the search, e.g. 'dark energetic'. Dropped if they leave no results."),
      energy: z.enum(["low", "medium", "high"]).optional().describe("Keep tracks of this energy (level and how hard the beats hit, measured); hype cuts want high."),
    }),
    annotations: SEARCH,
    requires: ["backend"],
    run: async (call, args) => {
      const tool = "search_freesound_music_tool";
      const n = resultCount(args.count);
      const warnings: string[] = [];

      // The tempo the caller wants: bpm_range, bpm, or the numbers they typed into the query.
      const typed = splitTempoFromQuery(args.query);
      let wanted: [number, number] | undefined;
      if (args.bpm_range !== undefined) {
        const parsed = parseTempoRange(args.bpm_range);
        if (!parsed) return refused(tool, "Error: bpm_range must be two tempos, e.g. [150, 170] or '150-170'.");
        wanted = parsed;
      } else if (args.bpm !== undefined) {
        const bpm = Number(args.bpm);
        if (!(bpm >= 40 && bpm <= 300)) return refused(tool, "Error: bpm must be between 40 and 300.");
        wanted = rangeAround(bpm);
      } else if (typed.range) {
        wanted = typed.range;
        warnings.push(`Moved the tempo out of the query: searching '${typed.query}' for ${Math.round(wanted[0])}-${Math.round(wanted[1])} BPM.`);
      }
      const filtering = wanted !== undefined || args.energy !== undefined;
      // Previews are downloaded and measured only to filter by tempo or energy: a plain search costs what it always did.
      const measuring = filtering && canMeasurePreviews(call);
      if (filtering && !measuring) warnings.push("bpm / energy filters are not applied: this surface cannot measure audio previews. Check the results by ear or pick by tags.");

      // Mood words narrow the search; Freesound wants every word, so retry without them when nothing matches.
      const pageSize = measuring ? 60 : Math.min(30, n * 2);
      const minSeconds = Number(args.min_seconds ?? 0);
      let found = await searchFreesound(call, args.mood ? `${typed.query} ${args.mood}` : typed.query, pageSize, minSeconds);
      if (!("error" in found) && found.sounds.length === 0 && args.mood) {
        found = await searchFreesound(call, typed.query, pageSize, minSeconds);
        warnings.push(`Nothing matched with the mood '${args.mood}': searched without it.`);
      }
      if ("error" in found) return refused(tool, `Error: Freesound search failed: ${found.error}`);
      const candidates = found.sounds
        .filter((s) => previewOf(s))
        .sort((a, b) => licenceRank(a.license) - licenceRank(b.license) || b.duration - a.duration);

      // Measure in small batches, open licences first, until enough tracks fit (or a fixed few without filters).
      const measures = new Map<number, PreviewMeasure>();
      let measureError = "";
      const fits = (s: FreesoundSound): boolean => {
        const m = measures.get(s.id);
        if (!m) return false;
        if (wanted && !(m.bpm > 0 && matchTempo(m, wanted))) return false;
        return !args.energy || m.energy === args.energy;
      };
      if (measuring) {
        const budget = MAX_MEASURED;
        let next = 0;
        while (next < Math.min(budget, candidates.length) && candidates.filter(fits).length < n && !(measureError && measures.size === 0 && next >= MEASURE_BATCH)) {
          const batch = candidates.slice(next, Math.min(next + MEASURE_BATCH, budget));
          next += batch.length;
          const done = await Promise.all(batch.map((s) => measurePreview(call, previewOf(s)!)));
          done.forEach((m, i) => {
            if (typeof m === "string") measureError ||= m;
            else measures.set(batch[i]!.id, m);
          });
        }
        if (measures.size === 0 && candidates.length > 0) {
          warnings.push(`Could not measure the previews (${measureError || "no audio"}): tempo and energy are not known${filtering ? ", so the filters are not applied" : ""}.`);
        }
      }
      const measured = measures.size > 0;
      const keep = (s: FreesoundSound) => !filtering || !measured || fits(s);
      const pool = measured && filtering ? candidates.filter((s) => measures.has(s.id)) : candidates;
      const matched = pool.filter(keep);

      const describe = (s: FreesoundSound): MusicResult => {
        const m = measures.get(s.id);
        const match = m && wanted && m.bpm > 0 ? matchTempo(m, wanted) : null;
        return {
          sound_id: s.id,
          name: s.name,
          duration_seconds: s.duration,
          licence: licenceName(s.license),
          licence_url: s.license ?? "",
          user: s.username ?? "",
          tags: (s.tags ?? []).slice(0, 4),
          preview_url: previewOf(s)!,
          page_url: `https://freesound.org/s/${s.id}/`,
          ...(m
            ? {
                bpm: m.bpm > 0 ? m.bpm : null,
                bpm_confidence: m.confidence,
                bpm_also: m.alternatives.filter((a) => a.support >= 0.6).map((a) => a.bpm),
                ...(match && match !== "exact" ? { bpm_match: match } : {}),
                loudness_db: m.loudnessDb,
                peak_db: m.peakDb,
                energy: m.energy,
              }
            : {}),
        };
      };
      const closeness = (s: FreesoundSound) => {
        const m = measures.get(s.id);
        return wanted && m && m.bpm > 0 ? tempoDistance(m, wanted) : 0;
      };
      const results = matched
        .sort((a, b) => licenceRank(a.license) - licenceRank(b.license) || closeness(a) - closeness(b) || b.duration - a.duration)
        .slice(0, n)
        .map(describe);
      // Filters that leave nothing: the nearest tracks by tempo, so the next query can move.
      const nearest =
        results.length === 0 && measured && filtering
          ? pool
              .filter((s) => measures.get(s.id)!.bpm > 0)
              .sort((a, b) => closeness(a) - closeness(b))
              .slice(0, 3)
              .map(describe)
          : [];

      const asked = [wanted ? `${Math.round(wanted[0])}-${Math.round(wanted[1])} BPM` : "", args.energy ? `${args.energy} energy` : ""].filter(Boolean).join(", ");
      const data = { query: typed.query, ...(args.mood ? { mood: args.mood } : {}), ...(wanted ? { bpm_range: wanted } : {}), total: found.total, measured: measures.size, results, ...(nearest.length > 0 ? { nearest } : {}) };
      const line = (r: MusicResult) =>
        `  id=${r.sound_id}  duration=${clockTime(r.duration_seconds)}  licence=${r.licence}  user=${r.user}` +
        (r.energy ? `  bpm=${r.bpm ?? "?"}${r.bpm_match ? ` (${r.bpm_match}, also ${(r.bpm_also ?? []).join("/")})` : ""}  energy=${r.energy}  loudness=${r.loudness_db}dB` : "") +
        `  tags=[${r.tags.join(", ")}]  preview_url=${r.preview_url}`;
      if (results.length === 0) {
        const none = asked && measured ? `No Freesound tracks for '${typed.query}' at ${asked} among the ${measures.size} measured.` : `No Freesound results for '${args.query}'.`;
        const near = nearest.length > 0 ? `\nNearest by tempo:\n${nearest.map(line).join("\n")}` : "";
        return applied(tool, none + near, { warnings, data }, 0);
      }
      const lines = [`Freesound results for '${typed.query}'${asked && measured ? ` at ${asked}` : ""} (${found.total.toLocaleString("en-US")} total):`, ...results.map(line)];
      return applied(tool, lines.join("\n"), { warnings, data }, 0);
    },
  }),
];
