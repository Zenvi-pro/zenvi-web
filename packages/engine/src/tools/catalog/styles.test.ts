import { describe, expect, it } from "vitest";
import { BRIEF_KEY } from "../../brief/brief.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { STYLE_FILES } from "../../styles/library.gen.js";
import { STYLE_TEXT_MAX, TECHNIQUE_TEXT_MAX, compactStyle, compactTechnique, rankStyles, styleChecklist, styleFinishCalls } from "../../styles/recipe.js";
import { normalizeArgs } from "../coerce.js";
import { isLookId } from "../luts.js";
import { getTool, runTool } from "../registry.js";
import type { ToolHost } from "../types.js";
import { fakeHost } from "../test-support/fake-host.js";
import { audioInfo, media, videoInfo } from "../test-support/fixture.js";

function project(files: { path: string; seconds: number; audio?: boolean }[] = [], size: [number, number] = [1080, 1920]): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id: "STYLETOOLS" }));
  doc.transaction("fixture", (tx) => {
    tx.replace(["width"], size[0]);
    tx.replace(["height"], size[1]);
    files.forEach((f, i) => addFile(tx, media(f.path, f.audio ? audioInfo(f.path, f.seconds) : videoInfo(f.path, f.seconds, { width: size[0], height: size[1], has_audio: false })), { id: `FILE${i}XXXXXX`.slice(0, 10) }));
  });
  return doc;
}

const run = (doc: ProjectDocument, tool: string, args: Record<string, unknown>) => runTool({ doc, host: fakeHost() as ToolHost }, tool, args);

describe("the styles library as text", () => {
  it("cuts every style to ~1.5 k tokens with its beats, tool sequence and checklist", () => {
    for (const file of STYLE_FILES.filter((f) => f.kind === "style")) {
      const text = compactStyle(file, 30);
      expect(text.length, file.id).toBeLessThanOrEqual(STYLE_TEXT_MAX + 2);
      expect(text, file.id).toMatch(/## Beats/);
      expect(text, file.id).toMatch(/## Tool sequence/);
      expect(text, file.id).toMatch(/## Finish checklist/);
      expect(styleChecklist(file).length, file.id).toBeGreaterThan(0);
    }
  });

  it("times the beats for the asked length from the nearest structure row", () => {
    const file = STYLE_FILES.find((f) => f.id === "sports-hype-edit")!;
    expect(compactStyle(file, 15)).toContain("(15 s) 0-4 cold open");
    // 20 s is nearest the 15 s row: its times scale by 4/3, the shot lengths inside a beat stay.
    const twenty = compactStyle(file, 20);
    expect(twenty).toContain("(20 s, scaled from the 15 s row) 0-5.3 cold open");
    expect(twenty).toContain("body, 0.8-1.6 s shots");
  });

  it("reads the beats from a row a beat with a column a length, and from a column a beat", () => {
    // "| beat | 15 s | 30 s |": the nearest column, one beat a line, its times scaled; empty cells dropped.
    const trailer = compactStyle(STYLE_FILES.find((f) => f.id === "movie-game-trailer")!, 20);
    expect(trailer).toContain("(20 s, scaled from the 15 s column)\n- Cold open: 1-3 slow shots, fade from black, rumble: 0-4\n");
    expect(trailer).toContain("- Black, then title card with sub drop: 18-20");
    const review = compactStyle(STYLE_FILES.find((f) => f.id === "tech-review")!, 15);
    expect(review).toContain("(15 s (short))\n- Verdict hook");
    expect(review).not.toMatch(/: [-–—]\n/);
    // "| length | hook | setup / claim |": each time after its beat's name.
    const essay = compactStyle(STYLE_FILES.find((f) => f.id === "video-essay-explainer")!, 20);
    expect(essay).toContain("(20 s, scaled from the 15 s row) hook 0-2.7 s · setup / claim 2.7-5.3 s · proof run 5.3-10.7 s");
    // Counts are not times: "3 x 3 s" stays.
    expect(compactStyle(STYLE_FILES.find((f) => f.id === "science-curiosity")!, 20)).toMatch(/equal steps \d+(\.\d)?-\d+(\.\d)? s \(3 x 3 s\)/);
  });

  it("cuts every technique, family and method to ~1.2 k tokens", () => {
    for (const file of STYLE_FILES.filter((f) => f.kind !== "style")) {
      const text = compactTechnique(file);
      expect(text.length, file.id).toBeLessThanOrEqual(TECHNIQUE_TEXT_MAX + 2);
      if (file.kind === "technique") expect(text, file.id).toMatch(/## Build it in Zenvi/);
    }
  });

  it("reads a style's own finish calls (styles and director recipes write them two ways)", () => {
    const sports = STYLE_FILES.find((f) => f.id === "sports-hype-edit")!;
    expect(styleFinishCalls(sports)).toEqual([
      { tool: "unify_grade_tool", args: { look: "teal_cinema", look_intensity: 0.5 } },
      { tool: "auto_sound_design_tool", args: { intensity: "hype", density: "every_cut" } },
      { tool: "master_audio_tool", args: { preset: "social", genre: "hype" } },
    ]);
    const recipe = STYLE_FILES.find((f) => f.id === "hype-reel")!;
    expect(styleFinishCalls(recipe)).toContainEqual({ tool: "master_audio_tool", args: { preset: "social", genre: "hype", iterate: true } });
  });

  it("writes finish calls their tools accept, for every style (the builders hand them on as next_calls)", () => {
    for (const file of STYLE_FILES.filter((f) => f.kind === "style")) {
      for (const { tool, args } of styleFinishCalls(file, isLookId)) {
        const spec = getTool(tool)!;
        expect(spec.input.safeParse(normalizeArgs(spec.inputSchema, args)).success, `${file.id} ${tool} ${JSON.stringify(args)}`).toBe(true);
      }
    }
  });

  it("ranks styles by the request's words and the bin, a reason for each point", () => {
    const noBin = { videos: 0, images: 0, voice: false, music: false };
    expect(rankStyles("a hype edit of my skate clips to this song", STYLE_FILES, { ...noBin, videos: 12, music: true }).map((p) => p.id)).toContain("hype-reel");
    const talk = rankStyles("cut my interview into a short", STYLE_FILES, { ...noBin, voice: true, videos: 1 });
    expect(talk[0]!.id).toBe("kinetic-captions");
    expect(talk[0]!.reasons.join(" ")).toMatch(/"interview"/);
    expect(talk[0]!.reasons.join(" ")).toMatch(/voice/);
  });
});

describe("find_style_tool, get_style_tool, get_technique_tool", () => {
  it("finds three styles for a request and the bin, and names the next call", async () => {
    const doc = project([{ path: "/m/podcast_interview.mp4", seconds: 60 }, { path: "/m/voice.wav", seconds: 60, audio: true }]);
    const before = doc.project;
    const result = await run(doc, "find_style_tool", { request: "captions for my podcast clip" });
    expect(result.ok).toBe(true);
    const styles = (result.data?.data as { styles: { id: string }[] }).styles;
    expect(styles).toHaveLength(3);
    expect(styles.map((s) => s.id)).toContain("podcast-clip-vertical");
    expect(result.data?.summary).toMatch(/Next: get_style_tool \{"style": "/);
    expect(result.data?.undoSteps).toBe(0);
    expect(doc.project).toBe(before);
  });

  it("suggests a length get_style_tool takes when the timeline is shorter than 3 s", async () => {
    const doc = project([{ path: "/m/a.mp4", seconds: 5 }]);
    doc.transaction("clip", (tx) => {
      addClip(tx, { fileId: "FILE0XXXXX", position: 0, layer: tx.project.layers[0]!.number, start: 0, end: 1.5, id: "CLIPAXXXXX" });
    });
    const result = await run(doc, "find_style_tool", { request: "a hype reel" });
    expect(result.data?.summary).toMatch(/"length_seconds": 3\}/);
  });

  it("gives a style's recipe for the asked length, else the brief's", async () => {
    const doc = project();
    const asked = await run(doc, "get_style_tool", { style: "sports-hype-edit", length_seconds: 15 });
    expect(asked.data?.summary).toContain("(15 s) 0-4 cold open");
    expect((asked.data?.data as { finish_calls: unknown[] }).finish_calls).toHaveLength(3);

    doc.setUntracked(["settings"], { [BRIEF_KEY]: { goal: "g", platform: "p", aspect: "9:16", length_seconds: 30, style: "sports-hype-edit", techniques: [], hook: "h", beats: [{ start: 0, end: 30, name: "all" }], shots: [], motifs: [], storyboard: [], direction: [], checklist: [], missing: [] } });
    const fromBrief = await run(doc, "get_style_tool", {});
    expect(fromBrief.data?.summary).toContain("(30 s) 0-6 cold open");
  });

  it("refuses an unknown id with the nearest ones and points a technique at its tool", async () => {
    const doc = project();
    const unknown = await run(doc, "get_style_tool", { style: "sports-hype" });
    expect(unknown.data?.status).toBe("refused");
    expect(unknown.data?.summary).toMatch(/^Error: no style sports-hype\. Near: sports-hype-edit, hype-reel;/);
    const technique = await run(doc, "get_style_tool", { style: "accelerating-cut-length-ramp" });
    expect(technique.data?.summary).toMatch(/is a technique, not a style: get_technique_tool/);
    const steps = await run(doc, "get_technique_tool", { technique: "accelerating-cut-length-ramp" });
    expect(steps.ok).toBe(true);
    expect(steps.data?.summary).toMatch(/## Build it in Zenvi\n1\. Lengths first/);
    const style = await run(doc, "get_technique_tool", { technique: "hype-reel" });
    expect(style.data?.summary).toMatch(/is a style: get_style_tool/);
  });
});
