import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AE_TOOLS } from "../catalog/aftereffects.js";
import { PACKAGE_ROOT, hostSources } from "../host-bundle.js";
import { TASTE } from "../taste.js";
import { aeHarness } from "../testing/ae-harness.js";

// The AE scripts read TASTE through these names (var TIMING = TASTE.timing, ...).
const ROOTS: Record<string, unknown> = { TASTE, TIMING: TASTE.timing, LAYOUT: TASTE.layout, TYPE: TASTE.type };

describe("TASTE in the After Effects scripts", () => {
  test("every literal TASTE path the scripts read exists in src/taste.ts", () => {
    const pattern = /\b(TASTE|TIMING|LAYOUT|TYPE)((?:\.[A-Za-z_$][\w$]*|\["[^"]+"\]|\[\d+\])+)/g;
    const problems: string[] = [];
    let checked = 0;
    for (const source of hostSources("aeft")) {
      source.text.split("\n").forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        for (const match of line.matchAll(pattern)) {
          const segments = [...(match[2] as string).matchAll(/\.([A-Za-z_$][\w$]*)|\["([^"]+)"\]|\[(\d+)\]/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
          let node: unknown = ROOTS[match[1] as string];
          for (const segment of segments) {
            // Methods on arrays (TASTE...range.length) are not data.
            if (segment === "length" && Array.isArray(node)) break;
            if (node === null || typeof node !== "object" || !(segment in (node as object))) {
              problems.push(`${source.file}:${i + 1} ${match[0]} (no "${segment}")`);
              break;
            }
            node = (node as Record<string, unknown>)[segment];
          }
          checked += 1;
        }
      });
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(40);
  });
});

// Mutating tools that open their own undo groups (registered {mutating: false}), because part of
// their work must not run inside one: Edit > Undo, saving, rendering, handing over to Media Encoder.
const OWN_UNDO_GROUPS = ["ae_render", "ae_render_for_zenvi", "ae_save_project", "ae_undo"];

describe("every After Effects tool, called bare in an empty project", () => {
  test("only the tools that must work outside an undo group skip dispatch's group", () => {
    const registered = aeHarness().host.listTools();
    const skipping = registered.filter((tool) => !tool.mutating).map((tool) => tool.name);
    const readOnly = AE_TOOLS.filter((def) => def.annotations.readOnlyHint === true).map((def) => def.name);
    expect(skipping.filter((name) => !readOnly.includes(name)).sort()).toEqual(OWN_UNDO_GROUPS);
    expect(registered.filter((tool) => tool.mutating && readOnly.includes(tool.name))).toEqual([]);
  });

  test.each(AE_TOOLS.map((def) => [def.name, def.annotations.readOnlyHint === true] as const))("%s keeps undo groups balanced and never reports a refusal as an undo step", (name, readOnly) => {
    const h = aeHarness({ frameWriteDelay: 0 });
    const receipt = h.call(name, {});
    expect(["ok", "applied", "unchanged", "refused", "error"]).toContain(receipt.status);
    expect(h.mock.state.undoDepth).toBe(0);
    if (readOnly) {
      expect(h.mock.state.undoCalls).toEqual([]);
      expect(receipt.undoSteps).toBe(0);
    } else if (name === "ae_undo") {
      // Edit > Undo runs outside any undo group.
      expect(h.mock.state.undoCalls).toEqual([]);
      expect(h.mock.state.commandDepths).toEqual([0]);
    } else if (OWN_UNDO_GROUPS.includes(name)) {
      expect(h.mock.state.undoGroups).toHaveLength(receipt.undoSteps ?? -1);
    } else {
      expect(h.mock.state.undoGroups).toHaveLength(1);
    }
    if (receipt.status === "refused") {
      expect(receipt.undoSteps).toBe(0);
      expect(receipt.summary).toMatch(/^Error: /);
      expect(receipt.error?.code).toMatch(/^[A-Z_]+$/);
    }
  });
});

test("docs/AFTER_EFFECTS.md lists every After Effects tool", () => {
  const doc = readFileSync(path.join(PACKAGE_ROOT, "docs", "AFTER_EFFECTS.md"), "utf8");
  for (const def of AE_TOOLS) expect(doc, def.name).toContain(`| \`${def.name}\` | ${def.title} |`);
});
