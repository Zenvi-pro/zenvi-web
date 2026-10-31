import { describe, expect, it } from "vitest";
import { downloadFile } from "./download";
import { generatedMediaDownloadUrl, isGeneratedMediaUrl, withBackendAuth } from "./generatedMedia";

const VIDEO = "https://vidgen.x.ai/xai-vidgen-bucket/xai-video-1.mp4";

describe("generated media downloads", () => {
  it("knows the providers' CDNs and nothing else", () => {
    expect(isGeneratedMediaUrl(new URL(VIDEO))).toBe(true);
    expect(isGeneratedMediaUrl(new URL("https://vm.runware.ai/video/a.mp4"))).toBe(true);
    expect(isGeneratedMediaUrl(new URL("https://videos.pexels.com/a.mp4"))).toBe(false);
    expect(isGeneratedMediaUrl(new URL("https://evilx.ai/a.mp4"))).toBe(false);
    expect(isGeneratedMediaUrl(new URL("http://vidgen.x.ai/a.mp4"))).toBe(false);
  });

  it("downloads through the backend's route with the session's token (zenvi.pro: vidgen.x.ai has no CORS)", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const backend = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
      // The route answers a ranged request with the whole file.
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4", "Content-Length": "4" } });
    }) as typeof fetch;
    const url = generatedMediaDownloadUrl(VIDEO, "https://api.zenvi.pro/api/v1");
    const { blob, type } = await downloadFile(url, { fetch: withBackendAuth(async () => "jwt", backend) });
    expect(seen).toEqual([{ url: `https://api.zenvi.pro/api/v1/generation/download?url=${encodeURIComponent(VIDEO)}`, auth: "Bearer jwt" }]);
    expect([blob.size, type]).toEqual([4, "video/mp4"]);
  });

  it("keeps the request's own headers and sends none when signed out", async () => {
    let headers = new Map<string, string>();
    const backend = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Map(Object.entries((init?.headers ?? {}) as Record<string, string>));
      return new Response("");
    }) as typeof fetch;
    await withBackendAuth(async () => null, backend)("https://api.zenvi.pro/x", { headers: { Range: "bytes=0-9" } });
    expect([headers.get("Range"), headers.get("Authorization") ?? null]).toEqual(["bytes=0-9", null]);
  });
});
