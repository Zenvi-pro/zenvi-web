/**
 * Stock media search (Pexels videos, Freesound audio) through the backend's
 * `/pexels/search` and `/freesound/search` (same-origin proxy), and import.
 * Importing goes through the engine's `import_stock_media_tool` like the
 * Assistant does; until the tool catalog is exported it downloads from the
 * CDN directly (both CDNs allow CORS) into the normal import pipeline.
 */
import * as tools from "@zenvi/engine/tools";
import { backendRequest } from "@/lib/backend";
import { toast } from "@/ui/Toast";
import { importMedia, type Placement } from "../actions/importMedia";
import { runAssistantTool, toolsAvailable } from "../assistant/bridge";
import { createToolHost } from "../assistant/host";
import type { EditorSession } from "../session/EditorSession";

export interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  link: string;
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  image: string;
  url: string;
  user_name: string;
  video_files: PexelsVideoFile[];
}

export interface FreesoundSound {
  id: number;
  name: string;
  duration: number;
  username: string;
  license: string;
  tags: string[];
  previews: { hq_mp3: string; lq_mp3: string };
  images: { waveform_m: string; waveform_l: string };
}

export async function searchPexels(query: string, signal?: AbortSignal): Promise<PexelsVideo[]> {
  const data = await backendRequest<{ videos?: PexelsVideo[]; error?: string | null }>(`/pexels/search?query=${encodeURIComponent(query)}&per_page=24&page=1`, { signal });
  if (data.error) throw new Error(data.error);
  return data.videos ?? [];
}

export async function searchFreesound(query: string, signal?: AbortSignal): Promise<FreesoundSound[]> {
  const data = await backendRequest<{ sounds?: FreesoundSound[]; error?: string | null }>(`/freesound/search?query=${encodeURIComponent(query)}&page_size=24&page=1`, { signal });
  if (data.error) throw new Error(data.error);
  return data.sounds ?? [];
}

const ns = tools as unknown as Record<string, unknown>;

/** The link the desktop downloads: the first "hd" file, else the first (api_client.py `pick_pexels_hd_link`). */
export function pexelsLink(video: PexelsVideo): string {
  const fn = ns.pickPexelsHdLink as ((v: Record<string, unknown>) => string) | undefined;
  if (typeof fn === "function") return fn(video as unknown as Record<string, unknown>);
  const pick = video.video_files.find((f) => f.quality === "hd") ?? video.video_files[0];
  return pick?.link ?? "";
}

/** The smallest file, for hover previews. */
export function pexelsPreviewLink(video: PexelsVideo): string {
  const files = [...video.video_files].filter((f) => f.link).sort((a, b) => (a.width ?? 9999) - (b.width ?? 9999));
  return files[0]?.link ?? "";
}

async function download(url: string, name: string, type: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || type });
}

export type StockItem = { kind: "pexels"; video: PexelsVideo } | { kind: "freesound"; sound: FreesoundSound };

/** Import one stock item into the bin (and onto the timeline when `placement` is given). */
export async function importStock(session: EditorSession, item: StockItem, placement: Placement): Promise<void> {
  if (toolsAvailable()) {
    const host = createToolHost(session, async () => []);
    const args: Record<string, unknown> =
      item.kind === "pexels"
        ? { source: "pexels", link: pexelsLink(item.video), video_id: String(item.video.id) }
        : { source: "freesound", preview_url: item.sound.previews.hq_mp3 || item.sound.previews.lq_mp3, sound_id: String(item.sound.id) };
    if (placement && placement !== "end") {
      args.position_seconds = String(placement.position);
    }
    const wire = await runAssistantTool(session, host, "import_stock_media_tool", args, new AbortController().signal);
    if (wire.result.startsWith("Error")) toast.error("Import failed", { description: wire.result.replace(/^Error:\s*/, "") });
    else toast.success(item.kind === "pexels" ? "Stock video imported" : "Stock audio imported");
    return;
  }
  try {
    const file =
      item.kind === "pexels"
        ? await download(pexelsLink(item.video), `pexels_${item.video.id}.mp4`, "video/mp4")
        : await download(item.sound.previews.hq_mp3 || item.sound.previews.lq_mp3, `freesound_${item.sound.id}.mp3`, "audio/mpeg");
    await importMedia(session, [file], placement);
  } catch (error) {
    toast.error("Import failed", { description: error instanceof Error ? error.message : String(error) });
  }
}
