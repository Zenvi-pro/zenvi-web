import { describe, expect, it } from "vitest";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { fixtureDoc } from "../test-support/fixture.js";
import type { StockHost } from "../types.js";

/** A deployment's own provider keys, without the backend (Zenvi Cloud's self-hosted stock). */
const ownKeys: StockHost = {
  searchPexelsVideos: async (query) => ({
    total: 1,
    videos: [{ id: 7, width: 1920, height: 1080, duration: 9, user_name: "Ana", video_files: [{ quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: `https://cdn.test/${query}.mp4` }] }],
  }),
  searchFreesound: async () => {
    throw new Error("FREESOUND_API_KEY is not configured");
  },
};

describe("stock search without the backend", () => {
  it("runs through the host's stock search", async () => {
    const host = fakeHost({ without: ["backend"] });
    host.stock = ownKeys;
    const result = await runTool({ doc: fixtureDoc(), host }, "search_pexels_videos_tool", { query: "surf" });
    expect(result.data?.summary).toMatch(/^Pexels results for 'surf' \(1 total\):\n {2}id=7 .*link=https:\/\/cdn\.test\/surf\.mp4$/);
    expect(host.backendCalls).toHaveLength(0);
  });

  it("reports a provider that is not set up as the backend does", async () => {
    const host = fakeHost({ without: ["backend"] });
    host.stock = ownKeys;
    const result = await runTool({ doc: fixtureDoc(), host }, "search_freesound_music_tool", { query: "lofi" });
    expect(result.data?.summary).toBe("Error: Freesound search failed: FREESOUND_API_KEY is not configured");
  });

  it("is unavailable with neither", async () => {
    const result = await runTool({ doc: fixtureDoc(), host: fakeHost({ without: ["backend"] }) }, "search_pexels_videos_tool", { query: "surf" });
    expect(result.data?.summary).toMatch(/^Error: .*not available.*stock search/);
  });
});
