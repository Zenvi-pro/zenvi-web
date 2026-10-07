import { addFile, createProject, findProfile, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { CloudConflictError, DisabledCloudClient, type CloudClient } from "@/lib/cloud";
import { MemoryMediaStore } from "@/lib/storage/media";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { EditorSession } from "./EditorSession";
import { MediaLibrary } from "./media";

const reader: ReaderInfo = {
  type: "FFmpegReader",
  path: "media/x/clip.webm",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function linkedSession(cloud: CloudClient) {
  const project = createProject({ profile: findProfile("HD 1080p 30 fps")! });
  const meta = {
    id: "c_abc",
    name: "Trip",
    createdAt: 0,
    updatedAt: 0,
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
    duration: 0,
    clipCount: 0,
    fileCount: 0,
    cloud: { id: "c_abc", revision: "r1", syncedAt: 1 },
  };
  const media = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe: vi.fn(async () => reader), cloud: () => cloud });
  const repository = new MemoryProjectRepository();
  return new EditorSession({ meta, project, repository, media, cloud: () => cloud });
}

function fakeCloud(overrides: Partial<CloudClient>): CloudClient {
  return Object.assign(new DisabledCloudClient(), { enabled: true, checkMedia: async () => new Set<string>(), mediaUrl: async () => Promise.reject(new Error("nope")) }, overrides);
}

describe("cloud sync", () => {
  it("never runs two saves at once: a save asked for meanwhile runs after, with the new revision", async () => {
    const first = deferred<{ revision: string }>();
    const ifMatch: (string | null)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const saveProject = vi.fn(async (_id: string, _p: unknown, revision: string | null) => {
      ifMatch.push(revision);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const out = ifMatch.length === 1 ? await first.promise : { revision: `r${ifMatch.length + 1}` };
      inFlight -= 1;
      return out;
    });
    const session = linkedSession(fakeCloud({ saveProject }));
    const autosave = session.saveCloud();
    const syncNow = session.saveCloud();
    const third = session.saveCloud();
    first.resolve({ revision: "r2" });
    await Promise.all([autosave, syncNow, third]);
    expect(maxInFlight).toBe(1);
    // Three requests coalesce into two saves; the second names the revision the first got.
    expect(ifMatch).toEqual(["r1", "r2"]);
    expect(session.cloudSync.getState().state).toBe("synced");
    expect(session.meta.getState().cloud?.revision).toBe("r3");
  });

  it("is 'not fully synced' while media is neither in Zenvi Cloud nor in this browser, and lists the files", async () => {
    const session = linkedSession(fakeCloud({ saveProject: async () => ({ revision: "r2" }) }));
    session.edit("Add", (tx) => addFile(tx, { path: "/Volumes/Footage/beach.mp4", info: reader, name: "beach.mp4" }));
    await session.saveCloud();
    const status = session.cloudSync.getState();
    expect(status.state).toBe("partial");
    expect(status.missing.map((m) => m.name)).toEqual(["beach.mp4"]);
    expect(status.error).toMatch(/beach\.mp4 is not in Zenvi Cloud/);
  });

  it("stops syncing on a conflict, and 'keep mine' overwrites the cloud's current revision", async () => {
    const ifMatch: (string | null)[] = [];
    const saveProject = vi.fn(async (_id: string, _p: unknown, revision: string | null) => {
      ifMatch.push(revision);
      if (revision === "r1") throw new CloudConflictError("r9");
      return { revision: "r10" };
    });
    const session = linkedSession(fakeCloud({ saveProject }));
    await session.saveCloud();
    expect(session.cloudSync.getState()).toMatchObject({ state: "conflict", conflictRevision: "r9" });
    expect(session.ui.getState().dialog).toBe("cloudConflict");
    // Autosaves wait for the person's choice.
    await session.saveCloud();
    expect(ifMatch).toEqual(["r1"]);
    await session.keepMine();
    expect(ifMatch).toEqual(["r1", "r9"]);
    expect(session.cloudSync.getState().state).toBe("synced");
    expect(session.meta.getState().cloud?.revision).toBe("r10");
  });
});
