import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../../render/types.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { fixtureDoc } from "../test-support/fixture.js";
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
});
