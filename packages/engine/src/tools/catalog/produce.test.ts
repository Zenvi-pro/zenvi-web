import { describe, expect, it } from "vitest";
import { STYLE_RULES } from "../../director/route.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { readBrief } from "../../brief/brief.js";
import { projectFps } from "../frame-time.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { fakeMotionHost } from "../test-support/fake-motion.js";
import { fakeSceneHost } from "../test-support/fake-scenes.js";
import { audioInfo, fixtureDoc, media } from "../test-support/fixture.js";

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
  });

  it("saves the one auto brief (brief/auto.ts) from the whole request, outside the undo history, and keeps an agent's own", async () => {
    const doc = fixtureDoc(createProject({ id: "PRODUCEBRF" }));
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second travel film of Lisbon, 9:16. Headline 'City of Light'.", skip: ["format", "footage", "music", "build", "render"] });
    expect(result.data?.status, result.text).toBe("applied");
    const brief = readBrief(doc.project)!;
    expect(brief).toMatchObject({ auto: true, style: "travel-cinematic-montage", aspect: "9:16", length_seconds: 12, goal: "A 12 second travel film of Lisbon, 9:16.", beats: [{ start: 0, end: 12, name: "whole piece" }] });
    expect(brief.hook).toMatch(/City of Light/);
    expect(doc.undoLabels).toEqual([]);
    const stage = (result.data?.data as { stages: Stage[] }).stages.find((s) => s.stage === "brief");
    expect(stage).toMatchObject({ outcome: "applied", undo_steps: 0 });

    // An agent's own brief leads: produce_video_tool keeps it.
    const own = { ...brief, auto: false, style: "hype-reel", goal: "The agent's plan" };
    doc.setUntracked(["settings"], { ...doc.project.settings, zenvi_brief: own });
    const again = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second travel film of Lisbon", skip: ["format", "footage", "music", "build", "render"] });
    expect((again.data?.data as { stages: Stage[] }).stages.find((s) => s.stage === "brief")?.summary).toMatch(/kept the saved brief \(hype-reel/);
    expect(readBrief(doc.project)?.goal).toBe("The agent's plan");
  });

  it("cuts a saved brief's style that has no builder of its own under its id, whatever the request reads as", async () => {
    const doc = fixtureDoc(createProject({ id: "PRODUCEGRD" }));
    const skip = ["format", "footage", "music", "build", "render"];
    await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second grid", skip });
    doc.setUntracked(["settings"], { ...doc.project.settings, zenvi_brief: { ...readBrief(doc.project)!, auto: false, style: "grid-montage" } });
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second travel film of Lisbon", skip });
    expect(result.data?.summary).toMatch(/^Produced a grid-montage edit/);
  });

  it("leaves the old timeline alone when the build cuts nothing", async () => {
    // Only a music bed, on the timeline: every builder refuses (no pictures), so nothing should grade, sound, master or render it.
    const doc = new ProjectDocument(createProject({ id: "PRODUCEOLD" }));
    doc.transaction("bed", (tx) => {
      addFile(tx, media("/media/bed.mp3", audioInfo("/media/bed.mp3", 60)), { id: "BED0000001" });
      addClip(tx, { fileId: "BED0000001", position: 0, layer: 1, start: 0, end: 12, id: "BEDCLIP001" });
    });
    doc.clearHistory();
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second hype reel", replace: true });
    const stages = (result.data?.data as { stages: Stage[] }).stages;
    for (const stage of ["grade", "transitions", "sound", "master", "render"]) {
      const s = stages.find((x) => x.stage === stage);
      if (s) expect(s, stage).toMatchObject({ undo_steps: 0, summary: "the edit was not cut" });
    }
    expect(doc.undoLabels).toEqual([]);
    expect(result.data?.status).toBe("refused");
    expect(result.data?.summary).toMatch(/^Error: Did not cut the edit/);
    expect(result.data?.summary).not.toMatch(/master_audio_tool/);
  });

  it("writes the music the call asks for into the auto brief", async () => {
    const doc = fixtureDoc(createProject({ id: "PRODUCEMUS" }));
    await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "A 12 second hype reel", bpm: "128", music_query: "dark synthwave", skip: ["format", "footage", "music", "build", "render"] });
    expect(readBrief(doc.project)?.music).toMatch(/^dark synthwave, about 128 BPM/);
  });

  it("states the length the builder cut, not only the one asked", async () => {
    const doc = fixtureDoc();
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request: "An 8 second movie trailer", title: "Night Run", replace: true, skip: ["footage", "music", "watch", "render"] });
    expect(result.data?.status, result.text).toBe("applied");
    expect(result.data?.summary).toMatch(/^Produced a movie-game-trailer edit \([^)]*~15s, 8s asked: build_trailer_tool cuts no shorter\)/);
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

  it("films a cinetic style as a scene drafted from its worked example, and says to make it the product's", async () => {
    const doc = fixtureDoc(createProject({ id: "PRODUCESCN" }));
    const scenes = fakeSceneHost();
    const host = { ...fakeHost(), motion: { ...fakeMotionHost(), scenes } };
    const request = "Invent the brand for Kiln (a build cache that makes CI runs finish in seconds) and make a 25-second launch teaser with sound. Style: cinetic.";
    const result = await runTool({ doc, host }, "produce_video_tool", { request, style: "cinetic-teaser", skip: ["footage", "music", "watch"] });
    expect(result.data?.status, result.text).toBe("applied");
    expect(scenes.drafts[0]!.code).toMatch(/^const SECONDS = 25;$/m);
    expect(scenes.drafts[0]!.params).toMatchObject({ name: "Kiln", app: "Kiln", items: [] });
    expect(scenes.renders[0]).toMatchObject({ motionBlurSamples: 4 });
    const data = result.data?.data as { builder: string; scene: { scene_id: string; starter: string }; next_calls: { tool: string }[] };
    expect(data).toMatchObject({ builder: "render_scene_tool", scene: { starter: "scenes-launch-teaser" } });
    expect(data.next_calls.slice(0, 3).map((n) => n.tool)).toEqual(["get_technique_tool", "update_scene_tool", "render_scene_tool"]);
    expect(result.data?.summary).toMatch(/is a draft from the scenes-launch-teaser starter/);
  });

  it("leaves a muted loop without music, sound design or a mix, and falls back to the motion reel without a scene sandbox", async () => {
    const request = "A 10-second looping feature animation for Ledgerly, a shared-expenses app; it autoplays muted. Style: cinetic.";
    const doc = fixtureDoc(createProject({ id: "PRODUCELOP" }));
    const muted = await runTool({ doc, host: fakeHost() }, "produce_video_tool", { request, style: "cinetic-feature-loop", skip: ["footage", "watch"] });
    const stages = (muted.data?.data as { stages: Stage[] }).stages;
    for (const stage of ["music", "sound", "master"]) expect(stages.find((s) => s.stage === stage)?.summary, stage).toBe("the request plays muted");
    expect(muted.data?.summary).not.toMatch(/auto_sound_design_tool/);
    const bare = fixtureDoc();
    const fallback = await runTool({ doc: bare, host: { ...fakeHost(), motion: fakeMotionHost({ scenes: false }) } }, "produce_video_tool", { request, style: "cinetic-feature-loop", replace: true, skip: ["footage", "music", "watch"] });
    expect((fallback.data?.data as { builder: string }).builder, fallback.text).toBe("build_reel_tool");
  });

  // Each stage is a call to another tool with arguments built here: a renamed argument shows up as a failed stage, not a thrown error.
  it.each(STYLE_RULES.map((r) => r.id))("cuts and finishes %s with arguments its tools accept", async (style) => {
    const doc = fixtureDoc();
    const args = { request: "A 12 second video called 'Acme'", style, replace: true, features: ["Fast: in seconds", "Safe"], script: "Hello there. This is the script.", skip: ["footage", "music", "watch"] };
    const result = await runTool({ doc, host: fakeHost() }, "produce_video_tool", args);
    expect(result.data?.status, result.text).toBe("applied");
    const stages = (result.data?.data as { stages: Stage[] }).stages;
    // One builder; a scene film is created, then placed (the timeline cleared between them, as replace asks).
    const placed = stages.filter((s) => s.stage === "build" && s.outcome === "applied" && s.tool !== "create_scene_tool" && s.tool !== "produce_video_tool");
    expect(placed.length, JSON.stringify(stages)).toBe(1);
    // master_audio_tool needs a host that renders the mix; the fake host has none.
    const failed = stages.filter((s) => s.outcome === "failed" && s.stage !== "master");
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(result.data?.undoSteps).toBe(stages.reduce((n, s) => n + s.undo_steps, 0));
  });
});
