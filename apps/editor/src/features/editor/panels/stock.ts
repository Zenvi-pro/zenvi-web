/**
 * Stock media search (Pexels videos, Freesound audio) through the backend's
 * `/pexels/search` and `/freesound/search` (same-origin proxy), and import.
 * Importing goes through the engine's `import_stock_media_tool` like the
 * Assistant does (the host downloads from the CDN; both allow CORS).
 */
import * as tools from "@zenvi/engine/tools";
import { backendRequest } from "@/lib/backend";
import { toast } from "@/ui/Toast";
import type { Placement } from "../actions/importMedia";
import { runAssistantTool } from "../assistant/bridge";
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

export type StockItem = { kind: "pexels"; video: PexelsVideo } | { kind: "freesound"; sound: FreesoundSound };

/** Import one stock item into the bin and onto the timeline (engine `import_stock_media_tool`). */
export async function importStock(session: EditorSession, item: StockItem, placement: Placement): Promise<void> {
  const host = createToolHost(session, async () => []);
  const args: Record<string, unknown> =
    item.kind === "pexels"
      ? { source: "pexels", link: pexelsLink(item.video), video_id: String(item.video.id) }
      : { source: "freesound", preview_url: item.sound.previews.hq_mp3 || item.sound.previews.lq_mp3, sound_id: String(item.sound.id) };
  if (placement && placement !== "end") args.position_seconds = String(placement.position);
  const wire = await runAssistantTool(session, host, "import_stock_media_tool", args, new AbortController().signal, "editor");
  if (wire.result.startsWith("Error")) toast.error("Import failed", { description: wire.result.replace(/^Error:\s*/, "") });
  else toast.success(item.kind === "pexels" ? "Stock video imported" : "Stock audio imported");
}
