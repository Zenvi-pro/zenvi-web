import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCKS, getBlock } from "./catalog.js";
import { allParams, checkParams, tokenParams } from "./params.js";

const blocksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "blocks");

describe("block manifests", () => {
  it("lists every block folder, with matching ids", () => {
    const folders = readdirSync(blocksDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(BLOCKS.map((b) => b.id).sort()).toEqual(folders);
    for (const id of folders) expect(existsSync(path.join(blocksDir, id, "block.ts")), id).toBe(true);
  });

  it("are complete and their defaults check", () => {
    const tokens = Object.keys(tokenParams({}));
    for (const b of BLOCKS) {
      expect(b.title.length, b.id).toBeGreaterThan(3);
      expect(b.description.length, b.id).toBeGreaterThan(40);
      expect(b.duration.min <= b.duration.default && b.duration.default <= b.duration.max, b.id).toBe(true);
      expect(b.aspects, b.id).toContain("9:16");
      for (const name of Object.keys(b.params)) {
        expect(tokens, `${b.id}.${name} shadows a token param`).not.toContain(name);
        // The desktop rewrites these keys as media paths on save (linked_media.py PATH_LIKE_KEYS).
        expect(["path", "image", "resource", "protobuf_data_path", "lut_path"], `${b.id}.${name}`).not.toContain(name);
        expect(b.params[name]!.description.length, `${b.id}.${name}`).toBeGreaterThan(8);
      }
      const checked = checkParams(b, {});
      expect(checked.ok ? "ok" : checked.error, b.id).toBe("ok");
    }
  });
});

/** Brands and products from the reference reels (and other third parties): never in a block's defaults or copy. */
const THIRD_PARTY = ["GitHub", "Salesforce", "Island", "Pinterest", "Slack", "Google", "Apple", "Notion", "Figma", "ElevenLabs", "Rho", "Invideo", "Tesla"];

describe("block defaults are original", () => {
  it("name no third-party brand or product", () => {
    const pattern = new RegExp(`\\b(${THIRD_PARTY.join("|")})\\b`, "i");
    for (const b of BLOCKS) {
      const checked = checkParams(b, {});
      const text = JSON.stringify({ title: b.title, description: b.description, params: b.params, defaults: checked.ok ? checked.params : null });
      expect(pattern.exec(text)?.[0], b.id).toBeUndefined();
      const source = readFileSync(path.join(blocksDir, b.id, "block.ts"), "utf8");
      expect(pattern.exec(source)?.[0], `${b.id}/block.ts`).toBeUndefined();
    }
  });
});

describe("checkParams", () => {
  const block = getBlock("counter")!;

  it("fills defaults", () => {
    const r = checkParams(block, {});
    expect(r.ok && r.params.label).toBe("Clips cut this week");
    expect(r.ok && r.params.palette).toBe("mono");
    expect(r.ok && "accent" in r.params).toBe(false);
  });

  it("coerces the strings backend agents send", () => {
    const r = checkParams(block, { decimals: "2", values: '["1", "2.5"]', exit: "false", accent: "#ff5a36", style: "COUNT" });
    expect(r).toMatchObject({ ok: true, params: { decimals: 2, values: ["1", "2.5"], exit: false, accent: "#FF5A36", style: "count" } });
    expect(checkParams(block, { values: "10|20|30" })).toMatchObject({ ok: true, params: { values: ["10", "20", "30"] } });
  });

  it("refuses unknown names and bad values in words", () => {
    expect(checkParams(block, { colour: "red" })).toMatchObject({ ok: false, error: expect.stringContaining("has no parameter colour") });
    expect(checkParams(block, { decimals: 9 })).toMatchObject({ ok: false, error: "decimals must be at most 3" });
    expect(checkParams(block, { decimals: 1.5 })).toMatchObject({ ok: false, error: "decimals must be a whole number" });
    expect(checkParams(block, { accent: "red" })).toMatchObject({ ok: false, error: expect.stringContaining("hex colour") });
    expect(checkParams(block, { style: "spin" })).toMatchObject({ ok: false, error: "style must be one of odometer, count" });
    expect(checkParams(block, { values: [] })).toMatchObject({ ok: false, error: "values needs at least 1 items" });
    expect(checkParams(block, { label: "x".repeat(61) })).toMatchObject({ ok: false, error: "label is longer than 60 characters" });
  });

  it("keeps a text value that happens to start with the param's name", () => {
    expect(checkParams(block, { label: "label must be kept" })).toMatchObject({ ok: true, params: { label: "label must be kept" } });
  });

  it("takes points and media ids", () => {
    const hud = getBlock("hud_callouts")!;
    expect(checkParams(hud, { points: [{ x: 0.2, y: "0.4" }], background: "ABCDEF1234" })).toMatchObject({ ok: true, params: { points: [{ x: 0.2, y: 0.4 }], background: "ABCDEF1234" } });
    expect(checkParams(hud, { points: [{ x: 2, y: 0 }] })).toMatchObject({ ok: false });
    expect(allParams(hud).background?.type).toBe("media");
  });
});
