import { describe, expect, it } from "vitest";
import { profileFor, resolveProfile } from "./profiles.js";

function pick(request: string): string {
  const choice = resolveProfile(request);
  if (!choice.ok) throw new Error(choice.message);
  return `${choice.profile.description} ${choice.profile.width}x${choice.profile.height} ${choice.profile.fps.num}/${choice.profile.fps.den} ${choice.profile.progressive ? "p" : "i"}`;
}

describe("resolveProfile", () => {
  it("understands the request that used to create a horizontal interlaced project", () => {
    expect(pick("Vertical HD 1080p 30 fps")).toBe("FHD Vertical 1080p 30 fps 1080x1920 30/1 p");
  });

  it("takes exact names and keys, mapping legacy ones to their current twin", () => {
    expect(pick("FHD Vertical 1080p 30 fps")).toBe("FHD Vertical 1080p 30 fps 1080x1920 30/1 p");
    expect(pick("01920x1080p2997_16-09")).toBe("FHD 1080p 29.97 fps 1920x1080 30000/1001 p");
    // The desktop's own name for its 4:5 profile is authoritative…
    expect(pick("HD Vertical 1080p 30 fps")).toBe("HD Vertical 1080p 30 fps 1080x1350 30/1 p");
    // …and a legacy key maps to the current profile with the same size and rate.
    expect(pick("vertical_1080p_30")).toBe("FHD Vertical 1080p 30 fps 1080x1920 30/1 p");
    // An explicit interlaced name is honoured.
    expect(pick("FHD 1080i 30 fps")).toBe("FHD 1080i 30 fps 1920x1080 30/1 i");
  });

  it("prefers progressive profiles and 30 fps when nothing else is said", () => {
    expect(pick("1080p")).toBe("FHD 1080p 30 fps 1920x1080 30/1 p");
    expect(pick("FHD 30")).toBe("FHD 1080p 30 fps 1920x1080 30/1 p");
    expect(pick("landscape_1080p")).toBe("FHD 1080p 30 fps 1920x1080 30/1 p");
    expect(pick("1080i")).toMatch(/1920x1080 .* i$/);
  });

  it("reads orientation, resolution and frame-rate words", () => {
    expect(pick("portrait 720p 60")).toBe("HD Vertical 720p 60 fps 720x1280 60/1 p");
    expect(pick("vertical")).toBe("FHD Vertical 1080p 30 fps 1080x1920 30/1 p");
    expect(pick("9:16 25fps")).toBe("FHD Vertical 1080p 25 fps 1080x1920 25/1 p");
    expect(pick("square")).toBe("HD Square 1080p 30 fps 1080x1080 30/1 p");
    expect(pick("4k 24")).toBe("4K UHD 2160p 24 fps 3840x2160 24/1 p");
    expect(pick("1080p60")).toBe("FHD 1080p 60 fps 1920x1080 60/1 p");
    expect(pick("1920x1080 25")).toBe("FHD PAL 1080p 25 fps 1920x1080 25/1 p");
    expect(pick("1080p 29.97")).toBe("FHD 1080p 29.97 fps 1920x1080 30000/1001 p");
    expect(pick("720p")).toBe("HD 720p 30 fps 1280x720 30/1 p");
  });

  it("refuses to guess, listing close profiles instead", () => {
    const vertical4k = resolveProfile("vertical 4k");
    expect(vertical4k.ok).toBe(false);
    if (!vertical4k.ok) {
      expect(vertical4k.suggestions.length).toBeGreaterThan(0);
      expect(vertical4k.suggestions[0]).toMatch(/Vertical/);
      expect(vertical4k.message).toContain("Close profiles");
    }
    const nonsense = resolveProfile("banana");
    expect(nonsense.ok).toBe(false);
    if (!nonsense.ok) expect(nonsense.suggestions).toContain("FHD 1080p 30 fps");
    expect(resolveProfile("square 29.97").ok).toBe(false);
  });
});

describe("profileFor", () => {
  it("never picks an interlaced profile for a format", () => {
    const choice = profileFor("landscape_1080p", 30);
    expect(choice.ok && choice.profile.description).toBe("FHD 1080p 30 fps");
    const ntsc = profileFor("vertical_1080p", 29.97);
    expect(ntsc.ok && ntsc.profile.description).toBe("FHD Vertical 1080p 29.97 fps");
    expect(profileFor("square_1080p", 29.97).ok).toBe(false);
  });
});
