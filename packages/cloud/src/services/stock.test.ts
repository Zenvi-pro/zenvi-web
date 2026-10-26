import { describe, expect, it } from "vitest";
import { directStock, type StockFetch } from "./stock.js";

const KEYS = { pexels: "pexels-key-123", freesound: "freesound-key-456" };

function recorder(body: unknown, status = 200): { fetch: StockFetch; seen: { url: string; headers: Record<string, string> }[] } {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  return {
    seen,
    fetch: async (url, init) => {
      seen.push({ url, headers: init.headers });
      return { ok: status < 400, status, json: async () => body };
    },
  };
}

describe("directStock", () => {
  it("is off without keys", () => {
    expect(directStock({ pexels: "", freesound: "" })).toBeNull();
  });

  it("searches Pexels the way the backend does: video files only, the user's name flattened", async () => {
    const r = recorder({
      total_results: 40,
      videos: [
        {
          id: 9,
          width: 1080,
          height: 1920,
          duration: 12,
          url: "https://www.pexels.com/video/surf-9/",
          image: "https://images.test/9.jpg",
          user: { name: "Ana" },
          video_files: [
            { quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://cdn.test/9-hd.mp4" },
            { quality: null, file_type: "image/jpeg", width: 100, height: 100, link: "https://cdn.test/9.jpg" },
          ],
        },
      ],
    });
    const found = await directStock(KEYS, r.fetch)!.searchPexelsVideos("surf at dawn", { perPage: 200 });
    expect(found.total).toBe(40);
    expect(found.videos).toEqual([
      {
        id: 9,
        width: 1080,
        height: 1920,
        duration: 12,
        url: "https://www.pexels.com/video/surf-9/",
        image: "https://images.test/9.jpg",
        user_name: "Ana",
        video_files: [{ quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://cdn.test/9-hd.mp4" }],
      },
    ]);
    expect(r.seen[0]!.url).toBe("https://api.pexels.com/videos/search?query=surf+at+dawn&per_page=80&page=1");
    expect(r.seen[0]!.headers).toEqual({ Authorization: "pexels-key-123" });
  });

  it("searches Freesound for open licences only, with the key in a header and never in the URL", async () => {
    const r = recorder({
      count: 3,
      results: [{ id: 703568, name: "Dark Time", duration: 125.1, username: "someone", tags: ["trap"], license: "http://creativecommons.org/publicdomain/zero/1.0/", previews: { "preview-hq-mp3": "https://cdn.freesound.test/hq.mp3", "preview-lq-mp3": "https://cdn.freesound.test/lq.mp3" } }],
    });
    const found = await directStock(KEYS, r.fetch)!.searchFreesound("trap beat", { pageSize: 20, minSeconds: 24.4 });
    expect(found).toEqual({
      total: 3,
      sounds: [{ id: 703568, name: "Dark Time", duration: 125.1, username: "someone", tags: ["trap"], license: "http://creativecommons.org/publicdomain/zero/1.0/", previews: { hq_mp3: "https://cdn.freesound.test/hq.mp3", lq_mp3: "https://cdn.freesound.test/lq.mp3" } }],
    });
    const url = new URL(r.seen[0]!.url);
    expect(url.origin + url.pathname).toBe("https://freesound.org/apiv2/search/text/");
    expect(url.searchParams.get("filter")).toBe('duration:[24 TO *] license:("Creative Commons 0" OR "Attribution")');
    expect(url.searchParams.get("page_size")).toBe("20");
    expect(r.seen[0]!.url).not.toContain("freesound-key-456");
    expect(r.seen[0]!.headers).toEqual({ Authorization: "Token freesound-key-456" });
  });

  it("names a missing key and a provider's refusal without echoing the key", async () => {
    const pexelsOnly = directStock({ pexels: "pexels-key-123", freesound: "" }, recorder({}).fetch)!;
    await expect(pexelsOnly.searchFreesound("x", { pageSize: 5, minSeconds: 0 })).rejects.toThrow("FREESOUND_API_KEY is not configured");
    const refused = directStock(KEYS, recorder({ error: "bad key" }, 401).fetch)!;
    const error = await refused.searchPexelsVideos("x", { perPage: 5 }).catch((e: Error) => e.message);
    expect(error).toBe("Pexels answered HTTP 401");
  });
});
