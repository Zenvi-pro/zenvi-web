/**
 * Downloads for URL imports (stock media, generated media), with progress.
 *
 * Freesound's CDN serves each request at about 80 KB/s, so a 3 MB preview
 * took 40 s as one request (with nothing on screen but a spinner), and about
 * 6 s as six byte ranges at once (measured from zenvi.pro, Oct 2026; the cap
 * is per request, also over one HTTP/2 connection). A simple `Range` header
 * needs no CORS preflight, so the first request asks for the first range:
 * servers that ignore it answer 200 with the whole file, which is read as is.
 * Where a browser does preflight it and the CDN refuses (Pexels answers
 * OPTIONS with 403), the download falls back to one plain request.
 */

export interface DownloadProgress {
  loaded: number;
  /** Bytes in the file, when the server said. */
  total: number | null;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** Largest file accepted, bytes. */
  maxBytes?: number;
  /** Fail when no bytes arrive for this long, ms. */
  stallMs?: number;
  fetch?: typeof fetch;
}

export interface Downloaded {
  blob: Blob;
  /** The file's type as served (empty when the server did not say). */
  type: string;
}

/** The first range; files this small take one request. */
export const FIRST_RANGE_BYTES = 1024 * 1024;
const MIN_PART_BYTES = 256 * 1024;
const MAX_PARTS = 6;
const STALL_MS = 30_000;

export class DownloadError extends Error {
  override name = "DownloadError";
}

/** The file size in `Content-Range: bytes 0-1023/3069708` (null when absent or `*`). */
export function totalFromContentRange(header: string | null): number | null {
  const match = header?.match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

/** Byte ranges [start, end] (inclusive) covering `from` .. `total - 1` in up to MAX_PARTS parts. */
export function splitRanges(from: number, total: number): Array<[number, number]> {
  const rest = total - from;
  if (rest <= 0) return [];
  const parts = Math.max(1, Math.min(MAX_PARTS, Math.ceil(rest / MIN_PART_BYTES)));
  const size = Math.ceil(rest / parts);
  const out: Array<[number, number]> = [];
  for (let start = from; start < total; start += size) out.push([start, Math.min(total, start + size) - 1]);
  return out;
}

/** Read a body to the end, counting bytes; rejects when it stalls or is aborted. */
async function readBody(response: Response, count: (bytes: number) => void, stallMs: number, abort: () => void): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    count(bytes.byteLength);
    return [bytes];
  }
  const reader = response.body.getReader();
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Settle first, so the race reports the stall and not the abort it causes.
        reject(new DownloadError(`The download stalled (nothing arrived for ${Math.round(stallMs / 1000)} s).`));
        abort();
      }, stallMs);
    });
    try {
      const { done, value } = await Promise.race([reader.read(), stalled]);
      if (done) return chunks;
      chunks.push(value);
      count(value.byteLength);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Download `url`, in parallel byte ranges where the server allows them. */
export async function downloadFile(url: string, options: DownloadOptions = {}): Promise<Downloaded> {
  if (options.signal?.aborted) throw new DownloadError("The download was cancelled.");
  const doFetch = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const stallMs = options.stallMs ?? STALL_MS;
  // One controller for every request, so a stall or a cancel stops them all.
  const controller = new AbortController();
  const outer = options.signal;
  const onAbort = () => controller.abort(outer?.reason);
  outer?.addEventListener("abort", onAbort, { once: true });
  let loaded = 0;
  let total: number | null = null;
  const count = (bytes: number) => {
    loaded += bytes;
    if (loaded > maxBytes) {
      controller.abort();
      throw new DownloadError("That file is too large to import in the browser.");
    }
    options.onProgress?.({ loaded, total });
  };
  const get = async (range?: string): Promise<Response> => {
    const response = await doFetch(url, { signal: controller.signal, ...(range ? { headers: { Range: range } } : {}) });
    if (!response.ok) throw new DownloadError(`Download failed (${response.status}).`);
    return response;
  };
  const read = (response: Response) => readBody(response, count, stallMs, () => controller.abort());
  const tooLarge = (bytes: number | null) => bytes !== null && bytes > maxBytes;

  try {
    let first: Response;
    try {
      first = await get(`bytes=0-${FIRST_RANGE_BYTES - 1}`);
    } catch (error) {
      // A refused preflight is a TypeError like any network failure: try once without the range.
      if (outer?.aborted || error instanceof DownloadError) throw error;
      first = await get();
    }
    const type = first.headers.get("content-type") ?? "";
    const length = Number(first.headers.get("content-length") ?? NaN);
    if (first.status !== 206) {
      total = Number.isFinite(length) ? length : null;
      if (tooLarge(total)) throw new DownloadError("That file is too large to import in the browser.");
      return { blob: new Blob(await read(first) as BlobPart[], { type }), type };
    }
    total = totalFromContentRange(first.headers.get("content-range"));
    if (tooLarge(total)) throw new DownloadError("That file is too large to import in the browser.");
    const head = await read(first);
    const headBytes = loaded;
    if (headBytes < FIRST_RANGE_BYTES) return { blob: new Blob(head as BlobPart[], { type }), type };
    let parts: Uint8Array[][];
    if (total === null) {
      // Content-Range not exposed to scripts (Pexels): the rest in one request, its length gives the size.
      const rest = await get(`bytes=${headBytes}-`);
      const restLength = Number(rest.headers.get("content-length") ?? NaN);
      if (rest.status !== 206) throw new DownloadError("The server stopped serving byte ranges mid-download.");
      if (Number.isFinite(restLength)) total = headBytes + restLength;
      if (tooLarge(total)) throw new DownloadError("That file is too large to import in the browser.");
      parts = [await read(rest)];
    } else {
      parts = await Promise.all(
        splitRanges(headBytes, total).map(async ([start, end]) => {
          const part = await get(`bytes=${start}-${end}`);
          if (part.status !== 206) throw new DownloadError("The server stopped serving byte ranges mid-download.");
          return read(part);
        }),
      );
    }
    if (total !== null && loaded !== total) throw new DownloadError(`The download was cut short (${loaded} of ${total} bytes).`);
    return { blob: new Blob([...head, ...parts.flat()] as BlobPart[], { type }), type };
  } catch (error) {
    controller.abort();
    if (outer?.aborted) throw new DownloadError("The download was cancelled.");
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(`Download failed (${error instanceof Error ? error.message : String(error)}).`);
  } finally {
    outer?.removeEventListener("abort", onAbort);
  }
}
