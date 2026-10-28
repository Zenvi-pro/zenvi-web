import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FILLER_PROMPT, isTranscriptionError, parseTranscription, type AudioEnvelope, type MotionBlockInfo, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import type { AssetSource, MatteHostFactory, MediaProber, MixRenderer, MotionHostFactory, RenderInput, SpeechTranscriber } from "../render/renderer.js";
import { fakeRenderer } from "../testing/fakes.js";
import { type Harness, harness, sampleProject, USER_A } from "../testing/helpers.js";
import { loadEngineRegistry } from "./engine.js";
import { cloudCapabilities, createCloudHost } from "./host.js";
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
const textOf = (result: Result): string => result.content.map((c) => c.text ?? "").join("\n");

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

  it("add_title_tool checks a font against the fonts the cloud renders titles with", async () => {
    const fontFamilies = async () => ["DejaVu Sans", "DejaVu Sans Mono", "Lato", "Liberation Mono", "Liberation Sans", "Liberation Serif"];
    const h = await harness({ engine: await loadEngineRegistry(), prober, assets: engineAssets, renderer: fakeRenderer(), fontFamilies });
    const client = await connect(h);
    const projectId = (await call(client, "create_project", { name: "Fonts" })).structuredContent?.project_id as string;
    const refused = await call(client, "add_title_tool", { text: "Hi", font: "Helvetica Neue" });
    expect(textOf(refused)).toMatch(/font 'Helvetica Neue' is not installed; installed fonts like it: /);
    const titled = await call(client, "add_title_tool", { text: "Hi", font: "liberation sans", text_color: "white", fade_in_seconds: 0.5 });
    expect(textOf(titled)).toContain('"font":"Liberation Sans"');
    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.clips).toHaveLength(1);
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

describe("export_video_tool in the cloud", () => {
  it("starts a render job with the desktop's export arguments; get_render_status gives the file", async () => {
    const rendered: RenderInput[] = [];
    const renderer = fakeRenderer({ onRender: (input) => rendered.push(input) });
    const h = await harness({ engine: await loadEngineRegistry(), prober, assets: engineAssets, renderer });
    const client = await connect(h);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["export_video_tool", "list_export_presets_tool", "render_project", "get_render_status"]));
    expect(names).not.toContain("render_video");

    const projectId = (await call(client, "create_project", { name: "Launch teaser" })).structuredContent?.project_id as string;
    expect((await call(client, "add_title_tool", { text: "Hello cloud", duration_seconds: "4" })).isError).toBeFalsy();

    const started = await call(client, "export_video_tool", { preset: "YouTube", quality: "low", start: 1, end: 3, width: 1280, height: 720, file_name: "teaser" });
    expect(started.isError, textOf(started)).toBeFalsy();
    expect(textOf(started)).toMatch(
      /^Started rendering 2\.00s of video with 'YouTube' \(Low\), 1280x720 at 30\.0 fps as teaser\.mp4: render (r_[a-z0-9]{16}) is queued\. Call get_render_status with render_id "\1" for the download link/,
    );
    const receipt = (started.structuredContent?.data as { data: Record<string, unknown> }).data;
    expect(receipt).toMatchObject({ status: "queued", preset: "YouTube", quality: "Low", width: 1280, height: 720, start_frame: 31, end_frame: 90, path: "teaser.mp4" });
    await h.services.renders.drain();
    const status = await call(client, "get_render_status", { render_id: receipt.render_id, wait_seconds: 0 });
    expect(status.structuredContent).toMatchObject({ status: "done", format: "mp4", width: 1280, height: 720, project_id: projectId });
    expect(String(status.structuredContent?.url)).toContain("teaser.mp4");
    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.options).toMatchObject({ format: "mp4", videoCodec: "libx264", videoBitrate: 8_000_000, audioCodec: "aac", audioBitrate: 128_000, range: { start: 1, end: 3 } });
    expect(rendered[0]!.options.output).toBeUndefined();

    // The same request again is the same render (connectors retry slow calls).
    const again = await call(client, "export_video_tool", { preset: "YouTube", quality: "low", start: 1, end: 3, width: 1280, height: 720, file_name: "teaser" });
    expect((again.structuredContent?.data as { data: Record<string, unknown> }).data.render_id).toBe(receipt.render_id);
    // A title and no sound: both renders say what the finish still owes, with the calls.
    expect((receipt.finish as { kind: string }[]).map((g) => g.kind)).toEqual(["sound", "master"]);
    const whole = await call(client, "render_project", {});
    expect(textOf(whole)).toMatch(/Not finished: sound, master missing\. No sound design: .* Next: spot_sound_tool \{\}, then auto_sound_design_tool \{\}\./);

    const folder = await call(client, "export_video_tool", { folder: "renders" });
    expect(textOf(folder)).toBe("Error: this Zenvi surface has no folders (Zenvi Cloud answers with a download link); call it again without folder (file_name names the file)");
    const frames = await call(client, "export_video_tool", { export_type: "image_sequence" });
    expect(textOf(frames)).toBe(
      "Error: this Zenvi surface cannot write PNG image sequences; it can export MP4, MOV, MKV, WebM, GIF, MP3, WAV, FLAC and M4A. Pick one with container= or preset=",
    );
    const interlaced = await call(client, "export_video_tool", { interlaced: true });
    expect(textOf(interlaced)).toMatch(/cannot export interlaced video/);
    const selection = await call(client, "export_video_tool", { range: "selection" });
    expect(textOf(selection)).toMatch(/no timeline selection; give start\/end seconds instead/);

    const presets = await call(client, "list_export_presets_tool", { query: "mp3" });
    expect(presets.content[0]?.text).toBe("1 export preset(s).");
    expect(textOf(presets)).toContain('"title":"MP3 (audio only)"');
    await client.close();
  });
});

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

describe("the cloud ToolHost", () => {

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

  it("renders the timeline mix for master_audio_tool from local copies of the bin's media", async () => {
    const seen: string[] = [];
    const mixPcm: MixRenderer = async (current, options) => {
      for (const file of current.files) seen.push(await readFile(await options.resolveMedia(String(file.path)), "utf8"));
      return { sampleRate: 48000, channels: [new Float32Array(4), new Float32Array(4)] };
    };
    const analyzeAudio = async (): Promise<AudioEnvelope> => ({ sampleRate: 16000, frameSize: 480, rms: [] });
    const h = await harness({ prober, analyzeAudio, mixPcm });
    const { projectId, project } = await projectWithMedia(h, "voice.wav", Buffer.from("pcm bytes"), "audio/wav");
    const { host, dispose } = createCloudHost(context(h), projectId, () => project);
    expect((await host.audio!.mixPcm!(project, { clipIds: ["C1"] })).channels).toHaveLength(2);
    expect(seen).toEqual(["pcm bytes"]);
    await dispose();

    const without = await harness({ prober, analyzeAudio });
    const bare = await projectWithMedia(without, "voice.wav", Buffer.from("pcm bytes"), "audio/wav");
    const plain = createCloudHost(context(without), bare.projectId, () => bare.project);
    expect(plain.host.audio!.mixPcm).toBeUndefined();
    await plain.dispose();
  });

  it("tells which project files are not in Zenvi Cloud (missing media)", async () => {
    const h = await harness({ prober });
    const { projectId, project } = await projectWithMedia(h, "here.mp4", Buffer.from("here"), "video/mp4");
    const files = [
      ...project.files,
      { id: "F2", path: "/Users/me/never-uploaded.mp4", media_type: "video", cloud: { sha256: "c".repeat(64), size: 1, name: "never-uploaded.mp4" } },
      { id: "F3", path: "/Users/me/local-only.mov", media_type: "video" },
      { id: "F4", path: "@emojis/1F525.svg", media_type: "image" },
    ] as never[];
    const { host, dispose } = createCloudHost(context(h), projectId, () => project);
    expect(await host.media!.missing!(files)).toEqual([false, true, true, false]);
    await dispose();
  });

  it("saves frames and copies of media as download links, and lists the cloud projects as recent", async () => {
    const h = await harness({ prober });
    const { projectId, project } = await projectWithMedia(h, "shot.mp4", Buffer.from("shot bytes"), "video/mp4");
    const { host, dispose } = createCloudHost(context(h), projectId, () => project);
    expect(host.storage!.currentPath!()).toBe(projectId);

    const frame = await host.storage!.writeBytes!("/exports/Frame-00061.png", new Uint8Array([1, 2, 3]), "image/png");
    expect([...(await h.blobs.acceptSignedRead(frame))]).toEqual([1, 2, 3]);
    expect(new URL(frame).searchParams.get("rscd")).toBe('attachment; filename="Frame-00061.png"');
    await expect(host.storage!.writeBytes!("Frame-00061.png", new Uint8Array([4]), "image/png")).rejects.toMatchObject({ code: "EEXIST" });
    const again = await host.storage!.writeBytes!("Frame-00061.png", new Uint8Array([4]), "image/png", { overwrite: true });
    expect([...(await h.blobs.acceptSignedRead(again))]).toEqual([4]);

    const copy = await host.storage!.exportMedia!(project.files[0]!, "shot [0.00 - 2.00].mp4", "");
    expect(copy.existed).toBe(false);
    expect((await h.blobs.acceptSignedRead(copy.location)).toString()).toBe("shot bytes");
    expect(new URL(copy.location).searchParams.get("rscd")).toBe('attachment; filename="shot _0.00 - 2.00_.mp4"');
    await expect(host.storage!.exportMedia!({ id: "F3", path: "/Users/me/local-only.mov", media_type: "video" } as never, "x.mov", "")).rejects.toThrow("not uploaded to Zenvi Cloud");

    const other = await h.services.projects.create(USER_A, { name: "Later" });
    const recent = await host.storage!.recentProjects!();
    // Most recently edited first (list_projects' order); this harness's clock stands still.
    expect(recent.map((p) => [p.path, p.name, p.exists])).toEqual(
      expect.arrayContaining([
        [other.id, "Later", true],
        [projectId, "P", true],
      ]),
    );
    expect(recent).toHaveLength(2);
    expect(typeof recent[0]!.modifiedAt).toBe("number");
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
    // Discarded: this call no longer serves it, and the stored (shared, content-addressed) bytes stay.
    await host.media!.discardGenerated!([path]);
    await expect(host.media!.probe(path)).rejects.toThrow();
    expect(await h.services.media.get(USER_A, sha("<svg>hi</svg>"))).toMatchObject({ verified: true });
    await dispose();
  });
});

describe("speech recognition in the cloud", () => {
  const SECRET = "s".repeat(40);
  const ANSWER = {
    text: "Hi, um, welcome.",
    language: "english",
    model: "whisper-1",
    duration_seconds: 2,
    words: [
      { text: "Hi", startSec: 0.1, endSec: 0.4 },
      { text: "um", startSec: 0.5, endSec: 0.7 },
      { text: "welcome", startSec: 0.8, endSec: 1.3 },
    ],
    segments: [{ text: "Hi, um, welcome.", startSec: 0, endSec: 1.4 }],
  };

  /** A transcriber that sends the local copy's bytes as one piece (render-node extracts real speech audio). */
  const transcribeMedia: SpeechTranscriber = async (file, options) => {
    const bytes = new Uint8Array(await readFile(file));
    const answer = await options.upload({ bytes, fileName: "voice.mp3", contentType: "audio/mpeg", offset: 0 }, { language: options.language ?? "", prompt: options.prompt ?? "", signal: options.signal });
    return parseTranscription(answer);
  };

  async function speechHarness(status = 200) {
    const sent: { url: string; auth: string | null; form: FormData }[] = [];
    const h = await harness({ engine: await loadEngineRegistry(), prober, analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: [0.2] }), transcribeMedia, config: { backendAuth: { kind: "assertion", secret: SECRET } } });
    h.services.backendSessions.fetchImpl = async (url, init) => {
      sent.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), form: init?.body as FormData });
      return new Response(JSON.stringify(status === 200 ? ANSWER : { detail: "Not Found" }), { status, headers: { "content-type": "application/json" } });
    };
    const bytes = Buffer.from("speech bytes");
    const hash = sha(bytes);
    await h.services.media.storeBytes(USER_A, { sha256: hash, bytes, name: "talk.mp4", contentType: "video/mp4" });
    const created = await h.services.projects.create(USER_A, {
      name: "Talk",
      project: sampleProject({ files: [{ id: "F1", path: "/Users/me/talk.mp4", media_type: "video", has_audio: true, cloud: { sha256: hash, size: bytes.length, name: "talk.mp4" } }] }) as never,
    });
    return { h, sent, projectId: created.id };
  }

  it("sends project media to the backend as the connected person, once per media and language", async () => {
    const { h, sent, projectId } = await speechHarness();
    const { project } = await h.services.projects.get(USER_A, projectId);
    const first = createCloudHost(context(h), projectId, () => project);
    const t = await first.host.audio!.transcribe!("/Users/me/talk.mp4", { language: "", prompt: FILLER_PROMPT });
    expect(t.words.map((w) => w.text)).toEqual(["Hi,", "um,", "welcome."]);
    expect(t.language).toBe("en");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.zenvi.pro/api/v1/transcription");
    expect(sent[0]!.auth).toMatch(/^Bearer ey/);
    const file = sent[0]!.form.get("file") as File;
    expect(await file.text()).toBe("speech bytes");
    expect([file.name, file.type]).toEqual(["voice.mp3", "audio/mpeg"]);
    expect(sent[0]!.form.get("prompt")).toBe(FILLER_PROMPT);
    expect(sent[0]!.form.get("language")).toBeNull();
    await first.dispose();
    // A retried edit (a revision conflict) runs on a new host: the recent transcription is reused, not billed again.
    const retry = createCloudHost(context(h), projectId, () => project);
    await retry.host.audio!.transcribe!("/Users/me/talk.mp4", { language: "", prompt: FILLER_PROMPT });
    expect(sent).toHaveLength(1);
    await retry.host.audio!.transcribe!("/Users/me/talk.mp4", { language: "de", prompt: "" });
    expect(sent).toHaveLength(2);
    await retry.dispose();
  });

  it("keeps the words in the cloud project, so the next tool call reads them", async () => {
    const { h, sent, projectId } = await speechHarness();
    const client = await connect(h);
    const got = await call(client, "get_transcript_tool", { file_id: "F1", project_id: projectId });
    expect(got.isError).toBeFalsy();
    expect(got.content[0]?.text).toMatch(/^Transcribed 3 words \(server, en\)\. fileId=F1 /);
    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.files[0]?.ai_metadata).toMatchObject({ asr: { generation: 1, modelId: "whisper-1", words: [{ text: "Hi," }, { text: "um," }, { text: "welcome." }] } });
    expect(project.history?.undo ?? []).toEqual([]);
    const again = await call(client, "transcribe_media_tool", { file_id: "F1", project_id: projectId });
    expect(again.content[0]?.text).toMatch(/^Transcribed 3 words/);
    expect(sent).toHaveLength(1);
    await client.close();
  });

  it("says in words that the server has no speech recognition yet", async () => {
    const { h, projectId } = await speechHarness(404);
    const { project } = await h.services.projects.get(USER_A, projectId);
    const { host, dispose } = createCloudHost(context(h), projectId, () => project);
    const error = await host.audio!.transcribe!("/Users/me/talk.mp4").catch((e: unknown) => e);
    expect(isTranscriptionError(error) && error.code).toBe("unavailable");
    await dispose();
    const client = await connect(h);
    const refused = await call(client, "get_transcript_tool", { file_id: "F1", project_id: projectId });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe(
      "Error: get_transcript_tool is not available in this Zenvi surface: speech recognition is not available yet on this Zenvi server (it needs a newer Zenvi backend); the media has no indexed transcript either.",
    );
    await client.close();
  });

  it("has no speech recognition without the backend or ffmpeg", async () => {
    const h = await harness({ prober, analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: [] }), transcribeMedia });
    const { host } = createCloudHost(context(h), "c_x", () => sampleProject() as never);
    expect(host.audio?.transcribe).toBeUndefined();
  });
});

const HEADLINE: MotionBlockInfo = {
  id: "kinetic_headline",
  version: 1,
  title: "Kinetic headline",
  description: "A big headline that builds word by word.",
  tags: ["type"],
  params: [
    { name: "text", type: "string", description: "The headline.", default: "Hello" },
    { name: "background", type: "media", description: "Photo behind.", accept: ["image", "video"], optional: true },
  ],
  duration: { default: 3, min: 1.5, max: 10 },
  aspects: ["16:9"],
  alpha: true,
};

/** A motion host factory that "renders" a small file into the call's work folder, recording what it read. */
function fakeMotion(renders: { workDir: string; media: Record<string, string> }[]): MotionHostFactory {
  return ({ workDir, resolveMedia }) => ({
    blocks: () => [HEADLINE],
    check: (block, params) => (block === HEADLINE.id ? { ok: true, params: { text: "Hello", ...params } } : { ok: false, error: `unknown motion block ${block}` }),
    async render(request) {
      const media = Object.fromEntries(Object.entries(request.media).map(([name, path]) => [name, resolveMedia(path)]));
      renders.push({ workDir, media });
      const file = join(workDir, "kinetic_headline-0123456789abcdef.mov");
      await writeFile(file, `prores ${JSON.stringify(request.params)}`);
      return {
        media: { path: file, name: basename(file), info: await prober.probe(file) },
        codec: "prores4444",
        width: request.width,
        height: request.height,
        fps: request.fps,
        frames: 90,
        fingerprint: "0123456789abcdef",
        cached: false,
        renderSeconds: 1,
      };
    },
  });
}

describe("Zenvi Motion and subject mattes in the cloud", () => {
  it("lists the motion and matte capabilities only with a renderer and a prober", async () => {
    expect(cloudCapabilities((await harness({ prober })).services)).not.toContain("motion");
    expect(cloudCapabilities((await harness({ motion: fakeMotion([]) })).services)).not.toContain("motion");
    const caps = cloudCapabilities((await harness({ prober, motion: fakeMotion([]), mattes: () => ({ subjects: ["person"], generate: async () => Promise.reject(new Error("no")) }) })).services);
    expect(caps).toContain("motion");
    expect(caps).toContain("mattes");
  });

  it("renders a block from local copies in the call's scratch folder and keeps it as content-addressed media", async () => {
    const renders: { workDir: string; media: Record<string, string> }[] = [];
    const h = await harness({ prober, motion: fakeMotion(renders) });
    const photo = Buffer.from("photo bytes");
    await h.services.media.storeBytes(USER_A, { sha256: sha(photo), bytes: photo, name: "photo.png", contentType: "image/png" });
    const project = sampleProject({ files: [{ id: "F1", path: "/Users/me/photo.png", media_type: "image", cloud: { sha256: sha(photo), size: photo.length, name: "photo.png" } }] });
    const { host, dispose } = createCloudHost(context(h), "c_x", () => project as never);
    expect(host.motion!.blocks().map((b) => b.id)).toEqual(["kinetic_headline"]);
    const made = await host.motion!.render({
      block: "kinetic_headline",
      params: { text: "Hi", background: "F1" },
      media: { background: "/Users/me/photo.png" },
      width: 1280,
      height: 720,
      fps: { num: 30, den: 1 },
      seconds: 3,
      alpha: true,
      motionBlurSamples: 1,
      draft: false,
    });
    expect(renders).toHaveLength(1);
    expect(renders[0]!.workDir.startsWith(join(h.config.renderTmpDir, "zenvi-tool-"))).toBe(true);
    expect(await readFile(renders[0]!.media.background!, "utf8")).toBe("photo bytes");
    const bytes = `prores ${JSON.stringify({ text: "Hi", background: "F1" })}`;
    expect(made.media).toMatchObject({
      path: "@assets/links/zenvi-motion/kinetic_headline-0123456789abcdef.mov",
      info: { path: "@assets/links/zenvi-motion/kinetic_headline-0123456789abcdef.mov" },
      cloud: { sha256: sha(bytes), size: bytes.length, content_type: "video/quicktime" },
    });
    expect(await h.services.media.get(USER_A, sha(bytes))).toMatchObject({ verified: true, contentType: "video/quicktime" });
    // Later tools in the same call read it back like other generated media.
    expect(await host.media!.probe(made.media.path)).toMatchObject({ cloud: { sha256: sha(bytes) } });
    await dispose();
  });

  it("add_motion_block_tool places the cloud-kept render over MCP", async () => {
    const h = await harness({ engine: await loadEngineRegistry(), prober, motion: fakeMotion([]) });
    const client = await connect(h);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_motion_blocks_tool", "add_motion_block_tool", "update_motion_block_tool"]));
    expect(names).not.toContain("add_3d_scene_tool");
    expect(names).not.toContain("list_3d_scenes_tool");
    // Not listed, but a client that calls it anyway learns why.
    const scene = await call(client, "add_3d_scene_tool", { scene: "title_3d" });
    expect(scene.isError).toBe(true);
    expect(textOf(scene)).toBe(
      "Error: add_3d_scene_tool does not run on Zenvi Cloud: it needs Zenvi 3D (Blender on this computer). The zenvi CLI and its local MCP server (zenvi mcp) run it on a computer that has it.",
    );
    await expect(client.callTool({ name: "no_such_tool", arguments: {} })).rejects.toThrow(/Unknown tool: no_such_tool/);
    const projectId = (await call(client, "create_project", { name: "Promo" })).structuredContent?.project_id as string;
    const added = await call(client, "add_motion_block_tool", { block: "kinetic_headline", params: { text: "Ship it" } });
    expect(added.isError, textOf(added)).toBeFalsy();
    const { project } = await h.services.projects.get(USER_A, projectId);
    const file = project.files.find((f) => String(f.path).startsWith("@assets/links/zenvi-motion/"));
    expect(file?.cloud).toMatchObject({ content_type: "video/quicktime" });
    expect(project.clips.some((c) => c.file_id === file?.id)).toBe(true);
    await client.close();
  });

  it("mattes a short video and refuses a long one in words", async () => {
    let runs = 0;
    const mattes: MatteHostFactory = ({ workDir, resolveMedia }) => ({
      subjects: ["person"],
      async generate(path) {
        runs += 1;
        expect(await readFile(resolveMedia(path), "utf8")).toBe("clip");
        const file = join(workDir, "clip.person-matte.mp4");
        await writeFile(file, "matte");
        return { media: { path: file, name: basename(file), info: await prober.probe(file) }, model: "rvm", version: "1.0.0", license: "GPL-3.0", frames: 60, fps: 30 };
      },
    });
    const h = await harness({ prober, mattes });
    const { projectId, project } = await projectWithMedia(h, "clip.mp4", Buffer.from("clip"), "video/mp4");
    const { host, dispose } = createCloudHost(context(h), projectId, () => project);
    const made = await host.mattes!.generate("/Users/me/clip.mp4", { subject: "person", scale: 0.5 });
    expect(made.media).toMatchObject({ path: "@assets/mattes/clip.person-matte.mp4", cloud: { sha256: sha("matte"), content_type: "video/mp4" } });
    await dispose();

    const long: MediaProber = { available: true, probe: async (path) => ({ ...(await prober.probe(path)), video_length: 5400 }) };
    const hl = await harness({ prober: long, mattes });
    const other = await projectWithMedia(hl, "clip.mp4", Buffer.from("clip"), "video/mp4");
    const refusing = createCloudHost(context(hl), other.projectId, () => other.project);
    await expect(refusing.host.mattes!.generate("/Users/me/clip.mp4", { subject: "person", scale: 0.5 })).rejects.toThrow(/up to 300 frames per call and this one has 5400/);
    expect(runs).toBe(1);
    await refusing.dispose();
  });
});
