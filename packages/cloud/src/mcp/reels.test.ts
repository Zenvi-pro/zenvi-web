import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import { nodeAnalyzeAudio, nodeAssetSource, nodeDecodePcm, nodeProber } from "../render/node.js";
import { type Harness, harness, USER_A } from "../testing/helpers.js";
import { EDITOR_META_KEY } from "./editor-widget.js";
import { loadEngineRegistry } from "./engine.js";
import { pickMusic, pickStockFile, pickStockVideo } from "./reels.js";

type CallResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };

const video = (id: number, width: number, height: number, duration: number, files: { width: number; height: number; link: string }[] = [{ width, height, link: `https://cdn.test/${id}.mp4` }]) => ({
  id,
  width,
  height,
  duration,
  video_files: files.map((f) => ({ ...f, quality: "hd", file_type: "video/mp4" })),
});

describe("stock picks", () => {
  it("prefer the frame's orientation, enough length and unused clips", () => {
    const list = [video(1, 1920, 1080, 12), video(2, 1080, 1920, 2), video(3, 1080, 1920, 9), video(4, 1080, 1920, 9)];
    expect(pickStockVideo(list, true, new Set())?.id).toBe(3);
    expect(pickStockVideo(list, true, new Set([3]))?.id).toBe(4);
    expect(pickStockVideo(list, false, new Set())?.id).toBe(1);
  });

  it("take the rendition just big enough for the frame", () => {
    const v = video(9, 2160, 3840, 10, [
      { width: 2160, height: 3840, link: "uhd" },
      { width: 1080, height: 1920, link: "fhd" },
      { width: 540, height: 960, link: "sd" },
    ]);
    expect(pickStockFile(v, 1080, true)).toBe("fhd");
    // Three quarters of the frame is enough (smaller downloads); less is not.
    expect(pickStockFile(v, 1440, true)).toBe("fhd");
    expect(pickStockFile(v, 1600, true)).toBe("uhd");
  });

  it("pick music long enough for the reel, open licences first", () => {
    const sounds = [
      { id: 1, name: "short", duration: 8, license: "Creative Commons 0", previews: { hq_mp3: "a" } },
      { id: 2, name: "nc", duration: 60, license: "Attribution NonCommercial 4.0", previews: { hq_mp3: "b" } },
      { id: 3, name: "by", duration: 60, license: "Attribution 4.0", previews: { hq_mp3: "c" } },
      { id: 4, name: "zero", duration: 60, license: "http://creativecommons.org/publicdomain/zero/1.0/", previews: { hq_mp3: "d" } },
    ];
    expect(pickMusic(sounds, 15)?.id).toBe(4);
    expect(pickMusic(sounds.slice(0, 3), 15)?.id).toBe(3);
  });
});

describe("create_reel", () => {
  let dir: string;
  let server: HttpServer;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "zenvi-reel-test-"));
    const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    for (const [name, source] of [["a", "testsrc2"], ["b", "smptehdbars"], ["c", "testsrc"]] as const) {
      ff(["-f", "lavfi", "-i", `${source}=size=360x640:rate=30`, "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, `${name}.mp4`)]);
    }
    // 20 s of 120 BPM kicks.
    ff(["-f", "lavfi", "-i", "sine=frequency=60:duration=0.08", "-af", "apad=whole_dur=0.5", path.join(dir, "kick.wav")]);
    ff(["-stream_loop", "39", "-i", path.join(dir, "kick.wav"), "-c:a", "libmp3lame", path.join(dir, "beat.mp3")]);
    server = createServer((req, res) => {
      const file = path.join(dir, path.basename(req.url ?? ""));
      try {
        const body = readFileSync(file);
        res.writeHead(200, { "content-type": file.endsWith(".mp3") ? "audio/mpeg" : "video/mp4", "content-length": String(body.length) }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  async function setup(): Promise<{ h: Harness; client: Client; searches: string[] }> {
    const h = await harness({
      config: { backendAuth: { kind: "assertion", secret: "s".repeat(40) } },
      engine: await loadEngineRegistry(),
      prober: nodeProber,
      analyzeAudio: nodeAnalyzeAudio,
      decodePcm: nodeDecodePcm,
      assets: nodeAssetSource(),
      network: {
        policy: { protocols: ["http:", "https:"], isAllowedAddress: (ip: string) => ip === "127.0.0.1", allowAnyPort: true },
        resolver: async () => [{ address: "127.0.0.1", family: 4 as const }],
      },
    });
    const searches: string[] = [];
    h.services.backendSessions.fetchImpl = async (url) => {
      const u = new URL(String(url));
      searches.push(`${u.pathname}?${u.searchParams.get("query")}`);
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (u.pathname.endsWith("/pexels/search")) {
        const q = u.searchParams.get("query") ?? "";
        const name = q.includes("huddle") ? "a" : q.includes("dribble") ? "b" : "c";
        return json({ videos: [{ id: name.charCodeAt(0), width: 360, height: 640, duration: 4, url: `https://pexels.test/${name}`, user_name: "Someone", video_files: [{ quality: "hd", file_type: "video/mp4", width: 360, height: 640, link: `${base}/${name}.mp4` }] }] });
      }
      if (u.pathname.endsWith("/freesound/search")) {
        return json({ sounds: [{ id: 77, name: "Beat loop", duration: 20, username: "maker", license: "Creative Commons 0", previews: { hq_mp3: `${base}/beat.mp3` } }] });
      }
      return new Response("{}", { status: 404 });
    };
    const token = (await h.services.tokens.createPat({ userId: USER_A, name: "test", scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: 1 })).token;
    const client = new Client({ name: "reel-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("https://cloud.test/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (url, init) => h.app.request(url.toString(), init),
      }),
    );
    return { h, client, searches };
  }

  it("goes from a short ask to a reel on the beat, open in the editor, with credits", async () => {
    const { h, client, searches } = await setup();
    const result = (await client.callTool({
      name: "create_reel",
      arguments: { prompt: "A 6 second match day reel", style: "highlight", duration_seconds: 6, stock_queries: ["team huddle", "player dribble", "goal celebration"], hook: "Match day", end_card: "See you Sunday" },
    })) as CallResult;
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    const data = result.structuredContent as { project_id: string; brief: { format: string; story: string }; shots: number; bpm: number; music?: { credit: string; license: string }; footage: unknown[]; warnings: string[] };
    expect(data.brief.format).toMatch(/vertical 9:16/);
    expect(data.brief.story).toMatch(/team huddle.*ends on goal celebration/);
    expect(data.bpm).toBeGreaterThan(110);
    expect(data.bpm).toBeLessThan(130);
    expect(data.music).toMatchObject({ credit: "maker on Freesound", license: "Creative Commons 0" });
    expect(data.footage).toHaveLength(3);
    expect(searches.filter((s) => s.startsWith("/api/v1/pexels"))).toHaveLength(3);
    expect(result.content[0]?.text).toMatch(/^Here's the brief for your reel:/);
    expect((result._meta?.[EDITOR_META_KEY] as { token?: string } | undefined)?.token).toMatch(/^zvn_emb_/);

    const { project } = await h.services.projects.get(USER_A, data.project_id);
    // Three clips and the song; the rest of the bin is the reel's title images.
    expect(project.files.filter((f) => !String(f.path).endsWith(".svg"))).toHaveLength(4);
    expect(project.clips.length).toBeGreaterThan(data.shots);
    expect(project.history?.undo?.length ?? 0).toBeGreaterThanOrEqual(2);
    await client.close();
  }, 60_000);

  it("refuses when there is no footage at all", async () => {
    const { client } = await setup();
    const result = (await client.callTool({ name: "create_reel", arguments: { prompt: "anything", no_music: true } })) as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("No footage");
    await client.close();
  });
});
