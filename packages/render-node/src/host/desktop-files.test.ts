/**
 * The CLI's share of Zenvi desktop's folder (recent projects, recovery
 * copies, custom profiles), the zip reader for recovery copies, and the
 * files the CLI writes for the project-export tools (frames, copies of
 * media, collect / reclaim). Each test works in its own temp folder.
 */

import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { createProject, serializeProject, type ProjectFile } from "@zenvi/engine";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import {
  customProfileFiles,
  desktopRecentProjects,
  recoveryCopiesFor,
  removeCustomProfileFile,
  restoreRecoveryCopy,
  writeCustomProfileFile,
} from "./desktop-files.js";
import { collectMedia, exportMediaFile, reclaimableMedia, removeMediaCopies, writeBytesFile } from "./files-out.js";
import { createNodeHost } from "./node-host.js";
import { readZipEntries, ZipError } from "./zip.js";

const dirs: string[] = [];
async function temp(): Promise<string> {
  const dir = await makeTempDir("zenvi-desktop-files-");
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeDir(dir);
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip like Python's zipfile writes (deflated unless `stored`). */
function zip(entries: Record<string, string>, stored = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    const body = stored ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("readZipEntries", () => {
  it("reads deflated and stored entries; refuses what is not a zip", () => {
    const entries = readZipEntries(zip({ "trip.zvn": '{"a": 1}', "b.txt": "bee" }));
    expect(entries.map((e) => [e.name, e.data().toString()])).toEqual([
      ["trip.zvn", '{"a": 1}'],
      ["b.txt", "bee"],
    ]);
    expect(readZipEntries(zip({ "x.zvn": "stored" }, true))[0]!.data().toString()).toBe("stored");
    expect(readZipEntries(zip({}))).toEqual([]);
    expect(() => readZipEntries(Buffer.from("not a zip at all, sorry"))).toThrow(ZipError);
  });
});

describe("Zenvi desktop's folder", () => {
  it("lists File > Recent Projects most recent first, with whether each still exists", async () => {
    const dir = await temp();
    const kept = path.join(dir, "films", "kept.zvn");
    await mkdir(path.dirname(kept), { recursive: true });
    await writeFile(kept, "{}");
    await utimes(kept, new Date(1_790_000_000_000), new Date(1_790_000_000_000));
    const gone = path.join(dir, "films", "gone.zvn");
    const desktop = path.join(dir, "desktop");
    await mkdir(desktop);
    await writeFile(path.join(desktop, "openshot.settings"), JSON.stringify([{ setting: "volume", value: 3 }, { setting: "recent_projects", value: [gone, kept] }]));
    expect(await desktopRecentProjects(desktop)).toEqual([
      { path: kept, name: "kept", exists: true, modifiedAt: 1_790_000_000 },
      { path: gone, name: "gone", exists: false, modifiedAt: null },
    ]);
    expect(await desktopRecentProjects(path.join(dir, "no-desktop"))).toEqual([]);
  });

  it("lists a project's recovery copies by its exact name, newest first, and restores one with a backup", async () => {
    const dir = await temp();
    const desktop = path.join(dir, "desktop");
    const recovery = path.join(desktop, "recovery");
    await mkdir(recovery, { recursive: true });
    const project = path.join(dir, "trip.zvn");
    await writeFile(project, "current");
    const newest = serializeProject({ ...createProject(), profile: "HD 720p 30 fps" });
    await writeFile(path.join(recovery, "1700000600-trip.zip"), zip({ "trip.zvn": newest }));
    await writeFile(path.join(recovery, "1700000000-trip.zip"), zip({ "trip.zvn": "old" }));
    await writeFile(path.join(recovery, "1700000900-trip-2.zip"), zip({ "trip-2.zvn": "other project" }));
    await writeFile(path.join(recovery, "1700000300-trip.zip"), zip({})); // an empty copy is not restorable
    await writeFile(path.join(recovery, "1700000400-trip.zvn"), ""); // nor an empty project file
    await writeFile(path.join(recovery, "notes.txt"), "x");
    const copies = await recoveryCopiesFor(desktop, project);
    expect(copies.map((c) => [path.basename(c.path), c.savedAt])).toEqual([
      ["1700000600-trip.zip", 1700000600],
      ["1700000000-trip.zip", 1700000000],
    ]);
    expect(copies[0]!.sizeBytes).toBeGreaterThan(0);

    const backup = await restoreRecoveryCopy(desktop, project, copies[0]!.path);
    expect(path.basename(backup!)).toMatch(/^trip-\d+-backup\.zvn$/);
    expect(await readFile(backup!, "utf8")).toBe("current");
    expect(await readFile(project, "utf8")).toBe(newest);
    await expect(restoreRecoveryCopy(desktop, project, path.join(dir, "trip.zvn"))).rejects.toThrow("not one of Zenvi desktop's recovery copies");
    await writeFile(path.join(recovery, "1700000700-trip.zip"), "broken");
    await expect(restoreRecoveryCopy(desktop, project, path.join(recovery, "1700000700-trip.zip"))).rejects.toThrow("not a readable zip");
    expect(await readFile(project, "utf8")).toBe(newest);
  });

  it("keeps custom profiles in the desktop's profiles folder", async () => {
    const desktop = path.join(await temp(), "desktop");
    expect(await customProfileFiles(desktop)).toEqual([]);
    const file = await writeCustomProfileFile(desktop, "01000x1000p0030_01-01", "description=Custom 1000x1000 30 fps\n");
    expect(file).toBe(path.join(desktop, "profiles", "01000x1000p0030_01-01"));
    expect(await customProfileFiles(desktop)).toEqual([{ name: "01000x1000p0030_01-01", text: "description=Custom 1000x1000 30 fps\n", path: file }]);
    await expect(writeCustomProfileFile(desktop, "../escape", "x")).rejects.toThrow("not a profile file name");
    await removeCustomProfileFile(desktop, "01000x1000p0030_01-01");
    expect(await customProfileFiles(desktop)).toEqual([]);
  });

  it("is what the CLI host offers when it knows the desktop's folder", async () => {
    const dir = await temp();
    const without = createNodeHost({ projectFile: path.join(dir, "a.zvn") });
    expect([without.storage!.recentProjects, without.storage!.recoveryCopies, without.storage!.customProfiles]).toEqual([undefined, undefined, undefined]);
    expect(without.storage!.currentPath!()).toBe(path.join(dir, "a.zvn"));
    const host = createNodeHost({ projectFile: path.join(dir, "a.zvn"), desktopDir: path.join(dir, "desktop") });
    expect(await host.storage!.recentProjects!()).toEqual([]);
    expect(await host.storage!.recoveryCopies!()).toEqual([]);
    expect(await host.exporter!.supports!("mp4", "libx264", "")).toBe(true);
    expect(await host.exporter!.supports!("mp4", "no_such_encoder", "")).toBe(false);
  });
});

describe("files the CLI writes", () => {
  it("writes frames, refusing to overwrite unless asked", async () => {
    const dir = await temp();
    const file = path.join(dir, "out", "Frame-00061.png");
    expect(await writeBytesFile(file, new Uint8Array([1, 2, 3]))).toBe(file);
    await expect(writeBytesFile(file, new Uint8Array([4]))).rejects.toMatchObject({ code: "EEXIST", path: file });
    await writeBytesFile(file, new Uint8Array([4]), true);
    expect([...(await readFile(file))]).toEqual([4]);
  });

  it("copies media into a folder once; a render goes through a staged file", async () => {
    const dir = await temp();
    const source = path.join(dir, "shot.mp4");
    await writeFile(source, "video");
    const folder = path.join(dir, "handoff");
    const first = await exportMediaFile({ source, folder, name: "shot [0.00 - 1.00].mp4", resolveMedia: (p) => p });
    expect(first).toEqual({ location: path.join(folder, "shot [0.00 - 1.00].mp4"), folder, existed: false });
    expect(await readFile(first.location, "utf8")).toBe("video");
    expect((await exportMediaFile({ source, folder, name: "shot [0.00 - 1.00].mp4", resolveMedia: (p) => p })).existed).toBe(true);
    await expect(exportMediaFile({ source: path.join(dir, "gone.mp4"), folder, name: "gone.mp4", resolveMedia: (p) => p })).rejects.toThrow("file not found");
  });

  it("collects outside media into the assets folder and reclaims identical copies", async () => {
    const dir = await temp();
    const projectFile = path.join(dir, "proj", "film.zvn");
    await mkdir(path.dirname(projectFile), { recursive: true });
    const outside = path.join(dir, "outside", "shot.mp4");
    await mkdir(path.dirname(outside), { recursive: true });
    await writeFile(outside, "video-bytes");
    const opts = { projectFile, resolveMedia: (p: string) => p };
    const collected = await collectMedia(
      [
        { id: "F1", path: outside },
        { id: "F2", path: path.join(dir, "missing.mp4") },
        { id: "F3", path: path.join(dir, "seq", "frame_%04d.png") },
      ],
      opts,
    );
    const copy = path.join(dir, "proj", "film_assets", "media", "shot.mp4");
    expect(collected).toEqual({ copied: [copy], skipped: [path.join(dir, "missing.mp4"), path.join(dir, "seq", "frame_%04d.png")], errors: [], moves: [{ fileId: "F1", from: outside, to: copy }] });
    // Collecting again (an undo moved the file back) keeps the first copy and makes a new one by file id.
    expect((await collectMedia([{ id: "F1", path: outside }], opts)).copied).toEqual([path.join(dir, "proj", "film_assets", "media", "shot_F1.mp4")]);
    expect((await collectMedia([{ id: "F1", path: copy }], opts)).skipped).toEqual([copy]);

    const found = await reclaimableMedia([{ id: "F1", path: copy, original: outside }], opts);
    expect(found).toEqual({ moves: [{ fileId: "F1", from: copy, to: outside }], kept: [], errors: [] });
    await writeFile(outside, "changed!!!!");
    expect((await reclaimableMedia([{ id: "F1", path: copy, original: outside }], opts)).kept).toEqual([copy]);
    expect(await removeMediaCopies([copy, outside], opts)).toEqual({ removed: [copy], errors: [`${outside}: not in the project's assets folder`] });
    await expect(stat(copy)).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("changed!!!!");
  });

  it("is the CLI host's media.collect for the open project", async () => {
    const dir = await temp();
    const projectFile = path.join(dir, "p.zvn");
    const host = createNodeHost({ projectFile });
    const outside = path.join(dir, "o.mp4");
    await writeFile(outside, "x");
    const result = await host.media!.collect!([{ id: "A", path: outside }]);
    expect(result.copied).toEqual([path.join(dir, "p_assets", "media", "o.mp4")]);
    const file = { id: "A", path: outside } as ProjectFile;
    const exported = await host.storage!.exportMedia!(file, "o [0.00 - 1.00].mp4", "");
    expect(exported).toEqual({ location: path.join(dir, "o [0.00 - 1.00].mp4"), folder: dir, existed: false });
    expect(await host.storage!.writeBytes!("frames/f.png", new Uint8Array([1]), "image/png")).toBe(path.join(dir, "frames", "f.png"));
  });
});
