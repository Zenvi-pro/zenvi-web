/**
 * Object ids, generated like the desktop's `ProjectDataStore.generate_id`
 * (zenvi-core src/classes/project_data.py:1750): 10 random characters from
 * `A-Z0-9`. Every clip, file, effect, transition, track and marker id, and the
 * project id itself, uses this format.
 */

import type { Project } from "./types.js";

export const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const ID_LENGTH = 10;

type RandomSource = (bytes: Uint8Array) => Uint8Array;

function defaultRandom(): RandomSource {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return (bytes) => c.getRandomValues!(bytes);
  return (bytes) => {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  };
}

const random = defaultRandom();

/** 252 = 7 × 36: bytes at or above it are rejected so every character is equally likely. */
const REJECT_AT = 252;

function randomChars(length: number): string {
  let out = "";
  const buffer = new Uint8Array(length * 2);
  while (out.length < length) {
    random(buffer);
    for (const byte of buffer) {
      if (byte >= REJECT_AT) continue;
      out += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * A new random id. When `taken` is given, ids it reports as used are skipped,
 * so the result is unique within whatever `taken` covers (usually a project).
 */
export function generateId(taken?: (id: string) => boolean, length: number = ID_LENGTH): string {
  for (;;) {
    const id = randomChars(length);
    if (!taken || !taken(id)) return id;
  }
}

/** True when `value` looks like a desktop-generated id. */
export function isGeneratedId(value: string): boolean {
  return value.length === ID_LENGTH && [...value].every((ch) => ID_ALPHABET.includes(ch));
}

/** Every id used anywhere in the project: files, clips, clip effects, transitions, tracks, markers. */
export function collectIds(project: Project): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string" && value) ids.add(value);
  };
  add(project.id);
  for (const file of project.files ?? []) add(file.id);
  for (const clip of project.clips ?? []) {
    add(clip.id);
    for (const effect of clip.effects ?? []) add(effect.id);
  }
  for (const transition of project.effects ?? []) add(transition.id);
  for (const layer of project.layers ?? []) add(layer.id);
  for (const marker of project.markers ?? []) add(marker.id);
  return ids;
}

/**
 * An id generator that never repeats an id already in `project` or one it
 * handed out before. Use one per operation that creates several objects.
 */
export function idFactory(project: Project): () => string {
  const taken = collectIds(project);
  return () => {
    const id = generateId((candidate) => taken.has(candidate));
    taken.add(id);
    return id;
  };
}
