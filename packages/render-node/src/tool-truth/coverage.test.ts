/**
 * The tool truth gate (no media, runs in milliseconds): every argument of
 * every mutating tool, every effect parameter and every clip property is
 * either proven by a case or classified with a reason. A new tool argument
 * fails here until someone proves it or says why it cannot show.
 */

import { EFFECTS } from "@zenvi/engine";
import { allTools, settableClipPropertyKeys } from "@zenvi/engine/tools";
import { describe, expect, it } from "vitest";
import { allCases } from "./cases/index.js";
import { CLIP_PROPERTY_CASES, CLIP_PROPERTY_EXEMPT } from "./cases/clip-props.js";
import { COMMON_EXEMPT, COMMON_PARAM_CASES, EFFECT_EXEMPT, EFFECT_INERT, IDENTITY_DEFAULTS, matrixParams, rendersEffect } from "./cases/effects.js";
import { BACKLOG, catalogParams, classify, OFFSCREEN, paramNoteKeys, provenIndex } from "./coverage.js";
import { KNOWN_FAILURES } from "./ledger.js";

const cases = allCases();
const proven = provenIndex(cases);
const toolNames = new Set(allTools.map((t) => t.name));

describe("tool truth coverage", () => {
  it("classifies every argument of every mutating tool", () => {
    const unclassified = catalogParams()
      .filter(({ tool, param }) => !classify(tool, param, proven))
      .map(({ tool, param }) => `${tool}.${param}`);
    expect(unclassified, "prove these with a case (cases/*.ts) or classify them in coverage.ts").toEqual([]);
  });

  it("has no stale entries", () => {
    const params = new Set(catalogParams().map(({ tool, param }) => `${tool} ${param}`));
    const stale: string[] = [];
    for (const tool of Object.keys(OFFSCREEN)) if (!toolNames.has(tool)) stale.push(`OFFSCREEN.${tool}`);
    for (const [tool, entry] of Object.entries(BACKLOG)) {
      if (!toolNames.has(tool)) stale.push(`BACKLOG.${tool}`);
      if (entry.params === "*") continue;
      for (const param of entry.params) {
        if (!params.has(`${tool} ${param}`)) stale.push(`BACKLOG.${tool}.${param} (no such argument)`);
        if (proven.has(`${tool} ${param}`)) stale.push(`BACKLOG.${tool}.${param} (proven now: delete it)`);
      }
    }
    for (const key of paramNoteKeys()) if (!params.has(key.replace(".", " "))) stale.push(`PARAM_NOTES.${key} (no such argument)`);
    for (const c of cases) if (!toolNames.has(c.tool)) stale.push(`case ${c.id} (no such tool)`);
    const ids = new Set(cases.map((c) => c.id));
    for (const id of Object.keys(KNOWN_FAILURES)) if (!ids.has(id) && !id.includes("=")) stale.push(`KNOWN_FAILURES ${id}`);
    expect(stale).toEqual([]);
  });

  it("covers every parameter of every effect the renderers draw", () => {
    const missing: string[] = [];
    for (const effect of EFFECTS) {
      if (!rendersEffect(effect)) continue;
      for (const param of matrixParams(effect)) {
        const key = `${effect.className}.${param.key}`;
        const hasCase = cases.some((c) => c.param === `properties.${key}`);
        if (!hasCase && !EFFECT_EXEMPT.has(key)) missing.push(key);
      }
      for (const param of effect.params.filter((p) => p.common && !p.readonly)) {
        if (!(param.key in COMMON_PARAM_CASES) && !COMMON_EXEMPT.has(param.key)) missing.push(`(EffectBase).${param.key}`);
      }
    }
    expect([...new Set(missing)], "add a case (cases/effects.ts CONTEXT/VALUES) or an EFFECT_EXEMPT reason").toEqual([]);
    for (const key of [...EFFECT_EXEMPT.keys(), ...EFFECT_INERT.keys()]) {
      const [className, paramKey] = key.split("=")[0]!.split(".") as [string, string];
      expect(EFFECTS.find((e) => e.className === className)?.params.some((p) => p.key === paramKey), key).toBe(true);
    }
    for (const className of IDENTITY_DEFAULTS.keys()) expect(EFFECTS.some((e) => e.className === className), className).toBe(true);
  });

  it("lists why the effects the renderers do not draw have no cases", () => {
    const undrawn = EFFECTS.filter((e) => !rendersEffect(e)).map((e) => e.className);
    // OpenCV analysis effects (Tracker, Stabilizer, ObjectDetection, ObjectMask) need the desktop's
    // ProcessEffect dialog; Outline is kept for the desktop to draw (registry.ts DIALOG_EFFECTS / OPENCV_EFFECTS).
    expect(undrawn.sort()).toEqual(["ObjectDetection", "ObjectMask", "Outline", "Stabilizer", "Tracker"]);
  });

  it("covers every clip property", () => {
    const missing = [...settableClipPropertyKeys(), "id", "duration", "position", "start", "end", "layer"].filter(
      (key) => !(key in CLIP_PROPERTY_CASES) && !CLIP_PROPERTY_EXEMPT.has(key),
    );
    expect(missing, "add a case to CLIP_PROPERTY_CASES or a CLIP_PROPERTY_EXEMPT reason").toEqual([]);
  });
});
