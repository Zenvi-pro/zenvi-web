/**
 * Block parameters: the schema a `block.json` declares, the design-token
 * parameters every block shares, and checking/coercing the values an agent
 * sends (backend agents send every argument as a string).
 */

import { FONT_ROLES, PALETTE_NAMES } from "./tokens.js";

interface ParamBase {
  description: string;
}

export type ParamSpec =
  | (ParamBase & { type: "string"; default?: string; maxLength?: number; optional?: boolean })
  | (ParamBase & { type: "number" | "integer"; default?: number; min?: number; max?: number; optional?: boolean })
  | (ParamBase & { type: "boolean"; default?: boolean })
  | (ParamBase & { type: "color"; default?: string; optional?: boolean })
  /** `aliases`: values agents send that mean an option (names from before a rename, near misses). */
  | (ParamBase & { type: "enum"; options: string[]; default?: string; aliases?: Record<string, string> })
  | (ParamBase & { type: "strings"; default?: string[]; minItems?: number; maxItems?: number; maxLength?: number })
  | (ParamBase & { type: "points"; default?: { x: number; y: number }[]; minItems?: number; maxItems?: number })
  /** A bin file (photo or video) by file id; the renderer turns it into a page URL. */
  | (ParamBase & { type: "media"; accept: ("image" | "video")[]; optional?: boolean });

export type ParamType = ParamSpec["type"];
export type ParamValue = string | number | boolean | string[] | { x: number; y: number }[];
export type Params = Record<string, ParamValue>;

export interface BlockDuration {
  default: number;
  min: number;
  max: number;
}

/** A block's `block.json`. */
export interface BlockManifest {
  id: string;
  /** Bumped when a change alters existing renders on purpose (it is also part of the fingerprint). */
  version: number;
  title: string;
  description: string;
  tags: string[];
  duration: BlockDuration;
  /** Aspect ratios the layout was designed and checked for (e.g. "9:16"); others still render. */
  aspects: string[];
  /** True when the block is meant to sit over video (transparent background by default). */
  alpha: boolean;
  /** Defaults for the shared token parameters. */
  tokens?: { palette?: string; display?: string; radius?: number };
  params: Record<string, ParamSpec>;
}

/** Parameters every block takes (tokens, exit, seed); a block's own may not reuse these names. */
export function tokenParams(manifest: Pick<BlockManifest, "tokens">): Record<string, ParamSpec> {
  const t = manifest.tokens ?? {};
  return {
    palette: { type: "enum", options: [...PALETTE_NAMES], default: t.palette ?? "light", description: `Colour palette: ${PALETTE_NAMES.join(", ")}.` },
    accent: { type: "color", optional: true, description: "Brand accent colour (#rrggbb); default the palette's." },
    paper: { type: "color", optional: true, description: "Background colour (#rrggbb) replacing the palette's, for a brief's exact colours." },
    ink: { type: "color", optional: true, description: "Text colour (#rrggbb) replacing the palette's." },
    display_font: { type: "enum", options: [...FONT_ROLES], default: t.display ?? "sans", description: "Headline face: sans (Inter), serif (Instrument Serif), mono (JetBrains Mono), display (Anton, condensed)." },
    // A block may default to a pill (logo_reveal_end: 999), so its own default stays in range.
    radius: { type: "number", min: 0, max: Math.max(80, t.radius ?? 0), default: t.radius ?? 28, description: "Corner radius of cards and pills, px at 1080." },
    exit: { type: "boolean", default: true, description: "Animate out over the last 0.4 s." },
    seed: { type: "integer", min: 0, max: 2147483647, default: 1, description: "Seed for the block's random choices (particles, scramble glyphs)." },
  };
}

/** Every parameter of a block: its own, then the shared ones. */
export function allParams(manifest: BlockManifest): Record<string, ParamSpec> {
  return { ...manifest.params, ...tokenParams(manifest) };
}

export type ParamsCheck = { ok: true; params: Params } | { ok: false; error: string };

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asList(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(s);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

type Coerced = { value: ParamValue } | { error: string };

function coerce(name: string, spec: ParamSpec, v: unknown): Coerced {
  const bad = (what: string): Coerced => ({ error: `${name} must be ${what}` });
  const fail = (error: string): Coerced => ({ error });
  switch (spec.type) {
    case "string":
    case "media": {
      if (typeof v !== "string" && typeof v !== "number") return bad("text");
      const s = String(v);
      const max = spec.type === "string" ? (spec.maxLength ?? 200) : 64;
      if (s.length > max) return fail(`${name} is longer than ${max} characters`);
      return { value: s };
    }
    case "number":
    case "integer": {
      const n = asNumber(v);
      if (n === undefined) return bad("a number");
      if (spec.type === "integer" && !Number.isInteger(n)) return bad("a whole number");
      if (spec.min !== undefined && n < spec.min) return fail(`${name} must be at least ${spec.min}`);
      if (spec.max !== undefined && n > spec.max) return fail(`${name} must be at most ${spec.max}`);
      return { value: n };
    }
    case "boolean":
      if (typeof v === "boolean") return { value: v };
      if (v === "true" || v === "1" || v === 1) return { value: true };
      if (v === "false" || v === "0" || v === 0) return { value: false };
      return bad("true or false");
    case "color": {
      const s = typeof v === "string" ? v.trim() : "";
      if (!COLOR.test(s)) return bad("a hex colour like #FF5A36");
      return { value: s.toUpperCase() };
    }
    case "enum": {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (spec.options.includes(s)) return { value: s };
      const aliased = spec.aliases && Object.hasOwn(spec.aliases, s) ? spec.aliases[s] : undefined;
      if (aliased && spec.options.includes(aliased)) return { value: aliased };
      // "dot" for "dots" and "lines" for "line": agents get the plural wrong more than the word.
      const plural = spec.options.find((o) => s && (o === `${s}s` || `${o}s` === s));
      if (plural) return { value: plural };
      return bad(`one of ${spec.options.join(", ")}`);
    }
    case "strings": {
      const list = asList(v) ?? (typeof v === "string" ? v.split("|").map((s) => s.trim()) : undefined);
      if (!list || list.some((s) => typeof s !== "string" && typeof s !== "number")) return bad("a list of texts");
      const out = list.map(String);
      const max = spec.maxLength ?? 80;
      if (spec.minItems !== undefined && out.length < spec.minItems) return fail(`${name} needs at least ${spec.minItems} items`);
      if (spec.maxItems !== undefined && out.length > spec.maxItems) return fail(`${name} takes at most ${spec.maxItems} items`);
      const long = out.find((s) => s.length > max);
      if (long !== undefined) return fail(`${name} item "${long.slice(0, 20)}…" is longer than ${max} characters`);
      return { value: out };
    }
    case "points": {
      const list = asList(v);
      if (!list) return bad("a list of {x, y} points (0-1 of the frame)");
      const out: { x: number; y: number }[] = [];
      for (const p of list) {
        const x = asNumber((p as { x?: unknown })?.x);
        const y = asNumber((p as { y?: unknown })?.y);
        if (x === undefined || y === undefined || x < 0 || x > 1 || y < 0 || y > 1) return bad("a list of {x, y} points with x and y between 0 and 1");
        out.push({ x, y });
      }
      if (spec.minItems !== undefined && out.length < spec.minItems) return fail(`${name} needs at least ${spec.minItems} points`);
      if (spec.maxItems !== undefined && out.length > spec.maxItems) return fail(`${name} takes at most ${spec.maxItems} points`);
      return { value: out };
    }
  }
}

/**
 * `raw` checked against the block's parameters and completed with the
 * defaults. Unknown names are refused (never ignored); an empty string or
 * null clears an optional parameter.
 */
export function checkParams(manifest: BlockManifest, raw: Readonly<Record<string, unknown>>): ParamsCheck {
  const specs = allParams(manifest);
  const unknown = Object.keys(raw).filter((k) => !(k in specs));
  if (unknown.length > 0) {
    return { ok: false, error: `${manifest.id} has no parameter ${unknown.join(", ")}; it takes ${Object.keys(specs).join(", ")}` };
  }
  const params: Params = {};
  for (const [name, spec] of Object.entries(specs)) {
    const given = raw[name];
    const optional = "optional" in spec && spec.optional === true;
    if (given === undefined || given === null || (given === "" && optional)) {
      if (spec.type !== "media" && spec.default !== undefined) params[name] = structuredClone(spec.default) as ParamValue;
      else if (!optional) return { ok: false, error: `${manifest.id} needs ${name}: ${spec.description}` };
      continue;
    }
    const coerced = coerce(name, spec, given);
    if ("error" in coerced) return { ok: false, error: coerced.error };
    params[name] = coerced.value;
  }
  return { ok: true, params };
}
