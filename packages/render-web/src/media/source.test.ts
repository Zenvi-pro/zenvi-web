import { describe, expect, it } from "vitest";
import { createRefreshingFetch, readBlob, sourceName } from "./source.js";

describe("createRefreshingFetch", () => {
  it("refreshes an expired signed URL once and retries, sharing the refresh across requests", async () => {
    const seen: string[] = [];
    let refreshes = 0;
    const base: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      return new Response(url.endsWith("sig=new") ? "ok" : "expired", { status: url.endsWith("sig=new") ? 206 : 403 });
    };
    const refreshing = createRefreshingFetch(
      "https://blob/x.webm?sig=old",
      async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return "https://blob/x.webm?sig=new";
      },
      base,
    );
    const [a, b] = await Promise.all([
      refreshing.fetch("ignored", { headers: { Range: "bytes=0-" } }),
      refreshing.fetch("ignored", { headers: { Range: "bytes=100-" } }),
    ]);
    expect(a.status).toBe(206);
    expect(b.status).toBe(206);
    expect(refreshes).toBe(1);
    expect(refreshing.currentUrl()).toBe("https://blob/x.webm?sig=new");
    expect(seen.filter((u) => u.endsWith("sig=new"))).toHaveLength(2);
  });

  it("passes non-auth errors through and does not refresh without a callback", async () => {
    const base: typeof fetch = async () => new Response("nope", { status: 404 });
    const refreshing = createRefreshingFetch("https://blob/a", undefined, base);
    expect((await refreshing.fetch("x")).status).toBe(404);
    const forbidden = createRefreshingFetch("https://blob/a", undefined, async () => new Response("", { status: 403 }));
    expect((await forbidden.fetch("x")).status).toBe(403);
  });
});

describe("sources", () => {
  it("derives names from blobs and URLs", () => {
    expect(sourceName({ kind: "url", url: "https://cdn/u/1/media/My%20Clip.mp4?sig=abc" })).toBe("My Clip.mp4");
    expect(sourceName({ kind: "blob", blob: new Blob([]), name: "t.svg" })).toBe("t.svg");
    expect(sourceName({ kind: "blob", blob: new File([], "f.png") })).toBe("f.png");
  });

  it("reads a URL into a Blob through the refreshing fetch", async () => {
    let n = 0;
    const blob = await readBlob({
      kind: "url",
      url: "https://x/old",
      refresh: async () => "https://x/new",
      fetch: async (input) => {
        n += 1;
        return String(input).endsWith("new") ? new Response("svg-bytes") : new Response("", { status: 401 });
      },
    });
    expect(await blob.text()).toBe("svg-bytes");
    expect(n).toBe(2);
  });
});
