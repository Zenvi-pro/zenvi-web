/**
 * Stock search with this deployment's own provider keys, for a Zenvi Cloud
 * that runs without the Zenvi backend (a lab, a self-hosted copy). Same
 * requests and result shapes as the backend's proxies
 * (zenvi-backend api/routes/pexels.py, core/tools/freesound_client.py), so
 * the engine's stock tools and create_reel cannot tell the two apart.
 *
 * Freesound results are limited to open licences (CC0 and CC BY): without
 * the backend nobody reviews what a self-hosted copy publishes, and a reel
 * built on a non-commercial track is a trap for a business. Keys travel in
 * headers only, so no URL or error message carries them.
 */

import type { FreesoundSound, PexelsFile, PexelsVideo, StockHost } from "@zenvi/engine";

const PEXELS_SEARCH = "https://api.pexels.com/videos/search";
const FREESOUND_SEARCH = "https://freesound.org/apiv2/search/text/";
const FREESOUND_FIELDS = "id,name,duration,username,tags,license,previews";
const OPEN_LICENCES = 'license:("Creative Commons 0" OR "Attribution")';
const TIMEOUT_MS = 15_000;

export interface StockKeys {
  pexels: string;
  freesound: string;
}

/** The part of `fetch` the clients use (tests pass a fake). */
export type StockFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Pick<Response, "ok" | "status" | "json">>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function deadline(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function getJson(fetchFn: StockFetch, provider: string, url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetchFn(url.toString(), { headers, signal: deadline(signal) });
  if (!response.ok) throw new Error(`${provider} answered HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!isRecord(data)) throw new Error(`${provider} sent an unexpected answer`);
  return data;
}

function pexelsVideo(v: Record<string, unknown>): PexelsVideo {
  const files: PexelsFile[] = records(v.video_files)
    .filter((f) => String(f.file_type ?? "").startsWith("video/"))
    .map((f) => ({
      quality: String(f.quality ?? ""),
      file_type: String(f.file_type ?? ""),
      width: typeof f.width === "number" ? f.width : null,
      height: typeof f.height === "number" ? f.height : null,
      link: String(f.link ?? ""),
    }));
  const user = isRecord(v.user) ? v.user : {};
  return {
    id: Number(v.id) || 0,
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    duration: Number(v.duration) || 0,
    image: String(v.image ?? ""),
    url: String(v.url ?? ""),
    user_name: String(user.name ?? ""),
    video_files: files,
  };
}

function freesoundSound(s: Record<string, unknown>): FreesoundSound {
  const previews = isRecord(s.previews) ? s.previews : {};
  return {
    id: Number(s.id) || 0,
    name: String(s.name ?? ""),
    duration: Number(s.duration) || 0,
    username: String(s.username ?? ""),
    tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
    license: String(s.license ?? ""),
    previews: { hq_mp3: String(previews["preview-hq-mp3"] ?? ""), lq_mp3: String(previews["preview-lq-mp3"] ?? "") },
  };
}

/** Pexels and Freesound clients for the keys that are set, or null when neither is. */
export function directStock(keys: StockKeys, fetchFn: StockFetch = fetch): StockHost | null {
  if (!keys.pexels && !keys.freesound) return null;
  return {
    async searchPexelsVideos(query, { perPage, signal }) {
      if (!keys.pexels) throw new Error("PEXELS_API_KEY is not configured");
      const url = new URL(PEXELS_SEARCH);
      url.search = new URLSearchParams({ query, per_page: String(Math.max(1, Math.min(80, Math.trunc(perPage)))), page: "1" }).toString();
      const data = await getJson(fetchFn, "Pexels", url, { Authorization: keys.pexels }, signal);
      const videos = records(data.videos).map(pexelsVideo);
      return { videos, total: Number(data.total_results ?? videos.length) || videos.length };
    },
    async searchFreesound(query, { pageSize, minSeconds, signal }) {
      if (!keys.freesound) throw new Error("FREESOUND_API_KEY is not configured");
      const filter = minSeconds > 0 ? `duration:[${Math.round(minSeconds)} TO *] ${OPEN_LICENCES}` : OPEN_LICENCES;
      const url = new URL(FREESOUND_SEARCH);
      url.search = new URLSearchParams({
        query,
        fields: FREESOUND_FIELDS,
        page_size: String(Math.max(1, Math.min(150, Math.trunc(pageSize)))),
        page: "1",
        sort: "score",
        filter,
      }).toString();
      const data = await getJson(fetchFn, "Freesound", url, { Authorization: `Token ${keys.freesound}` }, signal);
      const sounds = records(data.results).map(freesoundSound);
      return { sounds, total: Number(data.count ?? sounds.length) || sounds.length };
    },
  };
}
