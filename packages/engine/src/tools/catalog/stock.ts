/**
 * Stock search on every web surface: the tools the desktop Assistant has in
 * the Zenvi backend (core/tools/stock_media_tools.py), with the same names,
 * arguments and result lines. Find Pexels videos or Freesound music through
 * the host's backend; import_stock_media_tool then downloads one into the
 * project. The web adds what a chat needs to choose and credit: a rendition
 * sized for this project's frame, the orientation, the music's licence.
 */

import { z } from "zod";
import { clockTime, licenceName, licenceRank, pickStockFile, previewOf } from "../../stock/stock.js";
import { searchFreesound, searchPexelsVideos } from "../backend.js";
import { directTool, type CatalogTool } from "../define.js";
import { applied, refused } from "../receipt.js";

const SEARCH = { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true } as const;

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
      "non-commercial last), then longer tracks. To add one: import_stock_media_tool with source='freesound', its sound_id and preview_url. " +
      "Credit CC BY sounds (user and link) wherever the video is published.",
    input: z.strictObject({
      query: z.string().trim().min(1).max(200).describe("Mood, genre or sound, e.g. 'upbeat lo-fi hip hop' or 'whoosh'."),
      count,
      min_seconds: z
        .union([z.number().min(0).max(3600), z.string().regex(/^\d+(\.\d+)?$/)])
        .optional()
        .describe("Shortest track wanted, seconds (e.g. the video's length for a music bed)."),
    }),
    annotations: SEARCH,
    requires: ["backend"],
    run: async (call, args) => {
      const tool = "search_freesound_music_tool";
      const n = resultCount(args.count);
      const found = await searchFreesound(call, args.query, Math.min(30, n * 2), Number(args.min_seconds ?? 0));
      if ("error" in found) return refused(tool, `Error: Freesound search failed: ${found.error}`);
      const results = found.sounds
        .filter((s) => previewOf(s))
        .sort((a, b) => licenceRank(a.license) - licenceRank(b.license) || b.duration - a.duration)
        .slice(0, n)
        .map((s) => ({
          sound_id: s.id,
          name: s.name,
          duration_seconds: s.duration,
          licence: licenceName(s.license),
          licence_url: s.license ?? "",
          user: s.username ?? "",
          tags: (s.tags ?? []).slice(0, 4),
          preview_url: previewOf(s)!,
          page_url: `https://freesound.org/s/${s.id}/`,
        }));
      if (results.length === 0) return applied(tool, `No Freesound results for '${args.query}'.`, { data: { query: args.query, total: 0, results } }, 0);
      const lines = [
        `Freesound results for '${args.query}' (${found.total.toLocaleString("en-US")} total):`,
        ...results.map((r) => `  id=${r.sound_id}  duration=${clockTime(r.duration_seconds)}  licence=${r.licence}  user=${r.user}  tags=[${r.tags.join(", ")}]  preview_url=${r.preview_url}`),
      ];
      return applied(tool, lines.join("\n"), { data: { query: args.query, total: found.total, results } }, 0);
    },
  }),
];
