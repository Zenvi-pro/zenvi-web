/**
 * What this browser can do. The editor needs WebCodecs decoding (preview,
 * thumbnails, waveforms); encoding is only needed for in-browser export, so
 * without it export offers a Zenvi Cloud render instead.
 */

export interface BrowserSupport {
  videoDecode: boolean;
  audioDecode: boolean;
  videoEncode: boolean;
  audioEncode: boolean;
  /** Origin private file system (media falls back to IndexedDB without it). */
  opfs: boolean;
  indexedDb: boolean;
  /** Human-readable names of missing essentials; empty when the editor can run. */
  missingEssentials: string[];
  /** In-browser export is possible. */
  canExport: boolean;
}

type Globals = Partial<Record<"VideoDecoder" | "VideoEncoder" | "AudioDecoder" | "AudioEncoder" | "indexedDB", unknown>>;

export function detectSupport(g: Globals = globalThis as Globals, nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): BrowserSupport {
  const videoDecode = typeof g.VideoDecoder === "function";
  const audioDecode = typeof g.AudioDecoder === "function";
  const videoEncode = typeof g.VideoEncoder === "function";
  const audioEncode = typeof g.AudioEncoder === "function";
  const opfs = typeof nav?.storage?.getDirectory === "function";
  const indexedDb = g.indexedDB !== undefined && g.indexedDB !== null;
  const missingEssentials: string[] = [];
  if (!videoDecode) missingEssentials.push("video decoding (WebCodecs VideoDecoder)");
  if (!audioDecode) missingEssentials.push("audio decoding (WebCodecs AudioDecoder)");
  if (!opfs && !indexedDb) missingEssentials.push("local storage (IndexedDB or the origin private file system)");
  return { videoDecode, audioDecode, videoEncode, audioEncode, opfs, indexedDb, missingEssentials, canExport: videoEncode };
}

let cached: BrowserSupport | null = null;

export function browserSupport(): BrowserSupport {
  if (!cached) cached = detectSupport();
  return cached;
}

/** Phones and small tablets get the view-only editor. */
export function isProbablyMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile ?? /Android|iPhone|iPod/i.test(nav.userAgent);
}
