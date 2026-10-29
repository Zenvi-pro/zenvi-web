import { describe, expect, it } from "vitest";
import { addFile } from "../ops/files.js";
import { runTool } from "../tools/registry.js";
import { fakeHost } from "../tools/test-support/fake-host.js";
import { METHOD } from "../tools/test-support/brief-fixture.js";
import { IDS, fixtureDoc, videoInfo } from "../tools/test-support/fixture.js";
import { briefSchema } from "./brief.js";
import { coverageLines, footageCoverage, footageOrigin } from "./coverage.js";

const row = (start: number, picture: string, source: string, file_id?: string) => ({
  start,
  beats: 2,
  picture,
  motif: "laces",
  source,
  ...(file_id ? { file_id } : {}),
  composition: "full bleed",
  text_entrance: "none",
  tone: "dark earth",
});

const STORYBOARD = [
  row(0, "the speaker to camera", "media", IDS.interview),
  row(1, "speaker talks about the camera", "media"),
  row(2, "laces yanked tight", "stock"),
  row(3, "trail at dawn", "stock"),
  row(4, "fog over the ridge", "generate"),
  row(5, "contours draw on", "motion"),
];

function brief(storyboard = STORYBOARD) {
  return briefSchema.parse({
    goal: "Runners want the shoe",
    platform: "Reels",
    aspect: "9:16",
    length_seconds: 6,
    style: "hype-reel",
    hook: "A shoe hits mud",
    beats: [{ start: 0, end: 6, name: "hook" }],
    palette: "dark earth, one orange accent",
    ...METHOD,
    storyboard,
  });
}

/** The fixture plus one gathered stock clip (as gather_stock_footage_tool records it) and an unused clip of the person's. */
function docWithStock() {
  const doc = fixtureDoc();
  doc.transaction("stock", (tx) => {
    addFile(tx, { path: "/downloads/pexels_9.mp4", info: videoInfo("/downloads/pexels_9.mp4", 8) }, { id: "FILESTOCK1" });
    tx.update(["files", { id: "FILESTOCK1" }], { ai_metadata: { source: "pexels", query: "laces pulled tight", creator: "Ann", pexels_id: 9 } });
    addFile(tx, { path: "/media/workshop.mov", info: videoInfo("/media/workshop.mov", 30) }, { id: "FILEOWN001" });
  });
  return doc;
}

describe("footageCoverage", () => {
  it("maps the storyboard to the bin: the person's media first, then stock already fetched; the rest to fetch, generate or ask for", () => {
    const doc = docWithStock();
    const coverage = footageCoverage(doc.project, brief());
    expect(coverage.shots.map((s) => [s.status, s.file_id ?? null, s.origin ?? null])).toEqual([
      ["covered", IDS.interview, "media"],
      // The interview is taken by the first row; a second match counts only when it fits well even so.
      ["ask", null, null],
      ["covered", "FILESTOCK1", "stock"],
      ["fetch", null, null],
      ["generate", null, null],
      ["built", null, null],
    ]);
    expect(coverage.counts).toEqual({ covered: 2, fetch: 1, generate: 1, ask: 1, built: 1 });
    // The workshop clip is the person's footage no shot uses; the b-roll and logo are on the timeline already.
    expect(coverage.unused_media).toEqual(["FILEOWN001"]);
    expect(coverage.next).toEqual([
      { tool: "gather_stock_footage_tool", args: { queries: ["trail at dawn"], count: 2, coherence: "shoot", match_file_id: IDS.interview } },
      {
        tool: "generate_broll_set_tool",
        args: { shots: ["fog over the ridge"], style: "dark earth, one orange accent; blueprint line drawing", reference_file_id: IDS.interview },
      },
    ]);
    const lines = coverageLines(coverage, doc.project);
    expect(lines[0]).toBe("Footage: 2/5 shots covered (1 by your media, 1 by stock); missing: 1 to fetch, 1 to generate, 1 need a file from the person.");
    expect(lines).toContain('- 3s "trail at dawn": fetch');
    expect(lines.at(-1)).toBe("Then cut, and unify_grade_tool on the assembled set so every source shares one grade.");
  });

  it("names a file the plan points at that is not in the bin", () => {
    const coverage = footageCoverage(fixtureDoc().project, brief([row(0, "the sole", "stock", "GONEXXXXXX")]));
    expect(coverage.shots[0]).toMatchObject({ status: "fetch", reason: "file GONEXXXXXX is not in the bin" });
  });

  it("tells stock and generated files from the person's", () => {
    expect(footageOrigin({ id: "a", path: "/x/pexels_12.mp4" } as never)).toBe("stock");
    expect(footageOrigin({ id: "b", path: "/x/generated_ab.png", tags: "ai_generated" } as never)).toBe("generate");
    expect(footageOrigin({ id: "c", path: "/x/me.mov" } as never)).toBe("media");
  });
});

describe("get_brief_tool's footage plan", () => {
  it("lists what the bin covers and the calls for the rest", async () => {
    const doc = docWithStock();
    doc.transaction("brief", (tx) => tx.update(["settings"], { zenvi_brief: brief() }));
    const result = await runTool({ doc, host: fakeHost() }, "get_brief_tool", {});
    expect(result.data?.summary).toMatch(/\nFootage: 2\/5 shots covered [\s\S]*\nNext: gather_stock_footage_tool \{"queries":\["trail at dawn"\]/);
    expect((result.data?.data as { footage: { counts: Record<string, number> } }).footage.counts.fetch).toBe(1);
  });
});
