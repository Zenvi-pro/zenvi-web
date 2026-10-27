import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createKitSampleCache } from "./sfx-kit.js";

const BYTES = new TextEncoder().encode("ID3 not really an mp3, but bytes to check");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const URL = "https://cdn.freesound.org/previews/59/59992_71257-hq.mp3";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function setup(body: Uint8Array = BYTES) {
  const root = await mkdtemp(path.join(tmpdir(), "zenvi-sfx-kit-"));
  dirs.push(root);
  const fetched: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    fetched.push(String(url));
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { root, fetched, kitSample: createKitSampleCache({ cacheRoot: root, fetchImpl }) };
}

describe("createKitSampleCache", () => {
  it("downloads a kit sound once into the shared cache, checked against its checksum", async () => {
    const { root, fetched, kitSample } = await setup();
    const file = await kitSample({ url: URL, sha256: SHA, bytes: BYTES.length });
    expect(file).toBe(path.join(root, "sfx-kit", `${SHA}.mp3`));
    expect(new Uint8Array(await readFile(file))).toEqual(BYTES);
    expect(await kitSample({ url: URL, sha256: SHA, bytes: BYTES.length })).toBe(file);
    expect(fetched).toEqual([URL]);
  });

  it("refuses bytes that do not match, keeps nothing of them, and fetches again over a damaged cache file", async () => {
    const bad = await setup(new TextEncoder().encode("something else"));
    await expect(bad.kitSample({ url: URL, sha256: SHA, bytes: 1 })).rejects.toThrow(/does not match the kit's checksum/);
    await expect(readFile(path.join(bad.root, "sfx-kit", `${SHA}.mp3`))).rejects.toThrow();
    const good = await setup();
    const file = await good.kitSample({ url: URL, sha256: SHA, bytes: BYTES.length });
    await writeFile(file, "truncated");
    await good.kitSample({ url: URL, sha256: SHA, bytes: BYTES.length });
    expect(good.fetched).toHaveLength(2);
  });

  it("reaches only Freesound's CDN", async () => {
    const { fetched, kitSample } = await setup();
    await expect(kitSample({ url: "https://example.com/x.mp3", sha256: SHA, bytes: 1 })).rejects.toThrow(/not on Freesound's CDN/);
    expect(fetched).toEqual([]);
  });
});
