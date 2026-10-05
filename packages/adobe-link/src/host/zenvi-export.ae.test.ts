/**
 * Compatibility with zenvi-core's After Effects exporter: a real Zenvi export
 * (src/fixtures/zenvi-export/effects.jsx) runs through ae_run_jsx_file, the
 * path File > Send To > After Effects takes.
 */

import path from "node:path";
import { expect, test } from "vitest";
import { PACKAGE_ROOT } from "../host-bundle.js";
import { aeHarness } from "../testing/ae-harness.js";
import { CompItem, FootageItem, PlaceholderSource } from "../testing/ae-mock.js";
import { stripDirectives } from "../testing/extendscript-mock.js";

const FIXTURE = path.join(PACKAGE_ROOT, "src", "fixtures", "zenvi-export", "effects.jsx");

test("a Zenvi export runs through ae_run_jsx_file: one comp, placeholders for missing media, a JSON summary", () => {
  const h = aeHarness();
  const receipt = h.call("ae_run_jsx_file", { path: FIXTURE });
  expect(receipt.status, receipt.summary).toBe("applied");
  const summary = JSON.parse(String(receipt.data.result)) as { status: string; comp: string; layers: number; placeholders: unknown[]; summary: string };
  expect(summary).toMatchObject({ status: "ok", comp: "Promo" });
  expect(summary.layers).toBeGreaterThan(0);
  expect(summary.placeholders.length).toBeGreaterThan(0);
  expect(summary.summary).toMatch(/^Built comp "Promo"/);
  const comps = h.mock.project.allItems.filter((item) => item instanceof CompItem && item.name === "Promo") as CompItem[];
  expect(comps).toHaveLength(1);
  expect(comps[0]?.numLayers).toBe(summary.layers);
  const placeholders = h.mock.project.allItems.filter((item) => item instanceof FootageItem && item.mainSource instanceof PlaceholderSource);
  expect(placeholders.length).toBe(summary.placeholders.length);
});

test("$.evalFile blanks preprocessor directives and keeps line numbers", () => {
  const source = "#target aftereffects\n  #targetengine main\n#include \"x.jsx\"\n#includepath \"a;b\"\n#strict on\n#script Name\nvar x = 1; // #target in a comment stays\nx;";
  const stripped = stripDirectives(source);
  expect(stripped.split("\n")).toEqual(["", "", "", "", "", "", "var x = 1; // #target in a comment stays", "x;"]);
  const h = aeHarness();
  expect(h.host.evaluate(`$.evalFile(new File(${JSON.stringify(h.file("d.jsx", source))}))`)).toBe(1);
});

test("mock APIs the exporter uses: importPlaceholder, Gradient Wipe, Audio Levels on footage with audio", () => {
  const h = aeHarness();
  const placeholder = h.host.evaluate('app.project.importPlaceholder("missing.mp4", 1280, 720, 25, 30).mainSource instanceof PlaceholderSource');
  expect(placeholder).toBe(true);
  // app.effects is a realm array (no ES5 methods), like the DOM's.
  expect(Array.from(h.mock.app.effects, (effect) => effect.matchName)).toContain("ADBE Gradient Wipe");
  const comp = h.mock.addComp();
  const video = h.mock.project.importPlaceholder("silent.mov", 640, 360, 25, 5);
  video.hasAudio = false;
  const sound = h.mock.project.importPlaceholder("speech.mov", 640, 360, 25, 5);
  sound.hasAudio = true;
  comp.layers.add(video);
  comp.layers.add(sound);
  expect(h.host.evaluate('app.project.activeItem.layer(1).property("ADBE Audio Group").property("ADBE Audio Levels").value.length')).toBe(2);
  expect(h.host.evaluate('app.project.activeItem.layer(2).property("ADBE Audio Group")')).toBeNull();
  expect(
    h.host.evaluate('app.project.activeItem.layer(1).property("ADBE Effect Parade").addProperty("ADBE Gradient Wipe").property("Transition Completion").value'),
  ).toBe(0);
});
