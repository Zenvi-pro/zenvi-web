/**
 * Host tool catalog types (SPEC §3.4) and the zod building blocks every
 * After Effects / Premiere Pro tool reuses. The catalog is defined once here
 * in TypeScript; `npm run gen:catalog` bundles it as JSON into the extension
 * (the host server lists and validates from that JSON) and the CLI imports
 * these definitions directly.
 */

import { z } from "zod";
import { EASING_NAMES } from "../taste.js";
import { LINK_VERSION } from "../version.js";

export type HostId = "aftereffects" | "premiere";

export const HOST_IDS: readonly HostId[] = ["aftereffects", "premiere"];

/** Tool name prefix per host. */
export const HOST_TOOL_PREFIX: { readonly [H in HostId]: string } = {
  aftereffects: "ae_",
  premiere: "premiere_",
};

export interface HostToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface HostToolDef {
  /** `ae_*` or `premiere_*`. */
  name: string;
  title: string;
  /** When to use it, plus the tasteful defaults it applies (TASTE.md). */
  description: string;
  /** Strict (`z.strictObject`), with a description on every field. */
  input: z.ZodObject;
  annotations: HostToolAnnotations;
  /** Frame captures: the receipt's `data.image_path` becomes an image content block. */
  returnsImage?: boolean;
  /** Per-call timeout in the host server; default {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Identity function that keeps the zod input type, so callers (the CLI, tests)
 * can write `z.input<typeof aeAddText.input>`.
 */
export function defineHostTool<I extends z.ZodObject>(def: Omit<HostToolDef, "input"> & { input: I }): HostToolDef & { input: I } {
  return def;
}

/** JSON Schema object for MCP `inputSchema` (draft 2020-12, unknown keys refused). */
export interface HostInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
  [key: string]: unknown;
}

export interface CatalogToolJson {
  name: string;
  title: string;
  description: string;
  inputSchema: HostInputSchema;
  annotations: HostToolAnnotations;
  returnsImage: boolean;
  timeoutMs: number;
}

/** `extension/catalog/<host>.json`. */
export interface CatalogJson {
  host: HostId;
  version: string;
  tools: CatalogToolJson[];
}

/** The tool's MCP `inputSchema`, built the way `packages/engine/src/tools/define.ts` builds direct tools. */
export function inputSchemaFor(def: HostToolDef): HostInputSchema {
  const { $schema: _schema, ...json } = z.toJSONSchema(def.input, { io: "input" }) as Record<string, unknown>;
  return { ...json, type: "object", properties: (json.properties as Record<string, unknown>) ?? {}, additionalProperties: false };
}

export function toCatalogJson(host: HostId, defs: readonly HostToolDef[]): CatalogJson {
  return {
    host,
    version: LINK_VERSION,
    tools: defs.map((def) => ({
      name: def.name,
      title: def.title,
      description: def.description,
      inputSchema: inputSchemaFor(def),
      annotations: { ...def.annotations },
      returnsImage: def.returnsImage ?? false,
      timeoutMs: def.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })),
  };
}

// ---------------------------------------------------------------------------
// Shared building blocks. Add `.describe(...)` at the use site: the
// description says what the value means for that tool.

/** Seconds on the comp/sequence timeline. Tools snap to the frame grid and say so in `warnings`. */
export const seconds = z.number().min(0);

/** TASTE §2 easing names. */
export const easingName = z.enum(EASING_NAMES);

/** A custom cubic-bezier curve (CSS order). */
export const bezierEasing = z
  .strictObject({
    x1: z.number().min(0).max(1).describe("First control point x, 0–1"),
    y1: z.number().describe("First control point y (outside 0–1 overshoots)"),
    x2: z.number().min(0).max(1).describe("Second control point x, 0–1"),
    y2: z.number().describe("Second control point y (outside 0–1 overshoots)"),
  })
  .describe("Custom cubic-bezier(x1, y1, x2, y2)");

/** A TASTE easing name or a custom bezier. */
export const easing = z.union([easingName.describe("TASTE easing name"), bezierEasing]);

/** `#RRGGBB`. */
export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "must be #RRGGBB");

/** `[r, g, b]`, each 0–1 (After Effects' colour arrays). */
export const rgbColor = z.array(z.number().min(0).max(1)).length(3);

/** A colour: `#RRGGBB` or `[r, g, b]` with 0–1 channels. */
export const color = z.union([hexColor.describe("Hex colour #RRGGBB"), rgbColor.describe("[r, g, b], each 0–1")]);

/**
 * An After Effects layer: its id (`layer_id` in ae_get_comp and receipts,
 * stable when layers move; After Effects 22+), `{index}` (1-based, 1 = top)
 * or its exact name.
 */
export const layerRef = z.union([
  z.int().min(1).describe("Layer id (`layer_id` from ae_get_comp or a receipt; After Effects 2022+)"),
  z.strictObject({ index: z.int().min(1).describe("1-based layer index, 1 = top layer") }).describe("Layer by position"),
  z.string().min(1).describe("Exact layer name"),
]);

/** A Premiere Pro track: kind plus 0-based index like the DOM (V1 and A1 are index 0). */
export const trackRef = z.strictObject({
  kind: z.enum(["video", "audio"]).describe("Track kind"),
  index: z.int().min(0).describe("0-based track index as in the Premiere DOM: V1 / A1 = 0"),
});

/** POSIX `/…`, Windows `C:\…` / `C:/…`, or UNC `\\server\share\…`. */
export const ABSOLUTE_PATH_PATTERN = /^(\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\)/;

/** An absolute file system path on the machine running the Adobe app. */
export const absolutePath = z.string().regex(ABSOLUTE_PATH_PATTERN, "must be an absolute path");
export { absolutePath as path };

/** Where text sits in the frame; every placement stays inside title-safe (TASTE §3). */
export const placement = z.enum(["center", "lower-third", "top-left", "top-center", "bottom-center"]);
