import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildEmojiCatalog, loadEmojiCatalog, parseBundledEmojiCatalog, scoreEmoji, searchEmojis } from "./emojis.js";

// A slice of zenvi-core src/emojis/data/openmoji-optimized.json.
const META = {
  "1F600": { hexcode: "1F600", group: "smileys-emotion", annotation: "grinning face", emoji: "😀", tags: "face, grin", openmoji_tags: "smile, happy", subgroups: "face-smiling" },
  "1F1E8-1F1EE": { hexcode: "1F1E8-1F1EE", group: "flags", annotation: "flag: Côte d’Ivoire" },
  E000: { hexcode: "E000", group: "extras-openmoji" },
};

const BUNDLED = parseBundledEmojiCatalog(readFileSync(new URL("../../assets/emojis/catalog.json", import.meta.url), "utf8"));

describe("emoji catalog (emoji_model.py update_model, emoji_catalog.py entry_for)", () => {
  it("names and groups entries like the desktop dock", () => {
    const catalog = buildEmojiCatalog(["1F600.svg", "E000.svg", "1F1E8-1F1EE.svg", ".DS_Store", "custom.svg"], META);
    expect(catalog.map(({ id, name, group, groupId, file, storedPath }) => ({ id, name, group, groupId, file, storedPath }))).toEqual([
      { id: "1F1E8-1F1EE", name: "Flag: côte d’ivoire", group: "Flags", groupId: "flags", file: "1F1E8-1F1EE.svg", storedPath: "@emojis/1F1E8-1F1EE.svg" },
      { id: "1F600", name: "Grinning face", group: "Smileys", groupId: "smileys-emotion", file: "1F600.svg", storedPath: "@emojis/1F600.svg" },
      { id: "E000", name: "E000", group: "Extras", groupId: "extras-openmoji", file: "E000.svg", storedPath: "@emojis/E000.svg" },
      { id: "custom", name: "Custom", group: "User", groupId: "user", file: "custom.svg", storedPath: "@emojis/custom.svg" },
    ]);
    expect(catalog[1]).toMatchObject({ char: "😀", tags: "face, grin smile, happy face-smiling", skintone: "" });
    expect(catalog[2]).toMatchObject({ char: "", tags: "  ", skintone: "" });
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

  it("bundles the desktop's 1,239 OpenMoji stickers, named like the dock", () => {
    expect(BUNDLED).toHaveLength(1239);
    const fire = BUNDLED.find((e) => e.id === "1F525")!;
    expect([fire.name, fire.groupId, fire.group, fire.char]).toEqual(["Fire", "travel-places", "Travel", "🔥"]);
    expect(new Set(BUNDLED.map((e) => `${e.group}/${e.groupId}`))).toContain("Smileys/smileys-emotion");
    for (const entry of BUNDLED) expect(readFileSync(new URL(`../../assets/emojis/${entry.file}`, import.meta.url), "utf8")).toMatch(/^<svg viewBox="0 0 72 72"/);
  });
});

describe("emoji search (emoji_catalog.py score / search)", () => {
  it.each([
    ["fire", "1F525"],
    ["🔥", "1F525"],
    ["1F525", "1F525"],
    ["u+1f525", "1F525"],
    ["heart", "2764"],
    ["red heart", "2764"],
    ["❤️", "2764"],
    ["party", "1F389"],
    ["laugh", "1F602"],
    ["100", "1F4AF"],
    ["boom", "1F4A5"],
    ["coffee", "2615"],
  ])("finds what people mean by %s", (query, code) => {
    const best = searchEmojis(BUNDLED, query)[0]!;
    expect(best.entry.id, JSON.stringify(searchEmojis(BUNDLED, query, "", 5).map((m) => [m.score, m.entry.id, m.entry.name]))).toBe(code);
  });

  it("filters by group id or the dock's label and ranks ties by name", () => {
    const cakes = searchEmojis(BUNDLED, "cake", "food-drink", 3);
    expect(cakes.length).toBeGreaterThan(0);
    expect(cakes.every((m) => m.entry.groupId === "food-drink")).toBe(true);
    expect(searchEmojis(BUNDLED, "cake", "Food", 3).map((m) => m.entry.id)).toEqual(cakes.map((m) => m.entry.id));
    expect(searchEmojis(BUNDLED, "zzqqxxjj")).toEqual([]);
    expect(searchEmojis(BUNDLED, "", "symbols", 2)).toHaveLength(2);
  });

  it("scores exact names over words over tags, with a skin-tone penalty", () => {
    const entry = BUNDLED.find((e) => e.id === "1F525")!;
    expect(scoreEmoji(entry, "")).toBe(1);
    expect(scoreEmoji(entry, "Fire")).toBe(90);
    expect(scoreEmoji(entry, "flame")).toBe(95);
    expect(scoreEmoji({ ...entry, skintone: "1" }, "fire")).toBe(85);
    expect(scoreEmoji(entry, "nothing like it")).toBe(0);
  });
});
