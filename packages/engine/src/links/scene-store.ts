/**
 * The project's scenes: the source an agent wrote (create_scene_tool), its
 * params and media, and what its last check found. Kept in the project's
 * `settings` under `zenvi_scenes` (the desktop keeps unknown settings),
 * inside the undo history: creating or changing a scene is one step. A
 * rendered scene's file carries its own copy (zenvi-link.ts sceneLink), so
 * the render stays reproducible if the scene is changed later.
 */

import type { Project } from "../model/types.js";
import type { SceneModuleInfo, SceneProblem } from "../tools/types.js";
import { decodeLinkProps, encodeLinkProps } from "./zenvi-link.js";

export const SCENES_KEY = "zenvi_scenes";

export interface StoredScene {
  id: string;
  name: string;
  code: string;
  params: Record<string, unknown>;
  /** Media name → Project Files id. */
  media: Record<string, string>;
  allowStrobe: boolean;
  /** What the module declared at the last check. */
  info: SceneModuleInfo;
  /** What the last check found. */
  problems: SceneProblem[];
  /** ISO 8601. */
  checkedAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readOne(id: string, raw: unknown): StoredScene | null {
  if (!isRecord(raw) || typeof raw.code !== "string" || !isRecord(raw.info)) return null;
  const stored = raw.info as unknown as SceneModuleInfo;
  if (!(Number(stored.fps) > 0 && Number(stored.duration) > 0) || !Array.isArray(stored.cues)) return null;
  const info: SceneModuleInfo = { ...stored, params: decodeLinkProps(stored.params) };
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : id,
    code: raw.code,
    params: decodeLinkProps(raw.params),
    media: Object.fromEntries(Object.entries(decodeLinkProps(raw.media)).map(([k, v]) => [k, String(v)])),
    allowStrobe: raw.allow_strobe === true,
    info,
    problems: Array.isArray(raw.problems) ? (raw.problems as SceneProblem[]) : [],
    checkedAt: typeof raw.checked_at === "string" ? raw.checked_at : "",
  };
}

/** Every scene of the project, by id. */
export function readScenes(project: Project): StoredScene[] {
  const settings = (project as { settings?: unknown }).settings;
  const all = isRecord(settings) && isRecord(settings[SCENES_KEY]) ? settings[SCENES_KEY] : {};
  return Object.entries(all)
    .map(([id, raw]) => readOne(id, raw))
    .filter((s): s is StoredScene => s !== null);
}

export function readScene(project: Project, id: string): StoredScene | null {
  return readScenes(project).find((s) => s.id === id) ?? null;
}

/** The settings value with `scene` written in (other scenes, and unknown keys of each, kept). */
export function withScene(project: Project, scene: StoredScene): Record<string, unknown> {
  const settings = (project as { settings?: unknown }).settings;
  const all: Record<string, unknown> = isRecord(settings) && isRecord(settings[SCENES_KEY]) ? structuredClone(settings[SCENES_KEY]) : {};
  const own = all[scene.id];
  const prior = isRecord(own) ? own : {};
  all[scene.id] = {
    ...prior,
    name: scene.name,
    code: scene.code,
    // The desktop rewrites strings under path-like keys on save: params and media names are stored escaped when they use one.
    params: encodeLinkProps(scene.params),
    media: encodeLinkProps(scene.media),
    allow_strobe: scene.allowStrobe,
    info: { ...structuredClone(scene.info), params: encodeLinkProps(scene.info.params) },
    problems: structuredClone(scene.problems),
    checked_at: scene.checkedAt,
  };
  return all;
}
