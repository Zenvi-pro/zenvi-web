import { describe, expect, it } from "vitest";
import { DownloadError, FIRST_RANGE_BYTES, downloadFile, splitRanges, totalFromContentRange, type DownloadProgress } from "./download";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7) % 251);

interface Server {
  ranges?: boolean;
  /** Hide Content-Range from scripts (Pexels exposes only the safelisted headers). */
  hideContentRange?: boolean;
  /** Reject requests carrying a Range header like a refused CORS preflight. */
  refuseRange?: boolean;
  /** Never finish bodies after this many bytes. */
  stallAfter?: number;
}

function server(file: Uint8Array, opts: Server = {}) {
  const requests: Array<string | null> = [];
  const fake = (async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    requests.push(range);
    if (range && opts.refuseRange) throw new TypeError("Failed to fetch");
    const body = (slice: Uint8Array) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          const cut = opts.stallAfter === undefined ? slice.length : Math.min(slice.length, opts.stallAfter);
          // Several chunks, as a network delivers them.
          for (let i = 0; i < cut; i += 65536) c.enqueue(slice.subarray(i, Math.min(cut, i + 65536)));
          if (opts.stallAfter === undefined) c.close();
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        },
      });
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!match || opts.ranges === false) {
      return new Response(body(file), { status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(file.length) } });
    }
    const start = Number(match[1]);
    const end = Math.min(file.length - 1, match[2] ? Number(match[2]) : file.length - 1);
    const slice = file.subarray(start, end + 1);
    const headers: Record<string, string> = { "content-type": "audio/mpeg", "content-length": String(slice.length) };
    if (!opts.hideContentRange) headers["content-range"] = `bytes ${start}-${end}/${file.length}`;
    return new Response(body(slice), { status: 206, headers });
  }) as unknown as typeof fetch;
  return { fetch: fake, requests };
}

async function same(blob: Blob, file: Uint8Array) {
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(file);
}

describe("downloadFile", () => {
  it("fetches a large file as parallel byte ranges and reports progress up to the total", async () => {
    const file = bytes(3_069_708);
    const s = server(file);
    const progress: DownloadProgress[] = [];
    const out = await downloadFile("https://cdn.example/a.mp3", { fetch: s.fetch, onProgress: (p) => progress.push(p) });
    await same(out.blob, file);
    expect(out.type).toBe("audio/mpeg");
    expect(s.requests[0]).toBe(`bytes=0-${FIRST_RANGE_BYTES - 1}`);
    expect(s.requests.length).toBe(7);
    expect(progress.at(-1)).toEqual({ loaded: file.length, total: file.length });
    expect(progress.every((p, i) => i === 0 || p.loaded >= progress[i - 1]!.loaded)).toBe(true);
  });

  it("takes one request for a file smaller than the first range", async () => {
    const file = bytes(5000);
    const s = server(file);
    await same((await downloadFile("https://x/a", { fetch: s.fetch })).blob, file);
    expect(s.requests.length).toBe(1);
  });

  it("reads a server that ignores ranges as one whole response", async () => {
    const file = bytes(2_500_000);
    const s = server(file, { ranges: false });
    const progress: DownloadProgress[] = [];
    await same((await downloadFile("https://x/a", { fetch: s.fetch, onProgress: (p) => progress.push(p) })).blob, file);
    expect(s.requests.length).toBe(1);
    expect(progress.at(-1)).toEqual({ loaded: file.length, total: file.length });
  });

  it("gets the rest in one request when Content-Range is hidden, its length giving the size", async () => {
    const file = bytes(2_500_000);
    const s = server(file, { hideContentRange: true });
    const progress: DownloadProgress[] = [];
    await same((await downloadFile("https://x/a", { fetch: s.fetch, onProgress: (p) => progress.push(p) })).blob, file);
    expect(s.requests).toEqual([`bytes=0-${FIRST_RANGE_BYTES - 1}`, `bytes=${FIRST_RANGE_BYTES}-`]);
    expect(progress.at(-1)).toEqual({ loaded: file.length, total: file.length });
  });

  it("falls back to a plain request when the ranged one is refused", async () => {
    const file = bytes(2_000_000);
    const s = server(file, { refuseRange: true });
    await same((await downloadFile("https://x/a", { fetch: s.fetch })).blob, file);
    expect(s.requests).toEqual([`bytes=0-${FIRST_RANGE_BYTES - 1}`, null]);
  });

  it("fails with a message when the body stalls instead of waiting forever", async () => {
    const s = server(bytes(2_000_000), { ranges: false, stallAfter: 100_000 });
    await expect(downloadFile("https://x/a", { fetch: s.fetch, stallMs: 50 })).rejects.toThrow(/stalled/);
  });

  it("says the download was cancelled when the caller aborts", async () => {
    const s = server(bytes(2_000_000), { ranges: false, stallAfter: 100_000 });
    const controller = new AbortController();
    const done = downloadFile("https://x/a", { fetch: s.fetch, signal: controller.signal, stallMs: 10_000 });
    setTimeout(() => controller.abort(), 20);
    await expect(done).rejects.toThrow(/cancelled/);
  });

  it("refuses a file over the size limit and reports HTTP errors", async () => {
    await expect(downloadFile("https://x/a", { fetch: server(bytes(3_000_000)).fetch, maxBytes: 2_000_000 })).rejects.toThrow(/too large/);
    const notFound = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const error = await downloadFile("https://x/a", { fetch: notFound }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(String(error)).toMatch(/404/);
  });
});

describe("ranges", () => {
  it("reads the size from Content-Range", () => {
    expect(totalFromContentRange("bytes 0-1023/3069708")).toBe(3069708);
    expect(totalFromContentRange("bytes 0-1023/*")).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
  });

  it("splits the rest into at most six contiguous parts", () => {
    const parts = splitRanges(1_048_576, 3_069_708);
    expect(parts.length).toBe(6);
    expect(parts[0]![0]).toBe(1_048_576);
    expect(parts.at(-1)![1]).toBe(3_069_707);
    parts.slice(1).forEach(([start], i) => expect(start).toBe(parts[i]![1] + 1));
    expect(splitRanges(100, 300)).toEqual([[100, 299]]);
    expect(splitRanges(300, 300)).toEqual([]);
  });
});
