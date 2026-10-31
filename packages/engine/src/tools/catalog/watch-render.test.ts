/**
 * watch_render_tool through runTool: the host's watch is a stub returning a
 * critique, so what is tested is the tool's part: the length check, the
 * timeline notes it sends, each issue placed on the open timeline with the
 * tools that fix it, and refusals in words.
 */

import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { reviewTimeline } from "../../review/timeline.js";
import { WatchError, type WatchCritique, type WatchRequest } from "../../review/watch.js";
import { runTool } from "../registry.js";
import { EditHarness } from "../test-support/edit-harness.js";
import { repeatedCut } from "../test-support/repeated-cut.js";

type Row = Record<string, unknown>;

function critique(duration: number, overrides: Partial<WatchCritique> = {}): WatchCritique {
  return {
    model: "gemini-test",
    duration,
    hasAudio: true,
    verdict: "Tidy, but the cuts are silent.",
    overall: 5.5,
    wouldPost: false,
    scores: { hook: 6, pacing: 5, structure: 6, motion: 5, transitions: 4, typography: null, look: 6, sound_design: 3, mix: 6, ending: 5 },
    issues: [
      { start: 2.0, end: 2.4, dimension: "sound_design", severity: "high", problem: "The cut at 2 s is silent.", fix: "Add a whoosh 80 ms before the cut at 2.0 s." },
      { start: 4.1, end: 5.0, dimension: "pacing", severity: "medium", problem: "Shot 3 drags.", fix: "Trim shot 3 by 0.5 s." },
      { start: 0, end: 0.5, dimension: "look", severity: "low", problem: "The first shot is flat.", fix: "Raise contrast on shot 1." },
    ],
    strengths: ["Clean framing."],
    usage: { inputTokens: 1200, outputTokens: 600, credits: 1 },
    via: "backend",
    ...overrides,
  };
}

function watching(ed: EditHarness, duration: number, answer: (path: string, request: WatchRequest) => Promise<WatchCritique>): WatchRequest[] {
  const asked: WatchRequest[] = [];
  const probe = ed.host.media!.probe;
  ed.host.media!.probe = async (path) => ({ ...(await probe(path)), duration });
  ed.host.watch = {
    watch: async (path, request = {}) => {
      asked.push(request);
      return answer(path, request);
    },
  };
  return asked;
}

describe("watch_render_tool", () => {
  it("places each issue on the open timeline with the tools that fix it, and changes nothing", async () => {
    const ed = new EditHarness();
    const doc = new ProjectDocument(repeatedCut(["video"]));
    const length = reviewTimeline(doc.project).range.end;
    const asked = watching(ed, length, async () => critique(length));
    const undo = doc.undoLabels.length;
    const result = await runTool({ doc, host: ed.host }, "watch_render_tool", { path: "out.mp4", brief: "6 s montage", focus: ["sound_design"] });
    const receipt = result.data!;
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(0);
    expect(doc.undoLabels.length).toBe(undo);
    expect(asked[0]).toMatchObject({ brief: "6 s montage", focus: ["sound_design"] });
    expect(asked[0]!.timelineNotes).toMatch(/^shot 1 0\.00-/);
    expect(receipt.summary).toMatch(/^Watched out\.mp4 \(\d+\.\d\ds, with sound\) via the Zenvi backend: overall 5\.5\/10, would not post yet\./);
    expect(receipt.summary).toContain("Scores: hook 6 · pacing 5");
    expect(receipt.summary).not.toContain("typography");
    expect(receipt.summary).toMatch(/1\. HIGH sound_design 2\.00s-2\.40s: The cut at 2 s is silent\. Fix: Add a whoosh .* On the timeline: "[^"]+" \(CLIP\w+, /);
    expect(receipt.summary).toContain("Tools: add_sfx_tool, spot_sound_tool, auto_sound_design_tool");
    const data = receipt.data as Row;
    const issues = data.issues as Row[];
    expect(data.on_timeline).toBe(true);
    expect((issues[0]!.shots as Row[]).length).toBeGreaterThan(0);
    expect(issues[1]!.tools).toEqual(["trim_clip_tool", "detect_beats_tool", "speed_ramp_tool"]);
    expect(issues[2]!.tools).toEqual(["color_grade_clip_tool", "unify_grade_tool", "apply_fx_tool"]);
  });

  it("does not place issues on a timeline the render is not of", async () => {
    const ed = new EditHarness();
    const doc = new ProjectDocument(repeatedCut(["video"]));
    const other = reviewTimeline(doc.project).range.end + 3;
    const asked = watching(ed, other, async () => critique(other));
    const receipt = (await runTool({ doc, host: ed.host }, "watch_render_tool", { path: "other.mp4" })).data!;
    expect(asked[0]!.timelineNotes).toBeUndefined();
    expect((receipt.data as Row).on_timeline).toBe(false);
    expect(((receipt.data as Row).issues as Row[])[0]!.shots).toEqual([]);
    expect(receipt.summary).toContain("not the length of the open timeline");
  });

  it("refuses a render over 90 s before sending it, and passes the host's refusals on in words", async () => {
    const ed = new EditHarness();
    const asked = watching(ed, 120, async () => critique(120));
    const long = (await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { path: "long.mp4" })).data!;
    expect(long.status).toBe("refused");
    expect(long.summary).toContain("at most 90 s");
    expect(asked).toHaveLength(0);

    watching(ed, 9, async () => {
      throw new WatchError("sign_in", "watching a render needs a Zenvi sign-in: run `zenvi login`");
    });
    const signedOut = (await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { path: "out.mp4" })).data!;
    expect(signedOut.status).toBe("refused");
    expect(signedOut.summary).toBe("Error: watching a render needs a Zenvi sign-in: run `zenvi login`");

    watching(ed, 9, async () => {
      throw new WatchError("failed", "the watch failed (HTTP 502): Gemini returned no critique.");
    });
    expect((await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { path: "out.mp4" })).data!.status).toBe("error");
  });

  it("reads the length the way the watch host opens the file, not media.probe's way", async () => {
    const ed = new EditHarness();
    const asked = watching(ed, 9, async () => critique(120));
    const probed: string[] = [];
    const probe = ed.host.media!.probe;
    ed.host.media!.probe = async (path) => (probed.push(path), probe(path));
    ed.host.watch!.length = async () => 120;
    const long = (await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { path: "renders/out.mp4" })).data!;
    expect(long.status).toBe("refused");
    expect(long.summary).toContain("at most 90 s");
    expect(asked).toHaveLength(0);
    expect(probed).toHaveLength(0);
  });

  it("is unavailable where the host cannot watch, naming where it works", async () => {
    const ed = new EditHarness();
    delete ed.host.watch;
    const receipt = (await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { path: "out.mp4" })).data!;
    expect(receipt.summary).toMatch(/^Error: watch_render_tool is not available in this Zenvi surface: it needs watching a render with sound/);
  });


  it("watches a render by id where the host has one (Zenvi Cloud), and asks for exactly one of path and render_id", async () => {
    const ed = new EditHarness();
    const byId: string[] = [];
    watching(ed, 9, async () => critique(9));
    ed.host.watch!.watchRender = async (renderId) => {
      byId.push(renderId);
      return critique(9);
    };
    const receipt = (await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { render_id: "r_0123456789abcdef" })).data!;
    expect(byId).toEqual(["r_0123456789abcdef"]);
    expect(receipt.summary).toMatch(/^Watched render r_0123456789abcdef \(9\.00s, with sound\)/);
    expect((receipt.data as Row).render_id).toBe("r_0123456789abcdef");

    const both = (await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { path: "out.mp4", render_id: "r_0123456789abcdef" })).data!;
    expect(both.summary).toMatch(/^Error: pass either path .* or render_id/);
    expect((await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", {})).data!.status).toBe("refused");

    delete ed.host.watch!.watchRender;
    const local = (await runTool({ doc: ed.doc, host: ed.host }, "watch_render_tool", { render_id: "r_0123456789abcdef" })).data!;
    expect(local.summary).toBe("Error: render_id is for Zenvi Cloud's render_project; here pass path, the file render/export wrote.");
    expect(byId).toHaveLength(1);
  });

  it("does not presume review_render_tool exists", async () => {
    const { getTool } = await import("../registry.js");
    expect(getTool("watch_render_tool")!.description).toContain("where review_render_tool exists");
  });
});
