import { describe, expect, it } from "vitest";
import { buildEmojiCatalog, loadEmojiCatalog } from "./emojis.js";

// A slice of zenvi-core src/emojis/data/openmoji-optimized.json.
const META = {
  "1F600": { hexcode: "1F600", group: "smileys-emotion", annotation: "grinning face" },
  "1F1E8-1F1EE": { hexcode: "1F1E8-1F1EE", group: "flags", annotation: "flag: Côte d’Ivoire" },
  E000: { hexcode: "E000", group: "extras-openmoji" },
};

describe("emoji catalog (emoji_model.py update_model)", () => {
  it("names and groups entries like the desktop dock", () => {
    const catalog = buildEmojiCatalog(["1F600.svg", "E000.svg", "1F1E8-1F1EE.svg", ".DS_Store", "custom.svg"], META);
    expect(catalog).toEqual([
      { id: "1F1E8-1F1EE", name: "Flag: côte d’ivoire", group: "Flags", groupId: "flags", file: "1F1E8-1F1EE.svg", storedPath: "@emojis/1F1E8-1F1EE.svg" },
      { id: "1F600", name: "Grinning face", group: "Smileys", groupId: "smileys-emotion", file: "1F600.svg", storedPath: "@emojis/1F600.svg" },
      { id: "E000", name: "E000", group: "Extras", groupId: "extras-openmoji", file: "E000.svg", storedPath: "@emojis/E000.svg" },
      { id: "custom", name: "Custom", group: "User", groupId: "user", file: "custom.svg", storedPath: "@emojis/custom.svg" },
    ]);
  });

  it("loads from a host source and ignores prototype keys in metadata", async () => {
    const catalog = await loadEmojiCatalog({
      files: async () => ["constructor.svg", "1F600.svg"],
      metadata: async () => META,
    });
    expect(catalog.map((e) => [e.id, e.name, e.groupId])).toEqual([
      ["1F600", "Grinning face", "smileys-emotion"],
      ["constructor", "Constructor", "user"],
    ]);
  });
});
