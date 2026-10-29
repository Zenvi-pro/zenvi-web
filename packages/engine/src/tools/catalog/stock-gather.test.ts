import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../../render/types.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { IDS, fixtureDoc } from "../test-support/fixture.js";
import { pixelFrameHost } from "../test-support/pixel-host.js";
import type { ToolHost } from "../types.js";

const video = (id: number, user: string, slug: string, duration = 10) => ({
  id,
  width: 1920,
  height: 1080,
  duration,
  user_name: user,
  url: `https://www.pexels.com/video/${slug}-${id}/`,
  video_files: [{ quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: `https://cdn.test/${id}.mp4` }],
});

/** Downloads of ids in `twins` show one picture (a bright left half); every other download its own stripes. */
function painter(twins: readonly number[]) {
  return (path: string, width: number, height: number): RgbaImage => {
    const id = Number(/pexels_(\d+)/.exec(path)?.[1] ?? 0);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const v = twins.includes(id) ? (x < width / 2 ? 230 : 20) : Math.floor((x * (id % 7 + 2)) / width) % 2 === (Math.floor((y * (id % 5 + 2)) / height) % 2) ? 220 : 30;
        data.set([v, v, v, 255], (y * width + x) * 4);
      }
    }
    return { width, height, data };
  };
}

function host(results: Record<string, unknown[]>, twins: readonly number[] = []): ToolHost {
  const h = fakeHost({
    routes: {
      "/api/v1/pexels/search": (_body, path) => {
        const query = decodeURIComponent(/query=([^&]*)/.exec(path)?.[1] ?? "");
        return { total_results: results[query]?.length ?? 0, videos: results[query] ?? [] };
      },
    },
  });
  return { ...h, frames: pixelFrameHost(painter(twins)) };
}

describe("gather_stock_footage_tool", () => {
  it("takes the queries in turn, best page match first, and leaves out takes of one shoot and frames that look the same — one undo step", async () => {
    const doc = fixtureDoc();
    const before = doc.project.files.length;
    const result = await runTool(
      { doc, host: host(
        {
          "spiral galaxy": [video(1, "Ann", "night-sky"), video(2, "Ann", "spiral-galaxy-in-space"), video(3, "Ann", "spiral-galaxy-space-zoom")],
          "nautilus shell": [video(4, "Bo", "nautilus-shell-macro"), video(5, "Cy", "shell-on-sand")],
        },
        [4, 1],
      ) },
      "gather_stock_footage_tool",
      { queries: ["spiral galaxy", "nautilus shell"], count: 4 },
    );
    expect(result.data?.status, result.data?.summary).toBe("applied");
    const data = result.data?.data as { files: { pexels_id: number; query: string }[]; skipped: Record<string, number> };
    // 2 matches its query best; 3 is another take of 2's shoot; 4 comes next for the shell; 1 looks like 4; 5 fills in.
    expect(data.files.map((f) => [f.pexels_id, f.query])).toEqual([
      [2, "spiral galaxy"],
      [4, "nautilus shell"],
      [5, "nautilus shell"],
    ]);
    expect(data.skipped).toMatchObject({ same_shoot: 1, looks_the_same: 1 });
    expect(doc.project.files.length).toBe(before + 3);
    expect(doc.undoLabels.at(-1)).toBe("Gather stock footage (3)");
    expect(result.data?.warnings?.join(" ")).toMatch(/Imported 3 of 4/);
  });

  it("skips clips already in the project and outside the length asked for", async () => {
    const doc = fixtureDoc();
    const h = host({ moon: [video(7, "Di", "full-moon", 2), video(8, "Ed", "moon-rise"), video(9, "Fa", "moon-clouds")] });
    await runTool({ doc, host: h }, "gather_stock_footage_tool", { queries: "moon", count: 1 });
    const again = await runTool({ doc, host: h }, "gather_stock_footage_tool", { queries: "moon", count: 1 });
    const data = again.data?.data as { files: { pexels_id: number }[]; skipped: Record<string, number> };
    expect(data.files.map((f) => f.pexels_id)).toEqual([9]);
    expect(data.skipped).toMatchObject({ already_imported: 1, wrong_length: 1 });
  });

  describe("coherence=shoot", () => {
    const WARM = [200, 140, 90] as const;
    const COOL = [80, 120, 200] as const;
    const COOLISH = [130, 140, 170] as const;
    /** Stripes per Pexels id (so no two frames hash alike) in the id's colour; the fixture's own media is cool. */
    function tinted(colours: Record<number, readonly [number, number, number]>) {
      return (path: string, width: number, height: number): RgbaImage => {
        const id = Number(/pexels_(\d+)/.exec(path)?.[1] ?? 0);
        const [r, g, b] = colours[id] ?? COOL;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const on = Math.floor((x * (id % 7 + 2)) / width) % 2 === Math.floor((y * (id % 5 + 2)) / height) % 2;
            const k = on ? 1.1 : 0.8;
            data.set([r * k, g * k, b * k, 255], (y * width + x) * 4);
          }
        }
        return { width, height, data };
      };
    }
    const results = {
      "coffee pour": [video(1, "Ann", "coffee-pour-cafe"), video(2, "Bo", "coffee-pour-kitchen")],
      "latte art": [video(3, "Cy", "latte-art-heart"), video(4, "Ann", "latte-art-cafe")],
      "coffee beans": [video(6, "Di", "coffee-beans-roast"), video(5, "Ann", "coffee-beans-cafe")],
    };
    const colours = { 1: WARM, 4: WARM, 5: WARM, 2: COOLISH, 3: COOL, 6: COOL };
    const coherentHost = (): ToolHost => ({ ...host(results), frames: pixelFrameHost(tinted(colours)) });

    it("takes one contributor's shoot across the queries first and holds back clips off its look", async () => {
      const doc = fixtureDoc();
      const result = await runTool({ doc, host: coherentHost() }, "gather_stock_footage_tool", { queries: Object.keys(results), count: 4, coherence: "shoot" });
      expect(result.data?.status, result.data?.summary).toBe("applied");
      const data = result.data?.data as { files: { pexels_id: number; user: string; file_id: string }[]; skipped: Record<string, number>; coherence: Record<string, unknown> };
      // Ann shot all three searches: her clips lead each one; the cool shots wait, and the least cool fills the fourth place.
      expect(data.files.map((f) => f.pexels_id)).toEqual([1, 4, 5, 2]);
      expect(data.skipped.off_look).toBe(2);
      expect(data.coherence).toMatchObject({ creators: 2, top_creator: "Ann", top_creator_clips: 3, measured: true });
      expect(result.data?.warnings?.join(" ")).toMatch(/1 clip\(s\) are off the set's look/);
      expect(result.data?.summary).toMatch(/Next: cut them, then unify_grade_tool reference_file_id=\w+/);
      // Each import records where it came from, for the next gather and the brief's footage plan.
      const first = doc.project.files.find((f) => String(f.id) === data.files[0]!.file_id)!;
      expect(first.ai_metadata).toMatchObject({ source: "pexels", query: "coffee pour", creator: "Ann", pexels_id: 1 });
      expect(doc.undoLabels).toEqual(["Gather stock footage (4)"]);
    });

    it("lets a search no shoot of the set covers keep one shot: its closest after a few tries", async () => {
      const doc = fixtureDoc();
      const night = { "coffee pour": [video(1, "Ann", "coffee-pour-cafe")], "night street": [video(7, "Bo", "night-street"), video(8, "Cy", "night-street-rain"), video(9, "Di", "night-street-neon")] };
      const h: ToolHost = { ...host(night), frames: pixelFrameHost(tinted({ 1: WARM, 7: COOL, 8: COOL, 9: COOLISH })) };
      const result = await runTool({ doc, host: h }, "gather_stock_footage_tool", { queries: Object.keys(night), count: 2, coherence: "shoot" });
      const data = result.data?.data as { files: { pexels_id: number }[]; skipped: Record<string, number> };
      expect(data.files.map((f) => f.pexels_id)).toEqual([1, 9]);
      expect(data.skipped.off_look).toBe(2);
      expect(result.data?.warnings?.join(" ")).toMatch(/1 clip\(s\) are off the set's look/);
    });

    it("matches the person's footage when match_file_id names it", async () => {
      const doc = fixtureDoc();
      const result = await runTool({ doc, host: coherentHost() }, "gather_stock_footage_tool", {
        queries: Object.keys(results),
        count: 2,
        coherence: "shoot",
        match_file_id: IDS.broll,
      });
      const data = result.data?.data as { files: { pexels_id: number }[]; coherence: Record<string, unknown> };
      // The fixture's b-roll is cool: Ann's warm shoot waits behind the cool clips.
      expect(data.files.map((f) => f.pexels_id)).toEqual([3, 6]);
      expect(data.coherence.look_reference).toBe(IDS.broll);
    });

    it("refuses match_file_id without coherence, and a file that is not in the bin", async () => {
      const doc = fixtureDoc();
      const off = await runTool({ doc, host: coherentHost() }, "gather_stock_footage_tool", { queries: "coffee pour", match_file_id: IDS.broll });
      expect(off.data?.summary).toBe("Error: match_file_id needs coherence='shoot'.");
      const missing = await runTool({ doc, host: coherentHost() }, "gather_stock_footage_tool", { queries: "coffee pour", coherence: "shoot", match_file_id: "NOPE" });
      expect(missing.data?.summary).toBe("Error: media-bin file NOPE not found.");
      expect(doc.undoLabels).toEqual([]);
    });
  });
});
