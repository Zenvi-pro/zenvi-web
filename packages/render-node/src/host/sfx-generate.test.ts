import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSfxGenerator } from "./sfx-generate.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function cache(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "zenvi-sfx-gen-"));
  dirs.push(dir);
  return dir;
}

/** A fake ElevenLabs: the subscription says `tier`, sound generation returns a few bytes. */
function fakeElevenLabs(tier: string | number) {
  const calls: { url: string; body?: unknown; key?: string }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: headers.get("xi-api-key") ?? undefined });
    if (url.endsWith("/user/subscription")) return typeof tier === "number" ? new Response("no", { status: tier }) : Response.json({ tier });
    return new Response(new Uint8Array([0xff, 0xfb, 1, 2, 3]), { headers: { "character-cost": "80", "request-id": "req-1" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const request = { prompt: "deep cinematic braam", durationSeconds: 2, promptInfluence: 0.7, loop: false };

describe("createSfxGenerator", () => {
  it("is not there without ELEVENLABS_API_KEY", async () => {
    expect(createSfxGenerator({ env: {}, cacheRoot: await cache() })).toBeUndefined();
  });

  it("generates on a paid plan with the length set, keeps provenance, and serves a repeat from the cache", async () => {
    const root = await cache();
    const fake = fakeElevenLabs("creator");
    const generate = createSfxGenerator({ env: { ELEVENLABS_API_KEY: "k-test" }, cacheRoot: root, fetchImpl: fake.fetchImpl })!;
    const first = await generate(request);
    expect(first).toMatchObject({ provider: "elevenlabs", model: "eleven_text_to_sound_v2", cached: false });
    expect(first.costUsd).toBeGreaterThan(0.01);
    expect(first.costUsd).toBeLessThan(0.02);
    const sent = fake.calls.find((c) => c.url.includes("/sound-generation"))!;
    expect(sent.url).toContain("output_format=mp3_44100_128");
    expect(sent.body).toEqual({ text: "deep cinematic braam", duration_seconds: 2, prompt_influence: 0.7, loop: false, model_id: "eleven_text_to_sound_v2" });
    expect(sent.key).toBe("k-test");
    const provenance = JSON.parse(await readFile(path.join(root, "sfx-gen", `${first.key}.json`), "utf8")) as Record<string, unknown>;
    expect(provenance).toMatchObject({ provider: "elevenlabs", plan: "creator", credits: 80, request_id: "req-1" });
    expect(JSON.stringify(provenance)).not.toContain("k-test");

    const again = await generate({ ...request, prompt: "  deep   cinematic braam " });
    expect(again).toMatchObject({ cached: true, path: first.path, key: first.key });
    expect(fake.calls.filter((c) => c.url.includes("/sound-generation"))).toHaveLength(1);
  });

  it("refuses a free-plan key (non-commercial output) and a key whose plan it cannot read", async () => {
    const free = createSfxGenerator({ env: { ELEVENLABS_API_KEY: "k" }, cacheRoot: await cache(), fetchImpl: fakeElevenLabs("free").fetchImpl })!;
    await expect(free(request)).rejects.toThrow(/free plan.*non-commercial/);
    const hidden = createSfxGenerator({ env: { ELEVENLABS_API_KEY: "k" }, cacheRoot: await cache(), fetchImpl: fakeElevenLabs(401).fetchImpl })!;
    await expect(hidden(request)).rejects.toThrow(/ELEVENLABS_PAID_PLAN=1/);
    const stated = createSfxGenerator({ env: { ELEVENLABS_API_KEY: "k", ELEVENLABS_PAID_PLAN: "1" }, cacheRoot: await cache(), fetchImpl: fakeElevenLabs(401).fetchImpl })!;
    await expect(stated(request)).resolves.toMatchObject({ cached: false });
  });
});
