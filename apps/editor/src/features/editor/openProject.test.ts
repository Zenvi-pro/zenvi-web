// @vitest-environment node
import { addClip, addFile, createProject, findProfile, parseProject, ProjectDocument, type Project, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { cloudRouteId, DisabledCloudClient, parseCloudRouteId, type CloudClient, type CloudProjectDocument } from "@/lib/cloud";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { currentStampForWebCopies, openCloud, openLocal } from "./openProject";

const info: ReaderInfo = {
  type: "FFmpegReader",
  path: "x",
  has_video: true,
  has_audio: true,
  has_single_image: false,
  duration: 4,
  width: 640,
  height: 360,
  fps: { num: 30, den: 1 },
  video_length: 120,
  pixel_ratio: { num: 1, den: 1 },
  display_ratio: { num: 16, den: 9 },
  sample_rate: 48000,
  channels: 2,
  channel_layout: 3,
};

/** A project with one clip, stamped the way the given writer stamps it. */
function projectWithClip(version: Record<string, string>): Project {
  const doc = new ProjectDocument(createProject({ profile: findProfile("HD 1080p 30 fps")! }));
  doc.transaction("clip", (tx) => {
    const file = addFile(tx, { path: "media/a/clip.webm", info, name: "clip.webm" });
    addClip(tx, { fileId: file.id, position: 0, layer: doc.project.layers[0]!.number });
  });
  return { ...(doc.toJSON() as Project), version };
}

function alphaOf(project: Project): number | undefined {
  return project.clips[0]?.alpha.Points[0]?.co.Y;
}

function fakeCloud(remote: Omit<CloudProjectDocument, "id">) {
  const getProject = vi.fn(async (id: string): Promise<CloudProjectDocument> => ({ id, ...structuredClone(remote) }));
  const cloud: CloudClient = Object.assign(new DisabledCloudClient(), { enabled: true, getProject });
  return { cloud, getProject };
}

const current = { "openshot-qt": "1.0.188", libopenshot: "1.0.0" };

describe("opening /editor/p/:id", () => {
  it("opens cloud project c_rcoyyeo9vq4uv1kp from the route /editor/p/c_rcoyyeo9vq4uv1kp", async () => {
    const routeId = "c_rcoyyeo9vq4uv1kp";
    const cloudId = parseCloudRouteId(routeId);
    expect(cloudId).toBe("c_rcoyyeo9vq4uv1kp");
    expect(cloudRouteId(cloudId!)).toBe(routeId);

    const repo = new MemoryProjectRepository();
    const { cloud, getProject } = fakeCloud({ name: "Beach day", revision: "r1", project: projectWithClip(current), media: [] });
    const opened = await openCloud(repo, cloud, cloudId!, 1000);

    expect(getProject).toHaveBeenCalledTimes(1);
    expect(getProject).toHaveBeenCalledWith("c_rcoyyeo9vq4uv1kp");
    expect(opened.meta).toMatchObject({ id: "c_rcoyyeo9vq4uv1kp", name: "Beach day", source: "cloud", cloud: { id: "c_rcoyyeo9vq4uv1kp", revision: "r1", syncedAt: 1000 } });
    // Cached under the same id, so reloading the route offline still opens it.
    expect((await repo.load("c_rcoyyeo9vq4uv1kp"))?.meta.cloud?.id).toBe("c_rcoyyeo9vq4uv1kp");
  });

  it("keeps local ids (no c_ prefix) local", async () => {
    expect(parseCloudRouteId("p8f3k2")).toBeNull();
    const repo = new MemoryProjectRepository();
    expect(await openLocal(repo, "p8f3k2")).toBeNull();
  });

  it("prefers the cloud copy unless the cache has unsynced edits on the same revision", async () => {
    const repo = new MemoryProjectRepository();
    const local = projectWithClip(current);
    const remote = { ...projectWithClip(current), clips: [] };
    await repo.save(
      { id: "c_x", name: "Mine", createdAt: 1, updatedAt: 50, source: "cloud", cloud: { id: "c_x", revision: "r1", syncedAt: 10 }, width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration: 4, clipCount: 1, fileCount: 1 },
      local,
    );
    const same = await openCloud(repo, fakeCloud({ name: "Mine", revision: "r1", project: remote, media: [] }).cloud, "c_x", 100);
    expect(same.project.clips).toHaveLength(1);
    expect(same.meta.cloud?.syncedAt).toBe(10);

    const moved = await openCloud(repo, fakeCloud({ name: "Mine", revision: "r2", project: remote, media: [] }).cloud, "c_x", 200);
    expect(moved.project.clips).toHaveLength(0);
    expect(moved.meta.cloud).toEqual({ id: "c_x", revision: "r2", syncedAt: 200 });
  });

  it("passes the signed media URLs the cloud sent along", async () => {
    const media = [{ fileId: "F1", sha256: "a".repeat(64), url: "https://blob.example/a?sig=1" }];
    const opened = await openCloud(new MemoryProjectRepository(), fakeCloud({ name: "M", revision: "r1", project: projectWithClip(current), media }).cloud, "c_m");
    expect(opened.cloudMedia).toEqual(media);
  });
});

describe("cloud copies go through the desktop load rules", () => {
  it("runs parseProject: an OpenShot 3.x stamp is replaced by the current one", async () => {
    const opened = await openCloud(
      new MemoryProjectRepository(),
      fakeCloud({ name: "Old", revision: "r1", project: projectWithClip({ "openshot-qt": "3.3.0", libopenshot: "0.4.0" }), media: [] }).cloud,
      "c_old",
    );
    expect(opened.project.version).toMatchObject(current);
    expect(alphaOf(opened.project)).toBe(1);
  });

  it("does not invert alpha on copies an earlier web build saved with the template's 0.0.0 stamp", async () => {
    const webCopy = projectWithClip({ "openshot-qt": "0.0.0", libopenshot: "0.0.0" });
    // What the desktop load rules alone would do to it: every clip invisible.
    expect(alphaOf(parseProject(webCopy))).toBe(0);
    expect(currentStampForWebCopies(webCopy).version).toMatchObject(current);
    const opened = await openCloud(new MemoryProjectRepository(), fakeCloud({ name: "Web", revision: "r1", project: webCopy, media: [] }).cloud, "c_web");
    expect(alphaOf(opened.project)).toBe(1);
    expect(opened.project.version).toMatchObject(current);
  });
});
