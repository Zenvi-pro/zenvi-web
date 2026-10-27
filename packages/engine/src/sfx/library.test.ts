import { describe, expect, it } from "vitest";
import { OPENVERSE_FIXTURES, openverseRecord } from "../tools/test-support/fake-host.js";
import {
  allowedLicenses,
  attributionLine,
  filterResults,
  licenseCode,
  licenseName,
  openverseDetailUrl,
  openverseSearchUrl,
  readFreesoundSound,
  readOpenverseAudio,
  readOpenverseSearch,
  searchRecipes,
  type SfxSearchFilters,
} from "./library.js";

const ANY_LENGTH: SfxSearchFilters = { license: "commercial-ok", noncommercial: false, minSeconds: 0, maxSeconds: 60 };

describe("licences", () => {
  it("offers public domain, commercial-use and open licences, non-commercial ones only when asked", () => {
    expect(allowedLicenses("cc0")).toEqual(["cc0", "pdm"]);
    expect(allowedLicenses("commercial-ok")).toEqual(["cc0", "pdm", "by", "by-sa"]);
    expect(allowedLicenses("any")).not.toContain("by-nc");
    expect(allowedLicenses("any", true)).toContain("by-nc");
    // Only "any" opens the door: a narrower filter never lets non-commercial in.
    expect(allowedLicenses("commercial-ok", true)).not.toContain("by-nc");
  });

  it("reads Creative Commons URLs and names", () => {
    expect(licenseCode("http://creativecommons.org/publicdomain/zero/1.0/")).toBe("cc0");
    expect(licenseCode("https://creativecommons.org/licenses/by-nc/4.0/")).toBe("by-nc");
    expect(licenseCode("https://creativecommons.org/licenses/by/3.0/")).toBe("by");
    expect(licenseCode("Creative Commons 0")).toBe("cc0");
    expect(licenseCode("http://creativecommons.org/licenses/sampling+/1.0/")).toBe("sampling+");
    expect(licenseCode("All rights reserved")).toBeNull();
    expect(licenseName("by-sa", "4.0")).toBe("CC BY-SA 4.0");
    expect(licenseName("cc0", "1.0")).toBe("CC0 1.0");
  });

  it("words attribution like Openverse: licensed under for CC BY, marked with for CC0", () => {
    const base = { title: "Hit", creator: "ana", landing_url: "https://freesound.org/s/1/", license_url: "https://creativecommons.org/licenses/by/4.0/" };
    expect(attributionLine({ ...base, license: "by", license_name: "CC BY 4.0" })).toBe(
      '"Hit" by ana (https://freesound.org/s/1/) is licensed under CC BY 4.0. To view the terms, visit https://creativecommons.org/licenses/by/4.0/.',
    );
    expect(attributionLine({ ...base, license: "cc0", license_name: "CC0 1.0" })).toMatch(/is marked with CC0 1\.0\./);
  });
});

describe("Openverse", () => {
  it("asks for the allowed licences, at most a page of 20, and looks sounds up by UUID", () => {
    expect(openverseSearchUrl("glass hit", { license: "cc0", noncommercial: false })).toBe("https://api.openverse.org/v1/audio/?q=glass+hit&license=cc0%2Cpdm&page_size=20&mature=false");
    expect(openverseDetailUrl("0E8A6E2A-0AC8-4615-9E0D-EBDE30523783")).toBe("https://api.openverse.org/v1/audio/0e8a6e2a-0ac8-4615-9e0d-ebde30523783/");
    expect(() => openverseDetailUrl("../../v1/auth")).toThrow();
  });

  it("reads a record: seconds from milliseconds, its credit line, the file to download", () => {
    const r = readOpenverseAudio(OPENVERSE_FIXTURES[1])!;
    expect(r).toMatchObject({ provider: "openverse", title: "Glass impact hit", license: "by", license_name: "CC BY 4.0", attribution_required: true, commercial_use: true, duration: 0.8 });
    expect(r.preview_url).toMatch(/^https:\/\/cdn\.freesound\.test\//);
    expect(r.attribution).toMatch(/^"Glass impact hit" by maker \(https:\/\/freesound\.test\/s\/1b2c\/\) is licensed under CC BY 4\.0\./);
    // Openverse's own attribution wins when it sends one.
    expect(readOpenverseAudio({ ...OPENVERSE_FIXTURES[0], attribution: "Their words." })!.attribution).toBe("Their words.");
  });

  it("drops records without a file, with an unknown licence or an odd shape", () => {
    expect(readOpenverseAudio({ ...OPENVERSE_FIXTURES[0], url: null })).toBeNull();
    expect(readOpenverseAudio({ ...OPENVERSE_FIXTURES[0], license: "all-rights-reserved" })).toBeNull();
    expect(readOpenverseAudio({ ...OPENVERSE_FIXTURES[0], id: "x" })).toBeNull();
    expect(readOpenverseAudio({ ...OPENVERSE_FIXTURES[0], url: "javascript:alert(1)" })).toBeNull();
    expect(readOpenverseSearch({ result_count: 9, results: [OPENVERSE_FIXTURES[0], { nope: 1 }] }).results).toHaveLength(1);
    expect(() => readOpenverseSearch({ detail: "throttled" })).toThrow(/not a search result/);
  });
});

describe("Freesound", () => {
  it("reads a sound the backend returns, its licence from the URL", () => {
    const r = readFreesoundSound({ id: 77, name: "Snap", duration: 0.4, username: "bo", license: "http://creativecommons.org/licenses/by/4.0/", previews: { hq_mp3: "https://cdn.freesound.org/previews/0/77_1-hq.mp3" } })!;
    expect(r).toMatchObject({ provider: "freesound", id: "77", license: "by", license_name: "CC BY 4.0", landing_url: "https://freesound.org/s/77/", attribution_required: true });
    expect(readFreesoundSound({ id: 78, name: "x", license: "http://creativecommons.org/licenses/by/4.0/", previews: {} })).toBeNull();
  });
});

describe("filterResults", () => {
  const results = OPENVERSE_FIXTURES.map(readOpenverseAudio).filter((r) => r !== null);

  it("never keeps a non-commercial licence unless asked, and keeps the library's order", () => {
    expect(filterResults(results, ANY_LENGTH).map((r) => r.license)).toEqual(["cc0", "by"]);
    expect(filterResults(results, { ...ANY_LENGTH, license: "any", noncommercial: true }).map((r) => r.license)).toEqual(["cc0", "by", "by-nc"]);
    expect(filterResults(results, { ...ANY_LENGTH, license: "cc0" }).map((r) => r.title)).toEqual(["Deep Whoosh #1"]);
  });

  it("filters by length and drops a second copy of one sound", () => {
    expect(filterResults(results, { ...ANY_LENGTH, minSeconds: 1, maxSeconds: 2 }).map((r) => r.title)).toEqual(["Deep Whoosh #1"]);
    const twin = readOpenverseAudio(openverseRecord("3d4e5f60-0000-4000-8000-000000000004", "Deep Whoosh #1", "cc0", "1.0", 1200))!;
    expect(filterResults([...results, twin], ANY_LENGTH)).toHaveLength(2);
  });
});

describe("searchRecipes", () => {
  it("finds the recipes a query names, by id, family words and use", () => {
    expect(searchRecipes("whoosh", { minSeconds: 0, maxSeconds: 10 }, 3).map((r) => r.id)).toEqual(expect.arrayContaining(["whoosh_short"]));
    expect(searchRecipes("camera shutter", { minSeconds: 0, maxSeconds: 10 }, 1)[0]).toMatchObject({ provider: "procedural", id: "camera_shutter", license: "zenvi", attribution: "" });
    expect(searchRecipes("cello sonata", { minSeconds: 0, maxSeconds: 10 }, 3)).toEqual([]);
  });
});
