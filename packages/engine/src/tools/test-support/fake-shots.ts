/**
 * A fake ShotHost for tests (used only by `*.test.ts`): every file shows a
 * scripted sequence of "concepts" (one axis each), and a text embeds onto
 * the concepts its words name, so a test knows which moment a query must
 * find and which shots look alike.
 */

import { normalize } from "../../shots/vectors.js";
import type { ShotEmbeddings, ShotHost, ShotModelStatus } from "../types.js";

export const CONCEPTS = ["beach", "city", "hands", "face", "moon", "car", "dog", "cup"] as const;
export type Concept = (typeof CONCEPTS)[number];

/** What a file shows: [from second, concept] steps, ascending. */
export type Script = readonly (readonly [number, Concept])[];

function axis(concept: Concept, tint = 0): Float32Array {
  const v = new Float32Array(CONCEPTS.length + 1);
  v[CONCEPTS.indexOf(concept)] = 1;
  // A small per-file tint, so two files of one concept are alike but not identical.
  v[CONCEPTS.length] = tint;
  return normalize(v);
}

function conceptAt(script: Script, t: number): Concept {
  let at = script[0]![1];
  for (const [from, c] of script) if (t >= from) at = c;
  return at;
}

export interface FakeShotHost extends ShotHost {
  calls: string[];
  ready: boolean;
}

/** `scripts`: path → what it shows; `durations`: path → seconds (default 8); `tints`: path → how far it leans off its concept. */
export function fakeShotHost(scripts: Record<string, Script>, options: { ready?: boolean; durations?: Record<string, number>; tints?: Record<string, number> } = {}): FakeShotHost {
  const cache = new Set<string>();
  const status = (host: FakeShotHost): ShotModelStatus =>
    host.ready ? { ready: true, detail: "fake model is installed" } : { ready: false, detail: "the shot model is not downloaded yet: ask the person, then call embed_media_tool with download=true", downloadMb: 213 };
  const vectorAt = (path: string, t: number): Float32Array => axis(conceptAt(scripts[path] ?? [[0, "dog"]], t), options.tints?.[path] ?? 0);
  const host: FakeShotHost = {
    calls: [],
    ready: options.ready ?? true,
    model: { name: "fake-siglip", version: "1", license: "Apache-2.0", dims: CONCEPTS.length + 1, logitScale: 10, logitBias: -5 },
    async status() {
      return status(host);
    },
    async setup() {
      host.calls.push("setup");
      host.ready = true;
      return status(host);
    },
    async embedFile(path, request): Promise<ShotEmbeddings | null> {
      const key = `${path}@${request.interval}`;
      const cached = cache.has(key);
      if (!cached && request.cachedOnly) return null;
      if (!cached) {
        if (!host.ready) throw new Error(status(host).detail);
        host.calls.push(`embed ${path} ${request.interval}`);
        cache.add(key);
      }
      const duration = options.durations?.[path] ?? 8;
      const times: number[] = [];
      for (let t = 0; t < duration - 1e-9; t += request.interval) times.push(Number(t.toFixed(3)));
      return { times, vectors: times.map((t) => vectorAt(path, t)), cached };
    },
    async embedFrames(path, times) {
      if (!host.ready) throw new Error(status(host).detail);
      host.calls.push(`frames ${path} ${times.map((t) => t.toFixed(2)).join(",")}`);
      return times.map((t) => vectorAt(path, t));
    },
    async embedText(texts) {
      if (!host.ready) throw new Error(status(host).detail);
      return texts.map((text) => {
        const v = new Float32Array(CONCEPTS.length + 1);
        CONCEPTS.forEach((c, i) => {
          if (text.toLowerCase().includes(c)) v[i] = 1;
        });
        // Text and picture embeddings of SigLIP meet at small cosines; keep that.
        v[CONCEPTS.length] = 3;
        return normalize(v);
      });
    },
  };
  return host;
}
