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

describe("adoptRemote (edits made elsewhere, e.g. the chat's tools)", () => {
  function remoteWith(session: EditorSession, mutate: (project: Record<string, unknown>) => void, revision = "r2") {
    const project = structuredClone(session.project) as unknown as Record<string, unknown>;
    mutate(project);
    return { revision, project: project as unknown as typeof session.project };
  }

  it("takes the cloud's newer revision as one undo step and does not send it back", async () => {
    const saveProject = vi.fn(async (_id: string, _project: unknown, _revision: string | null) => ({ revision: "r3" }));
    const session = linkedSession(fakeCloud({ saveProject }));
    const remote = remoteWith(session, (p) => {
      p.markers = [{ id: "M1", position: 2, icon: "blue.png", vector: "blue" }];
    });
    expect(session.adoptRemote(remote)).toBe(true);
    expect(session.project.markers).toHaveLength(1);
    expect(session.doc.undoLabels.at(-1)).toBe("Changes from the chat");
    expect(session.meta.getState().cloud?.revision).toBe("r2");
    await session.autosave.flush();
    await session.saveCloud();
    expect(saveProject).not.toHaveBeenCalled();
    expect(session.cloudSync.getState().state).toBe("synced");

    // Undoing it is a real edit: it goes to the cloud, against the adopted revision.
    session.undo();
    await session.saveCloud();
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject.mock.calls[0]?.[2]).toBe("r2");
    expect(session.project.markers).toHaveLength(0);
  });

  it("refuses while this copy has edits the cloud does not have", () => {
    const session = linkedSession(fakeCloud({ saveProject: async () => ({ revision: "r9" }) }));
    session.edit("Add", (tx) => addFile(tx, { path: "media/x/clip.webm", info: reader, name: "clip.webm" }));
    const remote = remoteWith(session, (p) => {
      p.markers = [{ id: "M1", position: 2, icon: "blue.png", vector: "blue" }];
    });
    expect(session.adoptRemote(remote)).toBe(false);
    expect(session.project.markers).toHaveLength(0);
    expect(session.meta.getState().cloud?.revision).toBe("r1");
  });

  it("only moves the revision when nothing but view state changed", () => {
    const session = linkedSession(fakeCloud({}));
    const remote = remoteWith(session, (p) => {
      p.playhead_position = 7;
    });
    expect(session.adoptRemote(remote)).toBe(true);
    expect(session.doc.canUndo).toBe(false);
    expect(session.meta.getState().cloud?.revision).toBe("r2");
    expect(session.adoptRemote(remote)).toBe(false);
  });
});
