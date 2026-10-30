import { describe, expect, it } from "vitest";
import { STYLE_RULES } from "../../director/route.js";
import { minimalBrief } from "../../director/brief.js";
import { createProject } from "../../model/defaults.js";
import { readBrief } from "../../brief/brief.js";
import { projectFps } from "../frame-time.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { fixtureDoc } from "../test-support/fixture.js";

type Stage = { stage: string; tool: string; outcome: string; summary: string; undo_steps: number };

describe("produce_video_tool", () => {
  it("refuses replace=false on a full timeline before any stage changes the project", async () => {
    const doc = fixtureDoc();
    const steps = doc.undoLabels.length;
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second hype reel", replace: "false" });
    expect(result.data?.status).toBe("refused");
    expect(result.data?.summary).toMatch(/^Error: the timeline already has \d+ clip\(s\), nothing changed/);
    expect(doc.undoLabels).toHaveLength(steps);
    expect(readBrief(doc.project)).toBeNull();
  });

  it("refuses a length its builders cannot cut instead of throwing or cutting it short", async () => {
    const doc = fixtureDoc();
    const steps = doc.undoLabels.length;
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 15 minute documentary about the sea", replace: true });
    expect(result.data?.status).toBe("refused");
    expect(result.data?.summary).toMatch(/^Error: the request asks for 900 s; produce_video_tool cuts 4-120 s, nothing changed/);
    expect(doc.undoLabels).toHaveLength(steps);
    // The MCP server's minimal brief for the same words is clamped to what a brief holds.
    expect(minimalBrief(createProject({ id: "LONGBRIEF1" }), "a 15 minute documentary").length_seconds).toBe(600);
  });

  it("sets the frame rate the request names even when the frame already matches", async () => {
    const doc = fixtureDoc(createProject({ id: "PRODUCEFPS" }));
    expect(projectFps(doc.project)).toEqual({ num: 30, den: 1 });
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second hype reel, 16:9, 60 fps", skip: ["footage", "music", "build", "render"] });
    const format = (result.data?.data as { stages: Stage[] }).stages.find((s) => s.stage === "format");
    expect(format).toMatchObject({ tool: "set_project_setting_tool", outcome: "applied", undo_steps: 1 });
    expect(projectFps(doc.project)).toEqual({ num: 60, den: 1 });
    expect([doc.project.width, doc.project.height]).toEqual([1280, 720]);
  });

  // Each stage is a call to another tool with arguments built here: a renamed argument shows up as a failed stage, not a thrown error.
  it.each(STYLE_RULES.map((r) => r.id))("cuts and finishes %s with arguments its tools accept", async (style) => {
    const doc = fixtureDoc();
    const args = { request: "A 12 second video called 'Acme'", style, replace: true, features: ["Fast: in seconds", "Safe"], script: "Hello there. This is the script.", skip: ["footage", "music", "watch"] };
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", args);
    expect(result.data?.status, result.text).toBe("applied");
    const stages = (result.data?.data as { stages: Stage[] }).stages;
    expect(stages.filter((s) => s.stage === "build" && s.outcome === "applied").length, JSON.stringify(stages)).toBe(1);
    // master_audio_tool needs a host that renders the mix; the fake host has none.
    const failed = stages.filter((s) => s.outcome === "failed" && s.stage !== "master");
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(result.data?.undoSteps).toBe(stages.reduce((n, s) => n + s.undo_steps, 0));
  });
});
