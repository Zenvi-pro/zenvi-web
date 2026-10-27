import { describe, expect, it } from "vitest";
import { sfxGenerationKeyText, sfxGenerationRefusal } from "./generate.js";

describe("sfxGenerationRefusal", () => {
  it("lets a plain description of a sound through", () => {
    expect(sfxGenerationRefusal({ prompt: "deep cinematic boom with a long metallic tail", seconds: 3 })).toBeUndefined();
    expect(sfxGenerationRefusal({ prompt: "a heavy door that sounds like a vault closing", seconds: 2 })).toBeUndefined();
  });

  it("refuses names of someone else's work, whatever their case", () => {
    expect(sfxGenerationRefusal({ prompt: "Star Wars lightsaber hum", seconds: 2 })).toMatch(/names 'star wars'/);
    expect(sfxGenerationRefusal({ prompt: "the THX deep note", seconds: 5 })).toMatch(/names 'thx'/);
  });

  it("refuses asking for an imitation", () => {
    // Regression: a trailing \b after the capital matched only one-letter names, and "In the style of" slipped by on its capital.
    expect(sfxGenerationRefusal({ prompt: "a laser blast that sounds like Tron", seconds: 1 })).toMatch(/^Error: describe the sound itself/);
    expect(sfxGenerationRefusal({ prompt: "In the style of a western showdown", seconds: 2 })).toMatch(/^Error: describe the sound itself/);
    expect(sfxGenerationRefusal({ prompt: "whoosh as heard in the trailer", seconds: 1 })).toMatch(/^Error: describe the sound itself/);
  });

  it("refuses lengths and influences outside the provider's range", () => {
    expect(sfxGenerationRefusal({ prompt: "glass tap", seconds: 0.2 })).toMatch(/duration_seconds must be 0.5..30/);
    expect(sfxGenerationRefusal({ prompt: "glass tap", seconds: 31 })).toMatch(/duration_seconds/);
    expect(sfxGenerationRefusal({ prompt: "glass tap", seconds: 1, promptInfluence: 1.2 })).toMatch(/prompt_influence/);
  });
});

describe("sfxGenerationKeyText", () => {
  it("gives equal requests equal keys, whitespace and rounding aside", () => {
    const a = sfxGenerationKeyText("elevenlabs", "m", "mp3", { prompt: " deep  boom ", durationSeconds: 2.001, promptInfluence: 0.7, loop: false });
    const b = sfxGenerationKeyText("elevenlabs", "m", "mp3", { prompt: "deep boom", durationSeconds: 2, promptInfluence: 0.7, loop: false });
    expect(a).toBe(b);
    expect(sfxGenerationKeyText("elevenlabs", "m", "mp3", { prompt: "deep boom", durationSeconds: 2, promptInfluence: 0.7, loop: true })).not.toBe(b);
  });
});
