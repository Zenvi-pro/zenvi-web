/**
 * Cross-host handoffs (SPEC §3.5, §3.6). Every conversion of the Zenvi
 * project format lives in the desktop app (zenvi-core): `zenvi mcp` lists
 * the desktop's handoff tools with the desktop's own schemas (vendored in
 * desktop-handoff-tools.gen.json by scripts/sync-desktop-handoff-tools.mjs)
 * and forwards them; it also chains Adobe and desktop tools for the way back
 * (bring_from_after_effects / bring_from_premiere). This module holds the
 * pure parts: the tool list, path arguments, and link metadata.
 */

import { homedir } from "node:os";
import path from "node:path";
import type { JsonSchemaObject } from "@zenvi/engine/tools";
import handoff from "./desktop-handoff-tools.gen.json" with { type: "json" };

export interface DesktopHandoffTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean };
  /** zenvi-core = generated from the desktop's manifest; spec = written from SPEC §3.5 until the desktop has it. */
  source: "zenvi-core" | "spec";
}

export const DESKTOP_HANDOFF_TOOLS: readonly DesktopHandoffTool[] = handoff.tools as unknown as DesktopHandoffTool[];

/** Argument names that hold file system paths. */
const PATH_ARGS = new Set(["path", "project_dir", "output_dir", "output_path"]);

/**
 * Paths in a handoff call, made absolute against the MCP server's working
 * folder (`~` = home): the desktop app runs elsewhere and would resolve a
 * relative path against its own folder.
 */
export function resolvePathArgs(args: Record<string, unknown>, cwd: string, home: string = homedir()): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const [key, value] of Object.entries(args)) {
    if (!PATH_ARGS.has(key) || typeof value !== "string" || !value.trim()) continue;
    const text = value.trim();
    const expanded = text === "~" ? home : text.startsWith("~/") || text.startsWith("~\\") ? path.join(home, text.slice(2)) : text;
    out[key] = path.isAbsolute(expanded) || path.win32.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  }
  return out;
}

/** The first candidate argument name a tool's schema declares (orchestrations follow the live host's names). */
export function declaredName(properties: Record<string, unknown>, candidates: readonly string[]): string | undefined {
  return candidates.find((name) => Object.prototype.hasOwnProperty.call(properties, name));
}

/** Frame rate as SPEC §3.6 `{num, den}`; NTSC rates become /1001. */
export function fpsFraction(fps: unknown): { num: number; den: number } | undefined {
  if (fps && typeof fps === "object") {
    const { num, den } = fps as { num?: unknown; den?: unknown };
    if (typeof num === "number" && typeof den === "number" && num > 0 && den > 0) return { num, den };
    return undefined;
  }
  const value = Number(fps);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (Number.isInteger(value)) return { num: value, den: 1 };
  const ntsc = Math.round(value) * 1000;
  if (Math.abs(value - ntsc / 1001) < 0.01) return { num: ntsc, den: 1001 };
  return { num: Math.round(value * 1000), den: 1000 };
}

const CODECS = ["prores4444", "h264", "qtrle"];

/**
 * The rendered file and its `zenvi_link` (SPEC §3.6, kind aftereffects) from
 * an `ae_render_for_zenvi` receipt: the receipt's own `link` when Zenvi Link
 * sends one, else built from `{path, comp_id, comp_name, project, width,
 * height, fps, duration, codec}` (SPEC §3.4). Never uses keys named
 * path/image/resource inside the link (the .zvn loader rewrites those).
 */
export function aeRenderLink(data: Record<string, unknown>, alpha: boolean | undefined): { path: string; link: Record<string, unknown> } | undefined {
  const file = typeof data.path === "string" && data.path ? data.path : undefined;
  if (!file) return undefined;
  if (data.link && typeof data.link === "object" && !Array.isArray(data.link)) {
    return { path: file, link: { ...(data.link as Record<string, unknown>), kind: "aftereffects" } };
  }
  const fps = fpsFraction(data.fps);
  const duration = Number(data.duration);
  const codec =
    typeof data.codec === "string" && CODECS.includes(data.codec)
      ? data.codec
      : alpha
        ? "prores4444"
        : /\.mp4$/i.test(file)
          ? "h264"
          : undefined;
  const render: Record<string, unknown> = {};
  if (codec) render.codec = codec;
  if (typeof data.width === "number") render.width = data.width;
  if (typeof data.height === "number") render.height = data.height;
  if (fps) render.fps = fps;
  if (fps && Number.isFinite(duration) && duration > 0) render.duration_frames = Math.round((duration * fps.num) / fps.den);
  return {
    path: file,
    link: {
      version: 1,
      kind: "aftereffects",
      source: {
        project_dir: null,
        entry: null,
        composition: typeof data.comp_name === "string" ? data.comp_name : null,
        composition_key: typeof data.comp_id === "number" ? data.comp_id : null,
        file: null,
        line: null,
        aep: typeof data.project === "string" ? data.project : null,
      },
      props: {},
      render,
    },
  };
}

/** The XML file a `premiere_export_xml` receipt names. */
export function exportedXmlPath(data: Record<string, unknown>): string | undefined {
  for (const key of ["path", "output", "xml", "file"]) {
    const value = data[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}
