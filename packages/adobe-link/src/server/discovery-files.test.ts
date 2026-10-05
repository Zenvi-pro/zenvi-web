import fs, { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { discoveryModule } from "../testing/link-server.js";

const { DiscoveryFile, DISCOVERY_KEYS } = discoveryModule;

function dir(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "zenvi-link-discovery-")), ".openshot_qt", "link");
}

const details = { url: "http://127.0.0.1:53012/mcp", token: "ab".repeat(32), project: "/Users/me/promo.aep", version: "1.0.0", appName: "Adobe After Effects 2026", appVersion: "26.3.0" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiscoveryFile", () => {
  test("writes the token (0600) before the discovery file, atomically, with exactly the SPEC keys", () => {
    const linkDir = dir();
    const renames: string[] = [];
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames.push(path.basename(String(to)));
      rename(from, to);
    });
    const file = new DiscoveryFile({ host: "aftereffects", dir: linkDir, now: () => new Date("2026-10-04T21:00:00.000Z") });
    file.publish(details);
    expect(renames).toEqual(["aftereffects.token", "aftereffects.json"]);
    expect(readdirSync(linkDir).sort()).toEqual(["aftereffects.json", "aftereffects.token"]);
    expect(readFileSync(file.tokenFile, "utf8")).toBe(details.token);
    if (process.platform !== "win32") {
      expect(statSync(file.tokenFile).mode & 0o777).toBe(0o600);
      expect(statSync(linkDir).mode & 0o777).toBe(0o700);
    }
    const json = JSON.parse(readFileSync(file.file, "utf8"));
    expect(Object.keys(json)).toEqual(DISCOVERY_KEYS);
    expect(json).toEqual({
      url: details.url,
      token_file: file.tokenFile,
      pid: process.pid,
      project: "/Users/me/promo.aep",
      version: "1.0.0",
      app: "aftereffects",
      app_name: "Adobe After Effects 2026",
      app_version: "26.3.0",
      protocol: 1,
      started_at: "2026-10-04T21:00:00.000Z",
      last_active_at: "2026-10-04T21:00:00.000Z",
    });
  });

  test("project changes are written; unchanged projects are not", () => {
    const file = new DiscoveryFile({ host: "premiere", dir: dir() });
    file.publish({ ...details, project: null });
    expect(JSON.parse(readFileSync(file.file, "utf8")).project).toBeNull();
    expect(file.setProject("/Users/me/trip.prproj")).toBe(true);
    expect(file.setProject("/Users/me/trip.prproj")).toBe(false);
    expect(JSON.parse(readFileSync(file.file, "utf8")).project).toBe("/Users/me/trip.prproj");
  });

  test("touch refreshes last_active_at, at most one write per interval", async () => {
    let clock = Date.parse("2026-10-04T21:00:00.000Z");
    const file = new DiscoveryFile({ host: "aftereffects", dir: dir(), minIntervalMs: 40, now: () => new Date(clock) });
    file.publish(details);
    const read = () => JSON.parse(readFileSync(file.file, "utf8")).last_active_at;
    clock += 5000;
    file.touch();
    expect(read()).toBe("2026-10-04T21:00:00.000Z");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(read()).toBe("2026-10-04T21:00:05.000Z");
    await new Promise((resolve) => setTimeout(resolve, 50));
    clock += 1000;
    file.touch();
    expect(read()).toBe("2026-10-04T21:00:06.000Z");
  });

  test("remove deletes both files only while they name this process", () => {
    const linkDir = dir();
    const mine = new DiscoveryFile({ host: "aftereffects", dir: linkDir });
    mine.publish(details);
    expect(mine.remove()).toBe(true);
    expect(readdirSync(linkDir)).toEqual([]);

    const older = new DiscoveryFile({ host: "aftereffects", dir: linkDir, pid: 111 });
    older.publish(details);
    const newer = new DiscoveryFile({ host: "aftereffects", dir: linkDir, pid: 222 });
    newer.publish({ ...details, token: "cd".repeat(32) });
    expect(older.remove()).toBe(false);
    expect(JSON.parse(readFileSync(newer.file, "utf8")).pid).toBe(222);
    expect(readFileSync(newer.tokenFile, "utf8")).toBe("cd".repeat(32));
  });

  test("a failed rename leaves no temp file behind", () => {
    const linkDir = dir();
    const file = new DiscoveryFile({ host: "aftereffects", dir: linkDir });
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    expect(() => file.publish(details)).toThrow(/disk full/);
    expect(readdirSync(linkDir)).toEqual([]);
  });

  test("an unreadable or foreign file is never removed", () => {
    const linkDir = dir();
    const file = new DiscoveryFile({ host: "aftereffects", dir: linkDir });
    file.publish(details);
    writeFileSync(file.file, "{broken");
    expect(file.remove()).toBe(false);
    expect(readdirSync(linkDir).sort()).toEqual(["aftereffects.json", "aftereffects.token"]);
  });
});
