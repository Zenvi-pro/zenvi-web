/**
 * fork_project_tool, compare_renders_tool and pick_best_variant_tool through
 * runTool. The host's judge is a stub that prefers one render (by name),
 * whichever slot it is in, so what is tested is the tools' part: both orders
 * asked, the tournament, the winner adopted as one undo step, refusals
 * before anything is watched.
 */

import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import type { Project } from "../../model/types.js";
import { WATCH_DIMENSION_NAMES, WatchError, type WatchCritique } from "../../review/watch.js";
import type { CompareVerdict } from "../../review/compare.js";
import { runTool } from "../registry.js";
import { EditHarness } from "../test-support/edit-harness.js";
import { repeatedCut } from "../test-support/repeated-cut.js";

type Row = Record<string, unknown>;
const flat = (n: number) => Object.fromEntries(WATCH_DIMENSION_NAMES.map((d) => [d, n])) as CompareVerdict["scores"]["A"];

/** A judge that scores each render by `quality[path]` and names the better one, plus the calls it got. */
function judging(ed: EditHarness, quality: Record<string, number>, lengths: Record<string, number> = {}): string[] {
  const calls: string[] = [];
  ed.host.watch = {
    watch: async () => {
      throw new Error("compare should be used");
    },
    length: async (p) => lengths[p] ?? 12,
    compare: async (first, second) => {
      calls.push(`${first}|${second}`);
      const [a, b] = [quality[first] ?? 5, quality[second] ?? 5];
      return {
        model: "judge-test",
        durations: { A: 12, B: 12 },
        winner: a === b ? "tie" : a > b ? "A" : "B",
        why: "the better one lands its cuts",
        scores: { A: flat(a), B: flat(b) },
        fixes: [
          { video: "A", start: 1, dimension: "sound_design", problem: `${first} has a silent cut`, fix: "Add a whoosh at 1 s." },
          { video: "B", start: 2, dimension: "pacing", problem: `${second} drags`, fix: "Trim shot 2 by 0.4 s." },
        ],
        usage: { inputTokens: 100, outputTokens: 20 },
        via: "gemini",
      };
    },
  };
  return calls;
}

/** Three variant projects that differ in how many clips they keep, opened by path. */
function variantsOn(ed: EditHarness, doc: ProjectDocument): Record<string, Project> {
  const base = doc.project;
  const files: Record<string, Project> = {
    "variants/cut-a.zvn": { ...structuredClone(base), clips: base.clips.slice(0, 1) },
    "variants/cut-b.zvn": { ...structuredClone(base), clips: base.clips.slice(0, 2), id: "OTHERID001" },
    "variants/cut-c.zvn": { ...structuredClone(base), clips: base.clips.slice(1) },
  };
  ed.host.storage!.open = async (p) => {
    const project = files[p];
    if (!project) throw new Error(`no such file: ${p}`);
    return structuredClone(project);
  };
  return files;
}

const THREE = [
  { name: "a", project: "variants/cut-a.zvn", render: "renders/a.mp4" },
  { name: "b", project: "variants/cut-b.zvn", render: "renders/b.mp4" },
  { name: "c", project: "variants/cut-c.zvn", render: "renders/c.mp4" },
];

describe("fork_project_tool", () => {
  it("saves a copy next to the project without an undo step, and refuses to replace a variant", async () => {
    const ed = new EditHarness({ host: { projectPath: "/work/trip.zvn" } });
    const doc = new ProjectDocument(repeatedCut(["video"]));
    const first = (await runTool({ doc, host: ed.host }, "fork_project_tool", { name: "warm-grade" })).data!;
    expect(first.status).toBe("applied");
    expect(first.undoSteps).toBe(0);
    expect((first.data as Row).project).toBe("/work/variants/trip-warm-grade.zvn");
    expect(ed.host.written.get("/work/variants/trip-warm-grade.zvn")).toBe(JSON.stringify(doc.toJSON()));
    expect(doc.undoLabels).toEqual([]);

    const again = (await runTool({ doc, host: ed.host }, "fork_project_tool", { name: "warm-grade" })).data!;
    expect(again.status).toBe("refused");
    expect(again.summary).toContain("replace: true");
    expect((await runTool({ doc, host: ed.host }, "fork_project_tool", { name: "warm-grade", replace: true })).data!.status).toBe("applied");
  });

  it("needs a saved project and a host that can save copies", async () => {
    const unsaved = new EditHarness({ host: { projectPath: null } });
    const receipt = (await runTool({ doc: unsaved.doc, host: unsaved.host }, "fork_project_tool", { name: "v1" })).data!;
    expect(receipt.summary).toMatch(/^Error: save the project first/);
    const noCopy = new EditHarness({ host: { omit: ["storage.saveCopy"] } });
    expect((await runTool({ doc: noCopy.doc, host: noCopy.host }, "fork_project_tool", { name: "v1" })).data!.status).toBe("refused");
  });
});

describe("compare_renders_tool", () => {
  it("asks both orders and reports the winner's fixes with their tools", async () => {
    const ed = new EditHarness();
    const calls = judging(ed, { "renders/a.mp4": 5, "renders/b.mp4": 7 });
    const receipt = (await runTool({ doc: ed.doc, host: ed.host }, "compare_renders_tool", { a: "renders/a.mp4", b: "renders/b.mp4", brief: "15 s reel" })).data!;
    expect(calls).toEqual(["renders/a.mp4|renders/b.mp4", "renders/b.mp4|renders/a.mp4"]);
    expect(receipt.summary).toMatch(/^renders\/b\.mp4 is the better edit \(both orders agree; margin -2 for renders\/a\.mp4\)/);
    expect(receipt.summary).toContain("hook 5 vs 7");
    const data = receipt.data as Row;
    expect(data.winner).toBe("renders/b.mp4");
    // b's fixes from both orders: as B in the first, as A in the second.
    expect((data.fixes as Row[]).map((f) => f.problem)).toEqual(["renders/b.mp4 drags", "renders/b.mp4 has a silent cut"]);
    expect(receipt.summary).toContain("Tools: trim_clip_tool");
  });

  it("refuses a render over 60 s before watching, and falls back to separate watches", async () => {
    const ed = new EditHarness();
    const calls = judging(ed, {}, { "long.mp4": 75 });
    const long = (await runTool({ doc: ed.doc, host: ed.host }, "compare_renders_tool", { a: "long.mp4", b: "b.mp4" })).data!;
    expect(long.status).toBe("refused");
    expect(long.summary).toContain("at most 60 s");
    expect(calls).toEqual([]);

    const critique = (overall: number): WatchCritique => ({
      model: "w",
      duration: 9,
      hasAudio: true,
      verdict: `scored ${overall}`,
      overall,
      wouldPost: false,
      scores: flat(overall),
      issues: [],
      strengths: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      via: "backend",
    });
    ed.host.watch = { watch: async (p) => critique(p === "b.mp4" ? 7 : 5) };
    const separate = (await runTool({ doc: ed.doc, host: ed.host }, "compare_renders_tool", { a: "a.mp4", b: "b.mp4" })).data!;
    expect(separate.summary).toMatch(/^b\.mp4 is the better edit \(on separate watches/);
    expect((separate.data as Row).method).toBe("separate");
  });
});

describe("pick_best_variant_tool", () => {
  it("runs winner-stays-on matches and makes the winner the open project in one undo step", async () => {
    const ed = new EditHarness();
    const doc = new ProjectDocument(repeatedCut(["video"]));
    const id = doc.project.id;
    const files = variantsOn(ed, doc);
    const calls = judging(ed, { "renders/a.mp4": 5, "renders/b.mp4": 8, "renders/c.mp4": 6 });
    const before = structuredClone(doc.project);
    const receipt = (await runTool({ doc, host: ed.host }, "pick_best_variant_tool", { variants: THREE, brief: "trip reel" })).data!;
    // a vs b (b wins), then b vs c: two matches, both orders each.
    expect(calls).toEqual(["renders/a.mp4|renders/b.mp4", "renders/b.mp4|renders/a.mp4", "renders/b.mp4|renders/c.mp4", "renders/c.mp4|renders/b.mp4"]);
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(receipt.summary).toMatch(/^Best of 3: b \(renders\/b\.mp4\)\. b is now the open project/);
    expect(receipt.summary).toContain("Ranking: b > c > a");
    const data = receipt.data as Row;
    expect((data.fixes as Row[]).length).toBeGreaterThan(0);
    expect(doc.project.clips).toEqual(files["variants/cut-b.zvn"]!.clips);
    // The open project keeps its identity.
    expect(doc.project.id).toBe(id);
    expect(doc.undoLabels).toEqual(["Pick best variant: b"]);
    doc.undo();
    expect(doc.project.clips).toEqual(before.clips);
  });

  it("only reports with apply: false, and changes nothing when the open project already is the winner", async () => {
    const ed = new EditHarness();
    const doc = new ProjectDocument(repeatedCut(["video"]));
    variantsOn(ed, doc);
    judging(ed, { "renders/a.mp4": 9 });
    const report = (await runTool({ doc, host: ed.host }, "pick_best_variant_tool", { variants: THREE, apply: false })).data!;
    expect(report.status).toBe("unchanged");
    expect(report.summary).toContain("Nothing changed (apply: false).");
    expect(doc.undoLabels).toEqual([]);

    ed.host.storage!.open = async () => structuredClone(doc.project);
    const same = (await runTool({ doc, host: ed.host }, "pick_best_variant_tool", { variants: THREE })).data!;
    expect(same.status).toBe("unchanged");
    expect(same.summary).toContain("The open project already is a");
  });

  it("refuses before watching when a variant cannot be opened or a render is too long, and changes nothing when a watch fails", async () => {
    const ed = new EditHarness();
    const doc = new ProjectDocument(repeatedCut(["video"]));
    variantsOn(ed, doc);
    const calls = judging(ed, {}, { "renders/c.mp4": 90 });
    const missing = (await runTool({ doc, host: ed.host }, "pick_best_variant_tool", { variants: [THREE[0], { name: "x", project: "variants/x.zvn", render: "renders/x.mp4" }] })).data!;
    expect(missing.summary).toMatch(/^Error: could not open variant x/);
    const long = (await runTool({ doc, host: ed.host }, "pick_best_variant_tool", { variants: THREE })).data!;
    expect(long.summary).toContain("renders/c.mp4 is 90.00s long");
    expect(calls).toEqual([]);

    let n = 0;
    ed.host.watch!.compare = async () => {
      n += 1;
      if (n > 2) throw new WatchError("credits", "not enough Zenvi credits to watch this render.");
      return { model: "m", durations: { A: 9, B: 9 }, winner: "A", why: "", scores: { A: flat(6), B: flat(5) }, fixes: [], usage: { inputTokens: 1, outputTokens: 1 }, via: "gemini" };
    };
    ed.host.watch!.length = async () => 9;
    const broke = (await runTool({ doc, host: ed.host }, "pick_best_variant_tool", { variants: THREE })).data!;
    expect(broke.status).toBe("refused");
    expect(broke.summary).toBe("Error: not enough Zenvi credits to watch this render. (after 1 match(es); nothing changed)");
    expect(doc.undoLabels).toEqual([]);
  });
});
