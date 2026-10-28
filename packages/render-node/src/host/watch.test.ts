/**
 * The Node WatchHost: the proxy is made by real ffmpeg from generated media;
 * the backend and Gemini are fake fetches, so what is checked is what goes
 * out (size, fields, no upload when signed out) and how answers come back.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isWatchError, WATCH_PATH } from "@zenvi/engine";
import { ffprobeJson, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { backendCritic, createNodeWatchHost, geminiCritic, makeWatchProxy } from "./watch.js";

let dir: string;
let tall: string;

beforeAll(async () => {
  dir = await makeTempDir("zenvi-watch-test-");
  tall = await makeVideo(dir, "tall.mp4", { width: 1080, height: 1920, fps: "60", duration: 1.5, audioHz: 440 });
}, 60_000);

afterAll(async () => removeDir(dir));

const ANSWER = {
  model: "gemini-3.8-flash",
  duration: 1.5,
  has_audio: true,
  verdict: "Short test card.",
  overall: 3,
  would_post: false,
  scores: { hook: 3, sound_design: 2 },
  issues: [{ start: 0.2, end: 0.6, dimension: "sound_design", severity: "high", problem: "A flat tone.", fix: "Add a hit at 0.5 s." }],
  strengths: [],
  usage: { input_tokens: 500, output_tokens: 300, credits: 1 },
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, impl };
}

describe("watch host (node)", { timeout: 60_000 }, () => {
  it("makes a 640 px, 30 fps proxy with the sound", async () => {
    const proxy = await makeWatchProxy(tall);
    expect(proxy.hasAudio).toBe(true);
    expect(proxy.duration).toBeCloseTo(1.5, 1);
    const out = `${dir}/proxy-check.mp4`;
    await (await import("node:fs/promises")).writeFile(out, proxy.bytes);
    const probe = await ffprobeJson(out);
    const video = probe.streams.find((s) => s.codec_type === "video")!;
    expect([video.width, video.height]).toEqual([360, 640]);
    const [num, den] = String(video.r_frame_rate).split("/").map(Number);
    expect(num! / den!).toBeLessThanOrEqual(30);
    expect(probe.streams.some((s) => s.codec_type === "audio")).toBe(true);
  });

  it("refuses a render over 90 s and a file with no picture", async () => {
    const long = await makeVideo(dir, "long.mp4", { width: 32, height: 32, fps: "1", duration: 92 });
    await expect(makeWatchProxy(long)).rejects.toSatisfy((e) => isWatchError(e) && e.code === "too_long");
    const text = `${dir}/notes.mp4`;
    await (await import("node:fs/promises")).writeFile(text, "not a video");
    await expect(makeWatchProxy(text)).rejects.toSatisfy((e) => isWatchError(e) && e.code === "rejected");
  });

  it("posts the proxy and the fields to the backend as the signed-in person", async () => {
    const backend = fakeFetch(200, ANSWER);
    const critic = backendCritic({ baseUrl: "https://api.test/", token: async () => "tok-1", fetchImpl: backend.impl });
    const critique = await critic(tall, { brief: "test", focus: ["sound_design", "mix"], timelineNotes: "shot 1 0.00-1.50 tall.mp4" });
    expect(backend.calls[0]!.url).toBe(`https://api.test${WATCH_PATH}`);
    expect((backend.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    const form = backend.calls[0]!.init.body as FormData;
    expect((form.get("video") as File).size).toBeGreaterThan(1000);
    expect([form.get("brief"), form.get("focus"), form.get("timeline_notes")]).toEqual(["test", "sound_design,mix", "shot 1 0.00-1.50 tall.mp4"]);
    expect(critique).toMatchObject({ via: "backend", model: "gemini-3.8-flash", overall: 3, usage: { inputTokens: 500, outputTokens: 300, credits: 1 } });
    expect(critique.issues[0]).toMatchObject({ dimension: "sound_design", severity: "high", fix: "Add a hit at 0.5 s." });
    expect(critique.scores.mix).toBeNull();
  });

  it("refuses signed out before making or sending anything, and maps the backend's refusals", async () => {
    const backend = fakeFetch(200, ANSWER);
    const signedOut = backendCritic({ baseUrl: "https://api.test", token: async () => undefined, fetchImpl: backend.impl });
    await expect(signedOut("/no/such/file.mp4", {})).rejects.toSatisfy((e) => isWatchError(e) && e.code === "sign_in" && /zenvi login/.test(e.message));
    expect(backend.calls).toHaveLength(0);
    const personal = backendCritic({ baseUrl: "https://api.test", token: async () => "pat", unavailable: async () => "A personal token only works with Zenvi Cloud.", fetchImpl: backend.impl });
    await expect(personal(tall, {})).rejects.toThrow("only works with Zenvi Cloud");

    const broke = fakeFetch(402, { detail: { code: "insufficient_credits", message: "Need 7, have 0." } });
    await expect(backendCritic({ baseUrl: "https://api.test", token: async () => "t", fetchImpl: broke.impl })(tall, {})).rejects.toSatisfy(
      (e) => isWatchError(e) && e.code === "credits",
    );
  });

  it("asks Gemini directly with a developer key, with the backend's prompt and schema", async () => {
    const gemini = fakeFetch(200, {
      candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify(ANSWER) }] } }],
      usageMetadata: { promptTokenCount: 450, candidatesTokenCount: 200, thoughtsTokenCount: 100 },
    });
    const critique = await geminiCritic({ apiKey: "dev-key", fetchImpl: gemini.impl })(tall, { brief: "test" });
    const call = gemini.calls[0]!;
    expect(call.url).toMatch(/models\/gemini-3\.8-flash:generateContent$/);
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("dev-key");
    const body = JSON.parse(String(call.init.body));
    expect(body.contents[0].parts[0].videoMetadata).toEqual({ fps: 4 });
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe("video/mp4");
    expect(body.contents[0].parts[1].text).toContain("test");
    expect(body.generationConfig).toMatchObject({ temperature: 0, responseMimeType: "application/json", mediaResolution: "MEDIA_RESOLUTION_LOW" });
    expect(critique).toMatchObject({ via: "gemini", usage: { inputTokens: 450, outputTokens: 300 } });
    expect(critique.issues).toHaveLength(1);
  });

  it("uses the developer key when set, else the backend, else nothing", () => {
    const backend = { baseUrl: "https://api.test", token: async () => undefined };
    expect(createNodeWatchHost({ env: {}, resolvePath: (p) => p })).toBeUndefined();
    expect(createNodeWatchHost({ env: {}, backend, resolvePath: (p) => p })).toBeDefined();
    expect(createNodeWatchHost({ env: { ZENVI_GEMINI_API_KEY: "k" }, resolvePath: (p) => p })).toBeDefined();
  });
});
