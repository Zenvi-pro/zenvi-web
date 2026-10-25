import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeRenderer } from "../testing/fakes.js";
import { harness, sampleProject, USER_A } from "../testing/helpers.js";
import type { RenderTicket } from "./dispatch.js";
import { resolveRenderOptions } from "./options.js";

const sha = (data: string): string => createHash("sha256").update(data).digest("hex");

describe("render jobs", () => {
  it("fail clearly while no renderer is available, but keep job records", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    const started = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { preset: "mp4" } });
    expect(started.status).toBe(202);
    expect(started.json).toMatchObject({ status: "queued", progress: 0, format: "mp4" });
    await h.services.renders.drain();
    const job = await h.request("GET", `/v1/projects/${id}/renders/${started.json.renderId}`, { token });
    expect(job.json).toMatchObject({ status: "error" });
    expect(job.json.error).toContain("renderer not available");
    expect((await h.request("GET", `/v1/projects/${id}/renders`, { token })).json.renders).toHaveLength(1);
  });

  it("render a snapshot of the requested revision with the project's media, and upload the result", async () => {
    const seen: { width: number; clips: number }[] = [];
    const renderer = fakeRenderer({ onRender: (input) => seen.push({ width: input.options.width, clips: input.project.clips.length }) });
    const h = await harness({ renderer });
    const token = await h.userToken(USER_A);
    const bytes = "clip bytes";
    const hash = sha(bytes);
    const ticket = await h.request("POST", "/v1/media", { token, json: { sha256: hash, size: bytes.length, name: "a.mp4", contentType: "video/mp4" } });
    await h.blobs.acceptSignedWrite(ticket.json.uploadUrl, bytes);
    await h.request("POST", `/v1/media/${hash}/complete`, { token });
    const project = sampleProject({
      files: [{ id: "F1", path: "a.mp4", media_type: "video", cloud: { sha256: hash, size: bytes.length, name: "a.mp4" } }],
      clips: [{ id: "C1", file_id: "F1", position: 0, start: 0, end: 2, layer: 1000000 }],
    });
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "My film", project } });
    const id = created.json.id as string;

    const started = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { preset: "mp4-720p", options: { quality: "low" } } });
    const renderId = started.json.renderId as string;
    // Editing after the request does not change what renders.
    await h.request("PUT", `/v1/projects/${id}`, { token, json: sampleProject({ width: 640, height: 360 }), headers: { "if-match": created.json.revision } });
    await h.services.renders.drain();

    const done = await h.request("GET", `/v1/projects/${id}/renders/${renderId}`, { token });
    expect(done.json).toMatchObject({ status: "done", progress: 1, bytes: expect.any(Number) });
    expect(done.json.options).toMatchObject({ format: "mp4", width: 1280, height: 720, quality: "low" });
    expect((await h.blobs.acceptSignedRead(done.json.url)).toString()).toBe("FAKE mp4 1280x720");
    expect(new URL(done.json.url).searchParams.get("rscd")).toBe('attachment; filename="My film.mp4"');
    expect(seen).toEqual([{ width: 1280, clips: 1 }]);
    expect(h.blobs.paths()).toContain(`u/${USER_A}/p/${id}/renders/${renderId}.mp4`);
  });

  it("return the existing job for the same revision and options", async () => {
    const h = await harness({ renderer: fakeRenderer() });
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    const a = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { preset: "webm" } });
    const b = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { preset: "webm" } });
    expect(b.json.renderId).toBe(a.json.renderId);
    await h.services.renders.drain();
    const c = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { preset: "webm" } });
    expect(c.json.renderId).toBe(a.json.renderId);
    const d = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { preset: "gif" } });
    expect(d.json.renderId).not.toBe(a.json.renderId);
  });

  it("do not render media known only by the desktop's partial fingerprint", async () => {
    const h = await harness({ renderer: fakeRenderer() });
    const token = await h.userToken(USER_A);
    const bytes = "real bytes";
    const hash = sha(bytes);
    const ticket = await h.request("POST", "/v1/media", { token, json: { sha256: hash, size: bytes.length, name: "a.mp4", contentType: "video/mp4" } });
    await h.blobs.acceptSignedWrite(ticket.json.uploadUrl, bytes);
    await h.request("POST", `/v1/media/${hash}/complete`, { token });
    const project = sampleProject({
      files: [{ id: "F1", path: "/Users/me/a.mp4", media_type: "video", fingerprint: { sha256: hash, size: bytes.length } }],
      clips: [{ id: "C1", file_id: "F1", position: 0, start: 0, end: 2, layer: 1000000 }],
    });
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P", project } })).json.id;
    const started = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} });
    await h.services.renders.drain();
    const job = await h.request("GET", `/v1/projects/${id}/renders/${started.json.renderId}`, { token });
    expect(job.json.status).toBe("error");
    expect(job.json.error).toContain('"a.mp4" is not in Zenvi Cloud');
  });

  it("return one job to concurrent identical requests, and a new one after a failure", async () => {
    const renderer = fakeRenderer();
    const h = await harness({ renderer });
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id as string;
    const jobs = await Promise.all([1, 2, 3, 4].map(() => h.services.renders.start(USER_A, id, { preset: "mp4" })));
    expect(new Set(jobs.map((j) => j.renderId)).size).toBe(1);
    await h.services.renders.drain();
    expect(renderer.renders).toBe(1);
    expect((await h.request("GET", `/v1/projects/${id}/renders`, { token })).json.renders).toHaveLength(1);

    const failing = await harness({ renderer: fakeRenderer({ fail: "encoder crashed" }) });
    const t2 = await failing.userToken(USER_A);
    const p2 = (await failing.request("POST", "/v1/projects", { token: t2, json: { name: "P" } })).json.id as string;
    const first = await failing.services.renders.start(USER_A, p2, {});
    await failing.services.renders.drain();
    expect((await failing.services.renders.getById(USER_A, first.renderId)).status).toBe("error");
    const retry = await failing.services.renders.start(USER_A, p2, {});
    expect(retry.renderId).not.toBe(first.renderId);
  });

  it("explain which media is missing from the cloud", async () => {
    const h = await harness({ renderer: fakeRenderer() });
    const token = await h.userToken(USER_A);
    const project = sampleProject({
      files: [{ id: "F1", path: "/Users/me/big.mov", media_type: "video" }],
      clips: [{ id: "C1", file_id: "F1", position: 0, start: 0, end: 2, layer: 1000000 }],
    });
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P", project } })).json.id;
    const started = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} });
    await h.services.renders.drain();
    const job = await h.request("GET", `/v1/projects/${id}/renders/${started.json.renderId}`, { token });
    expect(job.json.status).toBe("error");
    expect(job.json.error).toContain('"big.mov" is not in Zenvi Cloud');
  });

  it("re-queue jobs whose worker died, but leave live ones alone", async () => {
    const renderer = fakeRenderer();
    const h = await harness({ renderer });
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    const started = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} });
    await h.services.renders.drain();
    expect(renderer.renders).toBe(1);
    // Pretend a worker (another instance during a deploy) is mid-render: fresh heartbeat.
    await h.tables.update("renders", { partitionKey: USER_A, rowKey: started.json.renderId, status: "running", attempts: 1, heartbeatAt: new Date(h.clock.now()).toISOString() });
    expect(await h.services.renders.recover()).toBe(0);
    // Its heartbeat stops: the job is picked up again and finishes.
    h.clock.advance(120_000);
    expect(await h.services.renders.recover()).toBe(1);
    await h.services.renders.drain();
    const job = await h.request("GET", `/v1/projects/${id}/renders/${started.json.renderId}`, { token });
    expect(job.json.status).toBe("done");
    expect(renderer.renders).toBe(2);
  });

  it("claim each queued job once even when two workers see it", async () => {
    const renderer = fakeRenderer();
    const h = await harness({ renderer });
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} });
    // A second service over the same tables (the other instance) recovers the queued job too.
    const { createServices } = await import("../container.js");
    const other = createServices({ ...h.services, assets: undefined, analyzeAudio: undefined, decodePcm: undefined, transcribeMedia: undefined, supabase: { verify: async () => null }, renderer });
    await other.renders.recover();
    await Promise.all([h.services.renders.drain(), other.renders.drain()]);
    expect(renderer.renders).toBe(1);
  });

  it("hand new jobs to render workers, and render here only what none claims in time", async () => {
    const renderer = fakeRenderer();
    const tickets: RenderTicket[] = [];
    const h = await harness({ renderer, renderDispatch: async (ticket) => void tickets.push(ticket) });
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    const started = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} });
    await h.services.renders.drain();
    expect(tickets).toEqual([{ userId: USER_A, renderId: started.json.renderId }]);
    expect(renderer.renders).toBe(0);
    // Fresh: the workers' job.
    expect(await h.services.renders.recover()).toBe(0);
    // No worker claimed it in five minutes: this process renders it.
    h.clock.advance(6 * 60_000);
    expect(await h.services.renders.recover()).toBe(1);
    await h.services.renders.drain();
    expect(renderer.renders).toBe(1);
    expect((await h.request("GET", `/v1/projects/${id}/renders/${started.json.renderId}`, { token })).json.status).toBe("done");
  });

  it("render here when the hand-off to a worker fails", async () => {
    const renderer = fakeRenderer();
    const h = await harness({ renderer, renderDispatch: async () => Promise.reject(new Error("queue unavailable")) });
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    const started = await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} });
    await h.services.renders.drain();
    expect(renderer.renders).toBe(1);
    expect((await h.request("GET", `/v1/projects/${id}/renders/${started.json.renderId}`, { token })).json.status).toBe("done");
  });

  it("let a worker render the job it was handed once, and hand a dead worker's job to the workers again", async () => {
    const renderer = fakeRenderer();
    const tickets: RenderTicket[] = [];
    const h = await harness({ renderer, renderDispatch: async (ticket) => void tickets.push(ticket) });
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    const first = (await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} })).json.renderId as string;
    // A worker: its own render service over the same stores, as render-job.ts builds it.
    const { createServices } = await import("../container.js");
    const worker = createServices({ ...h.services, assets: undefined, analyzeAudio: undefined, decodePcm: undefined, transcribeMedia: undefined, supabase: { verify: async () => null }, renderer });
    await worker.renders.runOne(USER_A, first);
    expect(renderer.renders).toBe(1);
    expect((await h.request("GET", `/v1/projects/${id}/renders/${first}`, { token })).json.status).toBe("done");
    // The same message twice renders nothing more.
    await worker.renders.runOne(USER_A, first);
    expect(renderer.renders).toBe(1);

    // A worker claims the next job and dies: its heartbeat stops, and the job goes back to the workers.
    await h.request("PUT", `/v1/projects/${id}`, { token, json: sampleProject({ width: 640, height: 360 }), headers: { "if-match": "*" } });
    const second = (await h.request("POST", `/v1/projects/${id}/renders`, { token, json: {} })).json.renderId as string;
    await h.tables.update("renders", { partitionKey: USER_A, rowKey: second, status: "running", attempts: 1, heartbeatAt: new Date(h.clock.now()).toISOString() });
    h.clock.advance(120_000);
    expect(await h.services.renders.recover()).toBe(1);
    await h.services.renders.drain();
    expect(tickets.map((t) => t.renderId)).toEqual([first, second, second]);
    expect(renderer.renders).toBe(1);
  });

  it("validate options", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const id = (await h.request("POST", "/v1/projects", { token, json: { name: "P" } })).json.id;
    expect((await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { preset: "mp5" } })).status).toBe(400);
    expect((await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { options: { width: 99999 } } })).status).toBe(400);
    expect((await h.request("POST", `/v1/projects/${id}/renders`, { token, json: { options: { output: "/etc/passwd" } } })).status).toBe(400);
  });
});

describe("render options", () => {
  const project = sampleProject({ width: 1920, height: 1080, fps: { num: 30000, den: 1001 } }) as never;

  it("fill size and rate from the project and keep the aspect ratio", () => {
    expect(resolveRenderOptions(project, undefined)).toEqual({ format: "mp4", width: 1920, height: 1080, fps: { num: 30000, den: 1001 }, quality: "high" });
    expect(resolveRenderOptions(project, "mp4-720p")).toMatchObject({ width: 1280, height: 720, quality: "medium" });
    expect(resolveRenderOptions(project, "mp4", { width: 853 })).toMatchObject({ width: 854, height: 480 });
    expect(resolveRenderOptions(project, "mp3")).toMatchObject({ format: "mp3" });
    expect(resolveRenderOptions(project, "gif")).toMatchObject({ format: "gif", width: 640, height: 360 });
  });
});
