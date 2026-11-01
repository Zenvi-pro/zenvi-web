/**
 * A scene host for tests. It does not run the code: the code's markers
 * decide what the "check" finds (BROKEN: it does not run; FLASH: it
 * flashes; EDGE: text past the safe zone), and `seconds=N` its length.
 */

import type { SceneHost, SceneModuleInfo, SceneProblem, SceneRenderRequest, SceneRequest } from "../types.js";
import { videoInfo } from "./fixture.js";

export interface FakeSceneHost extends SceneHost {
  drafts: SceneRequest[];
  renders: SceneRenderRequest[];
}

function infoOf(code: string): SceneModuleInfo {
  const seconds = Number(/seconds=(\d+(?:\.\d+)?)/.exec(code)?.[1] ?? 2);
  return {
    fps: 60,
    duration: Math.round(seconds * 60),
    alpha: code.includes("ALPHA"),
    cues: [
      { name: "click", frame: 30, kind: "click", weight: 0.4, x: 0.6, y: 0.5 },
      { name: "land", frame: 60, kind: "land", weight: 0.6, x: 0.5, y: 0.5, hit: 1 },
      { name: "beat", frame: 90, weight: 0.5, x: 0.5, y: 0.5 },
    ],
    params: { headline: "Hi" },
    title: "Fake scene",
  };
}

function problemsOf(request: SceneRequest): SceneProblem[] {
  const out: SceneProblem[] = [];
  if (request.code.includes("FLASH")) out.push({ code: "flashing", severity: request.allowStrobe ? "warning" : "error", message: "5 flashes in one second", frames: { from: 0, to: 60 } });
  if (request.code.includes("EDGE")) out.push({ code: "safe-area", severity: "warning", message: '"title" leaves the title-safe zone', frames: { from: 10, to: 20 } });
  return out;
}

export function fakeSceneHost(): FakeSceneHost {
  const host: FakeSceneHost = {
    drafts: [],
    renders: [],
    async draft(request) {
      host.drafts.push(request);
      if (request.code.includes("BROKEN")) return { problems: [{ code: "lint", severity: "error", message: "Math.random is not allowed", line: 3 }], cells: [], checkSeconds: 0.1 };
      return { info: infoOf(request.code), problems: problemsOf(request), sheet: { mimeType: "image/jpeg", data: "AAAA" }, sheetPath: "/links/zenvi-scene/sheets/sheet.jpg", cells: [{ frame: 30, label: "30f · click" }], checkSeconds: 1.5 };
    },
    async render(request) {
      host.renders.push(request);
      const info = infoOf(request.code);
      const problems = problemsOf(request);
      if (problems.some((p) => p.severity === "error")) return { ok: false, problems, info };
      const seconds = info.duration / info.fps;
      const alpha = request.alpha ?? info.alpha;
      const path = `/links/zenvi-scene/scene-${host.renders.length}.${alpha ? "mov" : "mp4"}`;
      return {
        ok: true,
        media: { path, info: videoInfo(path, seconds, { has_audio: false, width: request.width, height: request.height }) },
        codec: alpha ? "prores4444" : "h264",
        width: request.width,
        height: request.height,
        fps: request.fps,
        frames: Math.round((seconds * request.fps.num) / request.fps.den),
        fingerprint: `fp-${request.code.length}-${JSON.stringify(request.params)}-${request.motionBlurSamples}`.replace(/\W/g, ""),
        cached: false,
        renderSeconds: 2,
        events: [
          { t: 0.5, kind: "click", weight: 0.4, x: 0.6, y: 0.5 },
          { t: 1, kind: "land", weight: 0.6, x: 0.5, y: 0.5 },
        ],
        info,
        problems,
      };
    },
  };
  return host;
}
