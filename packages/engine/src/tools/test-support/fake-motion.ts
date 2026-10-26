/** A Zenvi Motion host for tests: one block, renders recorded and "written" as files named after the request. */

import type { MotionBlockInfo, MotionHost, MotionRenderRequest } from "../types.js";
import { videoInfo } from "./fixture.js";

export const FAKE_MOTION_BLOCK: MotionBlockInfo = {
  id: "kinetic_headline",
  version: 1,
  title: "Kinetic headline",
  description: "A big headline that builds word by word.",
  tags: ["type"],
  params: [
    { name: "text", type: "string", description: "The headline.", default: "Hello" },
    { name: "background", type: "media", description: "Photo behind.", accept: ["image", "video"], optional: true },
  ],
  duration: { default: 3, min: 1.5, max: 10 },
  aspects: ["9:16", "16:9"],
  alpha: true,
};

export interface FakeMotionHost extends MotionHost {
  requests: MotionRenderRequest[];
}

export function fakeMotionHost(): FakeMotionHost {
  const requests: MotionRenderRequest[] = [];
  const block = FAKE_MOTION_BLOCK;
  return {
    requests,
    blocks: () => [block],
    check(id, params) {
      if (id !== block.id) return { ok: false, error: `unknown motion block ${id}` };
      const unknown = Object.keys(params).filter((k) => !block.params.some((p) => p.name === k));
      if (unknown.length > 0) return { ok: false, error: `${id} has no parameter ${unknown.join(", ")}` };
      return { ok: true, params: { text: "Hello", ...params } };
    },
    async render(request) {
      requests.push(request);
      const fingerprint = `fp-${JSON.stringify(request.params)}-${request.seconds}`.replace(/\W/g, "");
      const path = `/links/${request.block}-${requests.length}.${request.alpha ? "mov" : "mp4"}`;
      return {
        media: { path, info: videoInfo(path, request.seconds, { has_audio: false, width: request.width, height: request.height }) },
        codec: request.alpha ? "prores4444" : "h264",
        width: request.width,
        height: request.height,
        fps: request.fps,
        frames: Math.round((request.seconds * request.fps.num) / request.fps.den),
        fingerprint,
        cached: false,
        renderSeconds: 1.25,
      };
    },
  };
}
