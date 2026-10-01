/**
 * TEMPORARY STUB (W6) for engine `parseProject` (engine io/, owned by W1b),
 * which has not landed yet. Uses the engine's parser as soon as it is
 * exported. Only `projectFactory.ts` imports this; delete it once
 * `@zenvi/engine` exports `parseProject`.
 */
import { generateId, type Project } from "@zenvi/engine";

/**
 * Engine `parseProject` once exported, else a structural check that fills
 * missing keys. The engine is loaded lazily so the projects home does not
 * pull every engine module into its bundle.
 */
export async function parseProjectCompat(json: unknown, template: Project): Promise<Project> {
  const ns = (await import("@zenvi/engine")) as unknown as Record<string, unknown>;
  const fn = ns.parseProject as ((json: unknown) => Project) | undefined;
  return typeof fn === "function" ? fn(json) : stubParseProject(json, template);
}

function stubParseProject(json: unknown, template: Project): Project {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("This file is not a Zenvi project.");
  const data = json as Record<string, unknown>;
  for (const key of ["clips", "files", "layers"] as const) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Project "${key}" must be a list.`);
  }
  const merged = { ...template, ...data } as Project;
  if (!Array.isArray(merged.effects)) merged.effects = [];
  if (!Array.isArray(merged.markers)) merged.markers = [];
  if (!merged.history || typeof merged.history !== "object") merged.history = { undo: [], redo: [] };
  if (typeof merged.id !== "string" || merged.id === "T0") merged.id = generateId();
  return merged;
}
