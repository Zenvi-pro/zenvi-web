import { describe, expect, it } from "vitest";
import goldens from "./__fixtures__/desktop-upgrades.json" with { type: "json" };
import { legacyLocationFactor, repairAudioOnlyProjectData, upgradeProjectData } from "./migrate.js";
import { compareVersions, isZenviVersion, numericVersion } from "./versions.js";

interface UpgradeCase {
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

const cases = (goldens as unknown as { cases: UpgradeCase[] }).cases;

/** The ids the generator hands out, in order (scripts/gen-io-goldens.py `reset_ids`). */
function sequentialIds(): () => string {
  let n = 0;
  return () => `MIGRATED${String((n += 1)).padStart(2, "0")}`;
}

function upgraded(input: Record<string, unknown>): Record<string, unknown> {
  const data = structuredClone(input);
  upgradeProjectData(data, { newId: sequentialIds() });
  return data;
}

describe("upgradeProjectData matches the desktop's upgrade_project_data_structures", () => {
  for (const c of cases.filter((c) => c.name !== "zenvi-1.0-handles")) {
    it(c.name, () => {
      expect(upgraded(c.input)).toEqual(c.output);
    });
  }

  it("keeps bezier handles of Zenvi-stamped projects (the desktop resets them; documented difference)", () => {
    const c = cases.find((c) => c.name === "zenvi-1.0-handles")!;
    expect(c.output).not.toEqual(c.input);
    expect(upgraded(c.input)).toEqual(c.input);
  });

  it("does not touch a current project", () => {
    const current = cases.find((c) => c.name === "openshot-4.0.0-rc-untouched")!;
    expect(upgraded(current.input)).toEqual(current.input);
  });
});

describe("version helpers", () => {
  it("parses versions like _numeric_version", () => {
    expect(numericVersion("2.1.0-dev")).toEqual([2, 1, 0]);
    expect(numericVersion("4.0")).toEqual([4, 0, 0]);
    expect(numericVersion("v1.0.188 beta 7")).toEqual([1, 0, 188]);
    expect(numericVersion(undefined)).toEqual([0, 0, 0]);
    expect(compareVersions(numericVersion("0.5.0"), [1, 0, 0])).toBeLessThan(0);
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
  });

  it("tells Zenvi stamps from OpenShot ones", () => {
    expect(isZenviVersion("1.0.188")).toBe(true);
    expect(isZenviVersion("0.1.0")).toBe(true);
    expect(isZenviVersion("0.0.0")).toBe(false);
    expect(isZenviVersion("2.0.7")).toBe(false);
    expect(isZenviVersion("3.1.1")).toBe(false);
  });
});

describe("migration helpers", () => {
  it("legacyLocationFactor follows the desktop formula", () => {
    expect(legacyLocationFactor(0, 1280, 640, "center")).toBe(1);
    expect(legacyLocationFactor(0.5, 720, 1280, "center")).toBe(0.72);
    expect(legacyLocationFactor(0.5, 720, 1280, "start")).toBe(1);
    expect(legacyLocationFactor(-0.5, 720, 1280, "start")).toBe(0.5625);
    expect(legacyLocationFactor(0.5, 720, 1280, "end")).toBe(0.5625);
    expect(legacyLocationFactor(0.5, 0, 1280, "end")).toBe(1);
  });

  it("repairAudioOnlyProjectData counts repaired clips and ignores video", () => {
    const data = {
      files: [
        { id: "A", path: "/m/a.mp3", has_video: true },
        { id: "V", path: "/m/v.mp4", has_video: true, media_type: "video" },
      ],
      clips: [
        { id: "C1", file_id: "A", scale: 1, reader: { path: "/m/a.mp3", has_video: true } },
        { id: "C2", file_id: "V", scale: 1, reader: { path: "/m/v.mp4", has_video: true } },
      ],
    };
    expect(repairAudioOnlyProjectData(data)).toBe(1);
    expect(data.files[0]!.has_video).toBe(false);
    expect(data.files[1]!.has_video).toBe(true);
    expect(data.clips[0]!.scale).toBe(3);
    expect(data.clips[1]!.scale).toBe(1);
  });
});
