import { describe, expect, it } from "vitest";
import goldens from "./__fixtures__/desktop-upgrades.json" with { type: "json" };
import { fromStoredPath, fromStoredPaths, projectAssetsDir, toStoredPath, toStoredPaths, type PathRoots } from "./paths.js";

interface PathGoldens {
  projectFile: string;
  projectDir: string;
  roots: Required<PathRoots>;
  store: [string, string][];
  load: [string, string][];
}

const paths = (goldens as unknown as { paths: Record<"posix" | "win32", PathGoldens> }).paths;

describe("stored paths match the desktop's json_data.py conversion", () => {
  for (const flavor of ["posix", "win32"] as const) {
    const g = paths[flavor];
    describe(flavor, () => {
      for (const [input, expected] of g.store) {
        it(`stores ${JSON.stringify(input)}`, () => {
          expect(toStoredPath(input, g.projectDir, g.roots)).toBe(expected);
        });
      }
      for (const [input, expected] of g.load) {
        it(`loads ${JSON.stringify(input)}`, () => {
          // The desktop skips normpath for @colors/@emojis/@assets on Windows
          // (mixed separators); the engine normalizes every path.
          const want = flavor === "win32" ? expected.replace(/\//g, "\\") : expected;
          expect(fromStoredPath(input, g.projectDir, g.roots)).toBe(want);
        });
      }
      it("round-trips stored paths", () => {
        for (const [, stored] of g.store) {
          if (stored === "") continue;
          expect(toStoredPath(fromStoredPath(stored, g.projectDir, g.roots), g.projectDir, g.roots)).toBe(stored);
        }
      });
      it("names the assets folder like get_assets_path", () => {
        expect(projectAssetsDir(g.projectFile)).toBe(g.roots.assets);
      });
    });
  }
});

describe("stored path edge cases", () => {
  const dir = "/home/me/Videos/Trip";

  it("never rewrites URLs or data URIs", () => {
    for (const url of ["https://cdn.example.com/a.mp4", "blob:https://zenvi.pro/1234", "data:image/png;base64,AAAA", "file:///x.mp4"]) {
      expect(toStoredPath(url, dir)).toBe(url);
      expect(fromStoredPath(url, dir)).toBe(url);
    }
  });

  it("keeps aliases when their root is unknown, in both directions", () => {
    expect(fromStoredPath("@transitions/common/fade.svg", dir)).toBe("@transitions/common/fade.svg");
    expect(toStoredPath("@transitions/common/fade.svg", dir)).toBe("@transitions/common/fade.svg");
    expect(toStoredPath("@assets/title/T.svg", dir, { assets: "/elsewhere" })).toBe("@assets/title/T.svg");
  });

  it("does not take look-alike folders for aliases", () => {
    expect(toStoredPath("/opt/zenvi/transitions-extra/x.svg", dir, { transitions: "/opt/zenvi/transitions" })).toBe(
      "/opt/zenvi/transitions-extra/x.svg",
    );
    expect(toStoredPath("/home/me/Videos/Tripod/x.mp4", dir)).toBe("/home/me/Videos/Tripod/x.mp4");
  });

  it("keeps deeper paths under an alias root", () => {
    expect(toStoredPath("/app/transitions/extra/sub/x.jpg", dir, { transitions: "/app/transitions" })).toBe(
      "@transitions/extra/sub/x.jpg",
    );
  });

  it("requires an absolute project folder", () => {
    expect(() => toStoredPath("a.mp4", "relative/dir")).toThrow(TypeError);
    expect(() => fromStoredPaths({}, "")).toThrow(TypeError);
  });

  it("names assets folders like os.path.splitext + [:248]", () => {
    expect(projectAssetsDir("/v/My.Trip.zvn")).toBe("/v/My.Trip_assets");
    expect(projectAssetsDir("/v/.zvn")).toBe("/v/.zvn_assets");
    expect(projectAssetsDir("/trip.osp")).toBe("/trip_assets");
    expect(projectAssetsDir("C:\\Users\\me\\a.zvn")).toBe("C:\\Users\\me\\a_assets");
    expect(projectAssetsDir(`/v/${"x".repeat(300)}.zvn`)).toBe(`/v/${"x".repeat(248)}_assets`);
  });

  it("copies only what changes and shares the rest", () => {
    const project = {
      files: [{ id: "F1", path: "/home/me/Videos/Trip/a.mp4" }],
      clips: [{ id: "C1", reader: { path: "@transitions/x.svg" }, alpha: { Points: [] } }],
      settings: { deep: { deeper: { path: "" } } },
    };
    const stored = toStoredPaths(project, dir);
    expect(stored).not.toBe(project);
    expect(stored.files).not.toBe(project.files);
    expect(stored.files[0]!.path).toBe("a.mp4");
    expect(stored.clips).toBe(project.clips);
    expect(stored.settings).toBe(project.settings);
    // Nothing to change: the same object comes back.
    expect(toStoredPaths(stored, dir)).toBe(stored);
  });

  it("keeps __proto__ keys as data and rejects data that is not a tree", () => {
    const parsed = JSON.parse('{"files": [{"__proto__": {"x": 1}, "path": "/home/me/Videos/Trip/a.mp4"}]}') as {
      files: Record<string, unknown>[];
    };
    const stored = toStoredPaths(parsed, dir);
    expect(Object.getPrototypeOf(stored.files[0])).toBe(Object.prototype);
    expect(Object.hasOwn(stored.files[0]!, "__proto__")).toBe(true);
    const shared = { path: "/home/me/Videos/Trip/a.mp4" };
    expect(() => toStoredPaths({ a: shared, b: shared }, dir)).toThrow(TypeError);
    const deep: Record<string, unknown> = { path: "/home/me/Videos/Trip/a.mp4" };
    let top = deep;
    for (let i = 0; i < 100_000; i += 1) top = { next: top };
    expect(() => toStoredPaths(top, dir)).not.toThrow();
  });

  it("rewrites every path key at any depth and nothing else", () => {
    const project = {
      files: [{ id: "F1", path: "/home/me/Videos/Trip/a.mp4", image: "/home/me/Videos/Trip/trip_assets/thumbnail/F1.png", name: "/home/me/x" }],
      clips: [
        {
          id: "C1",
          reader: { path: "/home/me/Videos/Trip/a.mp4" },
          effects: [{ id: "E1", lut_path: "/app/colors/a/b.cube", mask_reader: { path: "/home/me/Videos/Trip/m.png" } }],
        },
      ],
      effects: [{ id: "T1", resource: "/app/transitions/common/fade.svg", reader: { path: "/app/transitions/common/fade.svg" } }],
      history: { undo: [{ type: "insert", key: ["files"], value: { path: "/home/me/Videos/Trip/b.mp4" } }], redo: [] },
      notes: { path: 42 },
    };
    const roots: PathRoots = {
      transitions: "/app/transitions",
      colors: "/app/colors",
      thumbnails: "/home/me/Videos/Trip/trip_assets/thumbnail",
      assets: "/home/me/Videos/Trip/trip_assets",
    };
    const stored = toStoredPaths(project, dir, roots);
    expect(stored).toEqual({
      files: [{ id: "F1", path: "a.mp4", image: "thumbnail/F1.png", name: "/home/me/x" }],
      clips: [{ id: "C1", reader: { path: "a.mp4" }, effects: [{ id: "E1", lut_path: "@colors/a/b.cube", mask_reader: { path: "m.png" } }] }],
      effects: [{ id: "T1", resource: "@transitions/common/fade.svg", reader: { path: "@transitions/common/fade.svg" } }],
      history: { undo: [{ type: "insert", key: ["files"], value: { path: "b.mp4" } }], redo: [] },
      notes: { path: 42 },
    });
    // The input is untouched.
    expect(project.files[0]!.path).toBe("/home/me/Videos/Trip/a.mp4");
    // Loading brings back absolute paths (thumbnails come back relative to the
    // project folder, as on the desktop).
    const loaded = fromStoredPaths(stored, dir, roots);
    expect(loaded.clips[0]!.effects[0]!.lut_path).toBe("/app/colors/a/b.cube");
    expect(loaded.effects[0]!.reader.path).toBe("/app/transitions/common/fade.svg");
    expect(loaded.files[0]!.image).toBe("/home/me/Videos/Trip/thumbnail/F1.png");
    expect(loaded.history.undo[0]!.value.path).toBe("/home/me/Videos/Trip/b.mp4");
  });
});
