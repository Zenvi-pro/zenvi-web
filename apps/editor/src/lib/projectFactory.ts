/**
 * Creating, importing and storing local projects.
 */
import { createProject, DEFAULT_PROFILE_DESCRIPTION, findProfile, PROFILES, type Profile, type Project } from "@zenvi/engine";
import { parseProjectCompat } from "./engineStubs";
import { describeProject, newLocalId, projectRepository, type LocalProjectMeta } from "./storage/projects";

export interface ProfilePreset {
  id: string;
  label: string;
  hint: string;
  /** Profile description (what the project stores). */
  profile: string;
  shape: "landscape" | "portrait" | "square";
}

/** The formats people pick most, first on the home page (brief: 1080p30, 4K, 9:16, square, 720p). */
export const COMMON_PRESETS: readonly ProfilePreset[] = [
  { id: "1080p30", label: "HD 1080p", hint: "1920 × 1080 · 30 fps", profile: "HD 1080p 30 fps", shape: "landscape" },
  { id: "4k30", label: "4K UHD", hint: "3840 × 2160 · 30 fps", profile: "4K UHD 2160p 30 fps", shape: "landscape" },
  { id: "vertical", label: "Vertical", hint: "1080 × 1920 · 9:16", profile: "Vertical HD 1080p 30 fps", shape: "portrait" },
  { id: "square", label: "Square", hint: "1080 × 1080 · 1:1", profile: "Square 1080p 30 fps", shape: "square" },
  { id: "720p30", label: "HD 720p", hint: "1280 × 720 · 30 fps", profile: "HD 720p 30 fps", shape: "landscape" },
];

/** Resolve a preset or description to a real profile, falling back by size and rate. */
export function resolveProfile(descriptionOrKey: string, fallback?: { width: number; height: number; fps: number }): Profile {
  const found = findProfile(descriptionOrKey);
  if (found) return found;
  if (fallback) {
    const byShape = PROFILES.find(
      (p) => !p.legacy && p.width === fallback.width && p.height === fallback.height && Math.abs(p.fps.num / p.fps.den - fallback.fps) < 0.01,
    );
    if (byShape) return byShape;
  }
  return findProfile(DEFAULT_PROFILE_DESCRIPTION) ?? PROFILES[0]!;
}

const PRESET_FALLBACK: Record<string, { width: number; height: number; fps: number }> = {
  "1080p30": { width: 1920, height: 1080, fps: 30 },
  "4k30": { width: 3840, height: 2160, fps: 30 },
  vertical: { width: 1080, height: 1920, fps: 30 },
  square: { width: 1080, height: 1080, fps: 30 },
  "720p30": { width: 1280, height: 720, fps: 30 },
};

export function presetProfile(preset: ProfilePreset): Profile {
  return resolveProfile(preset.profile, PRESET_FALLBACK[preset.id]);
}

export function createProjectFromProfile(profile: Profile): Project {
  return createProject({ profile });
}

export function parseProjectJson(json: unknown): Project {
  return parseProjectCompat(json, createProject({ profile: resolveProfile(DEFAULT_PROFILE_DESCRIPTION) }));
}

function freshMeta(id: string, name: string, project: Project, source: LocalProjectMeta["source"]): LocalProjectMeta {
  const now = Date.now();
  return { id, name, createdAt: now, updatedAt: now, openedAt: now, source, ...describeProject(project) };
}

/** Create and store a new empty local project. Returns its storage id. */
export async function createLocalProject(profile: Profile, name = "Untitled project"): Promise<string> {
  const project = createProjectFromProfile(profile);
  const id = newLocalId();
  await projectRepository().save(freshMeta(id, name, project, "new"), project);
  return id;
}

/** Store a project opened from a `.zvn` file (desktop project). Returns its storage id. */
export async function importProjectFile(file: File): Promise<string> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name} is not a valid project file.`);
  }
  const project = parseProjectJson(json);
  const id = newLocalId();
  const name = file.name.replace(/\.(zvn|osp|flow|json)$/i, "") || "Imported project";
  await projectRepository().save(freshMeta(id, name, project, "zvn"), project);
  return id;
}

/** Serialize a project for download as a desktop-compatible `.zvn`. */
export function projectFileBlob(project: Project): Blob {
  return new Blob([JSON.stringify(project, null, 1)], { type: "application/json" });
}

/** Drop characters file systems reject (control characters and \\ / : * ? " < > |). */
export function cleanFileName(name: string, replacement: string): string {
  let out = "";
  for (const ch of name) out += ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? replacement : ch;
  return out;
}

export function safeFileName(name: string, extension: string): string {
  const base = cleanFileName(name, " ").replace(/\s+/g, " ").trim() || "Untitled";
  return `${base.slice(0, 120)}.${extension}`;
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function duplicateLocalProject(id: string): Promise<string | null> {
  const stored = await projectRepository().load(id);
  if (!stored) return null;
  const copyId = newLocalId();
  const now = Date.now();
  const { cloud: _cloud, ...rest } = stored.meta;
  await projectRepository().save({ ...rest, id: copyId, name: `${stored.meta.name} copy`, createdAt: now, updatedAt: now, openedAt: undefined }, stored.project);
  return copyId;
}

/** Files handed from the home page to the editor (drop a video to start). */
const pendingImports = new Map<string, File[]>();

export function queueImports(projectId: string, files: File[]): void {
  pendingImports.set(projectId, files);
}

export function takeQueuedImports(projectId: string): File[] {
  const files = pendingImports.get(projectId) ?? [];
  pendingImports.delete(projectId);
  return files;
}
