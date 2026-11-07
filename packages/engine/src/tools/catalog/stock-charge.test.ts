/**
 * Stock imports cost stock_add credits on the web as on the desktop
 * (zenvi-core src/classes/tool_handlers.py download_pexels_video_tool):
 * the balance is checked before the download and the import is charged once it lands (zenvi-core#388).
 */
import { describe, expect, it } from "vitest";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { fixtureDoc } from "../test-support/fixture.js";

const PEXELS = { source: "pexels", video_id: "101", link: "https://videos.pexels.com/101-hd.mp4" };
const FREESOUND = { source: "freesound", sound_id: "55", preview_url: "https://cdn.freesound.org/previews/0/55-hq.mp3" };
const OUT_OF_CREDITS = "Out of credits for stock media. Need 3, have 1. Top up at https://zenvi.pro/topup or upgrade your plan.";

function refusing(): FakeHost {
  return fakeHost({
    routes: {
      "/api/v1/stock/check": () => {
        throw new Error(OUT_OF_CREDITS);
      },
    },
  });
}

const billing = (host: FakeHost) => host.backendCalls.filter((c) => c.path.startsWith("/api/v1/stock/")).map((c) => [c.path, c.body]);

describe("import_stock_media_tool charges stock_add", () => {
  it("checks one import before downloading a Pexels clip and charges it after", async () => {
    const host = fakeHost();
    const result = await runTool({ doc: fixtureDoc(), host }, "import_stock_media_tool", PEXELS);
    expect(result.ok, result.text).toBe(true);
    expect(billing(host)).toEqual([
      ["/api/v1/stock/check", { units: 1 }],
      ["/api/v1/stock/charge", { provider: "pexels", units: 1, note: "video 101" }],
    ]);
  });

  it("charges a Freesound sound to freesound", async () => {
    const host = fakeHost();
    await runTool({ doc: fixtureDoc(), host }, "import_stock_media_tool", FREESOUND);
    expect(billing(host).at(-1)).toEqual(["/api/v1/stock/charge", { provider: "freesound", units: 1, note: "sound 55" }]);
  });

  it("does not charge again for a clip already in the project", async () => {
    const host = fakeHost();
    const doc = fixtureDoc();
    await runTool({ doc, host }, "import_stock_media_tool", PEXELS);
    const again = await runTool({ doc, host }, "import_stock_media_tool", PEXELS);
    expect(again.text).toContain("File already in project");
    expect(billing(host).filter(([path]) => path === "/api/v1/stock/charge")).toHaveLength(1);
  });

  it("refuses without downloading when the person cannot pay", async () => {
    const host = refusing();
    const doc = fixtureDoc();
    const before = doc.project.files.length;
    const result = await runTool({ doc, host }, "import_stock_media_tool", PEXELS);
    expect(result.ok).toBe(false);
    expect(result.data?.summary).toBe(`Error: ${OUT_OF_CREDITS}`);
    expect(host.calls.some((c) => c.startsWith("importUrl"))).toBe(false);
    expect(billing(host).map(([path]) => path)).toEqual(["/api/v1/stock/check"]);
    expect(doc.project.files.length).toBe(before);
  });

  it("does not charge a download that failed", async () => {
    const host = fakeHost();
    host.media!.importUrl = async () => {
      throw new Error("HTTP 404");
    };
    const result = await runTool({ doc: fixtureDoc(), host }, "import_stock_media_tool", PEXELS);
    expect(result.ok).toBe(false);
    expect(billing(host).map(([path]) => path)).toEqual(["/api/v1/stock/check"]);
  });

  it("does not charge for a local file", async () => {
    const host = fakeHost();
    await runTool({ doc: fixtureDoc(), host }, "import_stock_media_tool", { local_path: "/clips/new.mp4" });
    expect(billing(host)).toEqual([]);
  });
});

describe("gather_stock_footage_tool charges stock_add", () => {
  const video = (id: number) => ({
    id,
    width: 1920,
    height: 1080,
    duration: 10,
    user_name: `user${id}`,
    url: `https://www.pexels.com/video/${id === 1 ? "waves-at-dawn" : "harbour-boats"}-${id}/`,
    video_files: [{ quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: `https://cdn.test/${id}.mp4` }],
  });
  const searching = (extra: Parameters<typeof fakeHost>[0] = {}) =>
    // No frame host: the fake's frames all look alike, and only the charge is under test here.
    fakeHost({
      without: ["frames"],
      ...extra,
      routes: { "/api/v1/pexels/search": () => ({ total_results: 2, videos: [video(1), video(2)] }), ...(extra.routes ?? {}) },
    });

  it("checks the clips asked for before downloading and charges the clips imported", async () => {
    const host = searching();
    const result = await runTool({ doc: fixtureDoc(), host }, "gather_stock_footage_tool", { queries: "sea", count: 4 });
    expect(result.data?.status, result.data?.summary).toBe("applied");
    expect(billing(host)).toEqual([
      ["/api/v1/stock/check", { units: 4 }],
      ["/api/v1/stock/charge", { provider: "pexels", units: 2, note: "gather 1,2" }],
    ]);
  });

  it("refuses without downloading when the person cannot pay", async () => {
    const host = searching({ routes: { "/api/v1/stock/check": () => { throw new Error(OUT_OF_CREDITS); } } });
    const result = await runTool({ doc: fixtureDoc(), host }, "gather_stock_footage_tool", { queries: "sea", count: 2 });
    expect(result.data?.status).toBe("refused");
    expect(result.text).toContain(OUT_OF_CREDITS);
    expect(host.calls.some((c) => c.startsWith("importUrl"))).toBe(false);
    expect(billing(host).map(([path]) => path)).toEqual(["/api/v1/stock/check"]);
  });
});
