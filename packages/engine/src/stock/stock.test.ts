import { describe, expect, it } from "vitest";
import { clockTime, licenceName, licenceRank, pickMusic, pickStockFile, pickStockVideo } from "./stock.js";

const video = (id: number, width: number, height: number, duration: number, files: { width: number; height: number; link: string }[] = [{ width, height, link: `https://cdn.test/${id}.mp4` }]) => ({
  id,
  width,
  height,
  duration,
  video_files: files.map((f) => ({ ...f, quality: "hd", file_type: "video/mp4" })),
});

describe("stock picks", () => {
  it("prefer the frame's orientation, enough length and unused clips", () => {
    const list = [video(1, 1920, 1080, 12), video(2, 1080, 1920, 2), video(3, 1080, 1920, 9), video(4, 1080, 1920, 9)];
    expect(pickStockVideo(list, true, new Set())?.id).toBe(3);
    expect(pickStockVideo(list, true, new Set([3]))?.id).toBe(4);
    expect(pickStockVideo(list, false, new Set())?.id).toBe(1);
  });

  it("take the rendition just big enough for the frame", () => {
    const v = video(9, 2160, 3840, 10, [
      { width: 2160, height: 3840, link: "uhd" },
      { width: 1080, height: 1920, link: "fhd" },
      { width: 540, height: 960, link: "sd" },
    ]);
    expect(pickStockFile(v, 1080, true)?.link).toBe("fhd");
    // Three quarters of the frame is enough (smaller downloads); less is not.
    expect(pickStockFile(v, 1440, true)?.link).toBe("fhd");
    expect(pickStockFile(v, 1600, true)?.link).toBe("uhd");
    expect(pickStockFile(video(5, 1, 1, 1, []), 1080, true)).toBeUndefined();
  });

  it("pick music long enough for the reel, open licences first", () => {
    const sounds = [
      { id: 1, name: "short", duration: 8, license: "Creative Commons 0", previews: { hq_mp3: "a" } },
      { id: 2, name: "nc", duration: 60, license: "Attribution NonCommercial 4.0", previews: { hq_mp3: "b" } },
      { id: 3, name: "by", duration: 60, license: "Attribution 4.0", previews: { hq_mp3: "c" } },
      { id: 4, name: "zero", duration: 60, license: "http://creativecommons.org/publicdomain/zero/1.0/", previews: { hq_mp3: "d" } },
    ];
    expect(pickMusic(sounds, 15)?.id).toBe(4);
    expect(pickMusic(sounds.slice(0, 3), 15)?.id).toBe(3);
  });

  it("prefer the shortest long-enough track within a licence class (the whole track downloads)", () => {
    const nc = (id: number, duration: number) => ({ id, name: String(id), duration, license: "http://creativecommons.org/licenses/by-nc/4.0/", previews: { hq_mp3: String(id) } });
    expect(pickMusic([nc(1, 138), nc(2, 74), nc(3, 32), nc(4, 70)], 15)?.id).toBe(3);
    expect(pickMusic([nc(1, 138), nc(2, 74), nc(3, 18)], 15)?.id).toBe(2);
  });
});

describe("licences", () => {
  it("rank CC0 first and non-commercial last", () => {
    expect(licenceRank("http://creativecommons.org/publicdomain/zero/1.0/")).toBe(0);
    expect(licenceRank("http://creativecommons.org/licenses/by/4.0/")).toBe(1);
    expect(licenceRank("http://creativecommons.org/licenses/by-nc/4.0/")).toBe(2);
    expect(licenceRank("Attribution NonCommercial 4.0")).toBe(2);
  });

  it("name Creative Commons licence URLs", () => {
    expect(licenceName("http://creativecommons.org/publicdomain/zero/1.0/")).toBe("CC0");
    expect(licenceName("https://creativecommons.org/licenses/by/4.0/")).toBe("CC BY 4.0");
    expect(licenceName("http://creativecommons.org/licenses/by-nc/3.0/")).toBe("CC BY-NC 3.0");
    expect(licenceName("")).toBe("unknown licence");
  });

  it("write durations as m:ss", () => {
    expect(clockTime(0)).toBe("0:00");
    expect(clockTime(89.6)).toBe("1:30");
    expect(clockTime(605)).toBe("10:05");
  });
});
