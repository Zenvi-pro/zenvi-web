import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, fingerprint, scriptsHash, type FingerprintInput } from "./fingerprint.js";

const base: FingerprintInput = {
  scene: "title_3d",
  params: { text: "Hi", style: "chrome", background: "transparent" },
  width: 540,
  height: 960,
  fps: { num: 30, den: 1 },
  frames: 90,
  quality: "draft",
  media: {},
  font: null,
  scripts: "s".repeat(64),
};

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: undefined, x: 0 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":0,"z":1}]},"b":1}');
  });
});

describe("fingerprint", () => {
  it("is stable for equal inputs and changes with anything that changes the pixels", () => {
    const fp = fingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint({ ...base, params: { background: "transparent", style: "chrome", text: "Hi" } })).toBe(fp);
    for (const change of [{ params: { ...base.params as object, text: "Ho" } }, { width: 1080 }, { frames: 91 }, { quality: "final" }, { fps: { num: 25, den: 1 } }, { scripts: "t".repeat(64) }, { media: { screen: { stamp: { file: "/a.mp4", size: 1, mtime: 2 }, start: 0, kind: "video" } } }]) {
      expect(fingerprint({ ...base, ...change } as FingerprintInput)).not.toBe(fp);
    }
  });
});

describe("scriptsHash", () => {
  it("hashes every .py by relative path, so editing a scene re-renders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-hash-"));
    await mkdir(path.join(dir, "scenes"));
    await writeFile(path.join(dir, "worker.py"), "print(1)\n");
    await writeFile(path.join(dir, "scenes", "a.py"), "A = 1\n");
    await writeFile(path.join(dir, "notes.txt"), "ignored\n");
    const first = await scriptsHash(dir);
    await writeFile(path.join(dir, "notes.txt"), "still ignored\n");
    expect(await scriptsHash(dir)).toBe(first);
    await writeFile(path.join(dir, "scenes", "a.py"), "A = 2\n");
    expect(await scriptsHash(dir)).not.toBe(first);
  });
});
