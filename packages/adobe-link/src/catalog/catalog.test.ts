import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { PACKAGE_ROOT } from "../build/host-bundle.js";
import { LINK_VERSION } from "../version.js";
import {
  AE_TOOLS,
  HOST_IDS,
  HOST_TOOL_PREFIX,
  PREMIERE_TOOLS,
  absolutePath,
  catalogFileName,
  catalogFileText,
  catalogFor,
  color,
  easing,
  inputSchemaFor,
  layerRef,
  toCatalogJson,
  trackRef,
} from "./index.js";

type Schema = Record<string, unknown>;

/** Every object schema under `schema`, with its JSON path. */
function objectSchemas(schema: Schema, at = "$"): [string, Schema][] {
  const found: [string, Schema][] = [];
  if (schema.type === "object") found.push([at, schema]);
  for (const [key, value] of Object.entries(schema)) {
    if (Array.isArray(value)) value.forEach((item, i) => item && typeof item === "object" && found.push(...objectSchemas(item as Schema, `${at}.${key}[${i}]`)));
    else if (value && typeof value === "object") found.push(...objectSchemas(value as Schema, `${at}.${key}`));
  }
  return found;
}

describe("catalog JSON", () => {
  test.each(HOST_IDS)("extension/catalog/%s.json is up to date (npm run gen:catalog -w @zenvi/adobe-link)", (host) => {
    const onDisk = readFileSync(path.join(PACKAGE_ROOT, "extension", "catalog", catalogFileName(host)), "utf8");
    expect(onDisk).toBe(catalogFileText(host));
  });

  test("has the shape the host server reads", () => {
    const json = toCatalogJson("aftereffects", AE_TOOLS);
    expect(json.host).toBe("aftereffects");
    expect(json.version).toBe(LINK_VERSION);
    for (const tool of json.tools) {
      expect(Object.keys(tool)).toEqual(["name", "title", "description", "inputSchema", "annotations", "returnsImage", "timeoutMs"]);
      expect(tool.inputSchema).not.toHaveProperty("$schema");
    }
  });

  test("LINK_VERSION is the package version", () => {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };
    expect(LINK_VERSION).toBe(pkg.version);
  });
});

describe.each(HOST_IDS)("%s tool definitions", (host) => {
  const defs = catalogFor(host);

  test("names carry the host prefix and are unique", () => {
    const names = defs.map((def) => def.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(new RegExp(`^${HOST_TOOL_PREFIX[host]}[a-z0-9_]+$`));
  });

  test.each(defs.map((def) => [def.name, def] as const))("%s: strict schema, every field described, explicit hints", (_name, def) => {
    expect(def.title.trim()).not.toBe("");
    expect(def.description.length).toBeGreaterThan(40);
    expect(typeof def.annotations.readOnlyHint).toBe("boolean");
    expect(typeof def.annotations.destructiveHint).toBe("boolean");
    if (def.timeoutMs !== undefined) expect(def.timeoutMs).toBeGreaterThan(0);
    const schema = inputSchemaFor(def) as Schema;
    for (const [at, object] of objectSchemas(schema)) {
      expect(object.additionalProperties, `${def.name} ${at} must refuse unknown keys (use z.strictObject)`).toBe(false);
    }
    for (const [key, property] of Object.entries(schema.properties as Record<string, Schema>)) {
      expect(typeof property.description, `${def.name}.${key} needs .describe(...)`).toBe("string");
    }
  });
});

test("tool names are unique across hosts", () => {
  const names = [...AE_TOOLS, ...PREMIERE_TOOLS].map((def) => def.name);
  expect(new Set(names).size).toBe(names.length);
});

describe("shared building blocks", () => {
  test("layerRef: id, {index} or exact name", () => {
    expect(layerRef.parse(33)).toBe(33);
    expect(layerRef.parse({ index: 1 })).toEqual({ index: 1 });
    expect(layerRef.parse("Title")).toBe("Title");
    for (const bad of [0, 1.5, { index: 0 }, { index: 1, extra: true }, ""]) expect(layerRef.safeParse(bad).success).toBe(false);
  });

  test("trackRef: kind plus 0-based index", () => {
    expect(trackRef.parse({ kind: "video", index: 0 })).toEqual({ kind: "video", index: 0 });
    for (const bad of [{ kind: "video", index: -1 }, { kind: "caption", index: 0 }, { kind: "audio" }]) expect(trackRef.safeParse(bad).success).toBe(false);
  });

  test("color: #RRGGBB or [r, g, b] in 0–1", () => {
    expect(color.parse("#FF5A36")).toBe("#FF5A36");
    expect(color.parse([1, 0.5, 0])).toEqual([1, 0.5, 0]);
    for (const bad of ["#FFF", "red", [255, 0, 0], [1, 0]]) expect(color.safeParse(bad).success).toBe(false);
  });

  test("easing: TASTE names or a bezier", () => {
    expect(easing.parse("in-out")).toBe("in-out");
    expect(easing.parse({ x1: 0.2, y1: 0, x2: 0, y2: 1.06 })).toEqual({ x1: 0.2, y1: 0, x2: 0, y2: 1.06 });
    for (const bad of ["bounce", { x1: 1.2, y1: 0, x2: 0, y2: 1 }]) expect(easing.safeParse(bad).success).toBe(false);
  });

  test("absolutePath: POSIX, Windows drive or UNC", () => {
    for (const good of ["/Users/me/a.mov", "C:\\Users\\me\\a.mov", "D:/media/a.mov", "\\\\nas\\share\\a.mov"]) expect(absolutePath.safeParse(good).success).toBe(true);
    for (const bad of ["a.mov", "./a.mov", "~/a.mov", "C:a.mov", ""]) expect(absolutePath.safeParse(bad).success).toBe(false);
  });
});
