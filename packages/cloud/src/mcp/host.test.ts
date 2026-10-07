import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AudioEnvelope, ReaderInfo } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import type { AssetSource, MediaProber } from "../render/renderer.js";
import { fakeRenderer } from "../testing/fakes.js";
import { type Harness, harness, sampleProject, USER_A } from "../testing/helpers.js";
import { loadEngineRegistry } from "./engine.js";
import { createCloudHost } from "./host.js";
import type { McpCallContext } from "./types.js";

const ENGINE_ASSETS = fileURLToPath(new URL("../../../engine/assets/", import.meta.url));
const engineAssets: AssetSource = { readText: (path) => readFile(`${ENGINE_ASSETS}${path}`, "utf8") };

/** Reader info like render-node's for an SVG title or any other file. */
const prober: MediaProber = {
  available: true,
  async probe(path: string): Promise<ReaderInfo> {
    const svg = path.endsWith(".svg");
    return {
      type: svg ? "QtImageReader" : "FFmpegReader",
      path,
      has_video: true,
      has_audio: !svg,
      has_single_image: svg,
      duration: svg ? 3600 : 2,
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      video_length: svg ? 108000 : 60,
      pixel_ratio: { num: 1, den: 1 },
      display_ratio: { num: 16, den: 9 },
      sample_rate: svg ? 0 : 48000,
      channels: svg ? 0 : 2,
      channel_layout: svg ? 0 : 3,
      media_type: svg ? "image" : "video",
    };
  },
};

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

async function connect(h: Harness): Promise<Client> {
  const { token } = await h.services.tokens.createPat({ userId: USER_A, name: "t", scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: 1 });
  const client = new Client({ name: "host-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://cloud.test/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (url, init) => h.app.request(url.toString(), init),
    }),
  );
  return client;
}

type Result = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<Result> =>
  (await client.callTool({ name, arguments: args })) as Result;

function context(h: Harness): McpCallContext {
  return {
    services: h.services,
    principal: { kind: "pat", userId: USER_A, tokenId: "tok_test", name: "t", scopes: [SCOPE_READ, SCOPE_WRITE] },
    connection: "tok_test",
    origin: "https://cloud.test",
    signal: new AbortController().signal,
  };
}

describe("create_project profiles over MCP", () => {
  it("creates the vertical progressive project that was asked for, and lists close profiles instead of guessing", async () => {
    const h = await harness();
    const client = await connect(h);
    const vertical = await call(client, "create_project", { name: "Teaser", profile: "Vertical HD 1080p 30 fps" });
    expect(vertical.structuredContent).toMatchObject({ profile: "FHD Vertical 1080p 30 fps", width: 1080, height: 1920, fps: 30 });
    const stored = await h.services.projects.get(USER_A, vertical.structuredContent?.project_id as string);
    expect(stored.project).toMatchObject({ profile: "FHD Vertical 1080p 30 fps", width: 1080, height: 1920 });

    const plain = await call(client, "create_project", { name: "Default" });
    expect(plain.structuredContent).toMatchObject({ profile: "FHD 1080p 30 fps", width: 1920, height: 1080 });

    const unknown = await call(client, "create_project", { name: "X", profile: "vertical 4k" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toMatch(/Close profiles: "FHD Vertical/);

    const both = await call(client, "create_project", { name: "X", profile: "square", fps: 60 });
    expect(both.isError).toBe(true);

    const stray = await call(client, "create_project", { name: "X", resolution: "1080p" });
    expect(stray.isError).toBe(true);
    expect(stray.content[0]?.text).toBe("Error: Unknown argument for create_project: resolution. Accepted: name, profile, format, fps.");
    await client.close();
  });
});

describe("titles in the cloud", () => {
  it("add_title_tool stores the SVG as content-addressed project media that cloud renders resolve", async () => {
    const renderer = fakeRenderer();
    const h = await harness({ engine: await loadEngineRegistry(), prober, assets: engineAssets, renderer });
    const client = await connect(h);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["add_title_tool", "add_captions_tool", "export_captions_tool"]));

    const projectId = (await call(client, "create_project", { name: "Titles" })).structuredContent?.project_id as string;
    const title = await call(client, "add_title_tool", { text: "Hello cloud" });
    expect(title.isError).toBeFalsy();

    const { project } = await h.services.projects.get(USER_A, projectId);
    const file = project.files.find((f) => String(f.path).startsWith("@assets/title/"));
    expect(file).toBeDefined();
    expect(file?.media_type).toBe("image");
    expect(file?.cloud).toMatchObject({ size: expect.any(Number), content_type: "image/svg+xml" });
    const svg = (await h.services.media.download(USER_A, file!.cloud!.sha256, `${h.config.renderTmpDir}/svg-${projectId}.svg`), await readFile(`${h.config.renderTmpDir}/svg-${projectId}.svg`, "utf8"));
    expect(svg).toContain("Hello cloud");
    expect(sha(svg)).toBe(file?.cloud?.sha256);
    const clip = project.clips.find((c) => c.file_id === file?.id);
    expect(clip).toBeDefined();

    const job = await h.services.renders.start(USER_A, projectId, {});
    await h.services.renders.drain();
    expect((await h.services.renders.getById(USER_A, job.renderId)).status).toBe("done");
    expect(renderer.renders).toBe(1);
    await client.close();
  });

  it("title tools stay hidden when the bundled assets are missing", async () => {
    const h = await harness({ engine: await loadEngineRegistry(), prober });
    const client = await connect(h);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("add_title_tool");
    expect(names).toContain("export_captions_tool");
    await client.close();
  });
});

describe("the cloud ToolHost", () => {
  async function projectWithMedia(h: Harness, name: string, bytes: Buffer, contentType: string) {
    const hash = sha(bytes);
    await h.services.media.storeBytes(USER_A, { sha256: hash, bytes, name, contentType });
    const created = await h.services.projects.create(USER_A, {
      name: "P",
      project: sampleProject({ files: [{ id: "F1", path: `/Users/me/${name}`, media_type: "video", cloud: { sha256: hash, size: bytes.length, name } }] }) as never,
    });
    const loaded = await h.services.projects.get(USER_A, created.id);
    return { projectId: created.id, project: loaded.project };
  }

  it("reads project media as text and exports text as a download link", async () => {
    const h = await harness({ prober });
    const { projectId, project } = await projectWithMedia(h, "talk.srt", Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nHi\n"), "application/x-subrip");
    const { host, dispose } = createCloudHost(context(h), projectId, () => project);
    expect(await host.storage!.readText!("/Users/me/talk.srt")).toContain("Hi");
    await expect(host.storage!.readText!("/etc/passwd")).rejects.toThrow("not media in this project");
    const url = await host.storage!.writeText!("/Users/me/Desktop/captions out.srt", "1\nx\n", "application/x-subrip");
    expect((await h.blobs.acceptSignedRead(url)).toString()).toBe("1\nx\n");
    expect(new URL(url).searchParams.get("rscd")).toBe('attachment; filename="captions_out.srt"');
    await expect(host.storage!.save(project)).rejects.toThrow("saves the project");
    await dispose();
  });

  it("analyzes the audio of project media from a local copy", async () => {
    const seen: string[] = [];
    const analyzeAudio = async (file: string): Promise<AudioEnvelope> => {
      seen.push(await readFile(file, "utf8"));
      return { sampleRate: 16000, frameSize: 480, rms: [0.1, 0.2] };
    };
    const h = await harness({ prober, analyzeAudio });
    const { projectId, project } = await projectWithMedia(h, "voice.wav", Buffer.from("pcm bytes"), "audio/wav");
    const { host, dispose } = createCloudHost(context(h), projectId, () => project);
    expect((await host.audio!.analyzeAudio("/Users/me/voice.wav")).rms).toEqual([0.1, 0.2]);
    expect(seen).toEqual(["pcm bytes"]);
    await dispose();
  });

  it("names generated media after the file, never reusing a path that holds other bytes", async () => {
    const h = await harness({ prober });
    const { projectId } = await projectWithMedia(h, "x.mp4", Buffer.from("x"), "video/mp4");
    const taken = sampleProject({ files: [{ id: "F9", path: "@assets/title/Hi.svg", media_type: "image", cloud: { sha256: "b".repeat(64), size: 1, name: "Hi.svg" } }] });
    const { host, dispose } = createCloudHost(context(h), projectId, () => taken as never);
    const bytes = new TextEncoder().encode("<svg>hi</svg>");
    const path = await host.media!.writeGenerated!("Hi.svg", bytes, "image/svg+xml");
    expect(path).toBe(`@assets/title/Hi-${sha("<svg>hi</svg>").slice(0, 8)}.svg`);
    const info = await host.media!.probe(path);
    expect(info).toMatchObject({ path, cloud: { sha256: sha("<svg>hi</svg>"), content_type: "image/svg+xml", name: "Hi.svg" } });
    expect(await h.services.media.get(USER_A, sha("<svg>hi</svg>"))).toMatchObject({ verified: true });
    await expect(host.media!.writeGenerated!("x.html", bytes, "text/html")).rejects.toThrow("does not store");
    await dispose();
  });
});
