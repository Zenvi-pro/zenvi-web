import { describe, expect, it } from "vitest";
import { blenderArgs, encodeArgs, renderSize } from "./job.js";

describe("renderSize", () => {
  it("renders drafts at half size, always even", () => {
    expect(renderSize(1080, 1920, "final")).toEqual({ width: 1080, height: 1920 });
    expect(renderSize(1080, 1920, "draft")).toEqual({ width: 540, height: 960 });
    expect(renderSize(1366, 767, "draft")).toEqual({ width: 684, height: 384 });
  });
});

describe("blenderArgs", () => {
  it("runs the worker script in the background, as a server or for one job", () => {
    const server = blenderArgs("/s");
    expect(server).toEqual(["--factory-startup", "-b", "-noaudio", "--python-exit-code", "1", "-P", "/s/worker.py", "--"]);
    expect(blenderArgs("/s", "/tmp/job.json").slice(-3)).toEqual(["--", "--job", "/tmp/job.json"]);
  });
});

describe("encodeArgs", () => {
  it("encodes transparent scenes as ProRes 4444 with alpha", () => {
    const args = encodeArgs({ framesDir: "/f", fps: { num: 30000, den: 1001 }, backdrop: null, output: "/o.mov", quality: "final" });
    expect(args).toEqual(expect.arrayContaining(["-framerate", "30000/1001", "-start_number", "1", "-i", "/f/f_%04d.png", "prores_ks", "4444", "yuva444p10le"]));
    expect(args.at(-1)).toBe("/o.mov");
    expect(args).not.toContain("-filter_complex");
  });

  it("lays opaque scenes over their backdrop as H.264", () => {
    const args = encodeArgs({ framesDir: "/f", fps: { num: 30, den: 1 }, backdrop: "/f/backdrop.png", output: "/o.mp4", quality: "draft" });
    expect(args.slice(args.indexOf("-loop"), args.indexOf("-loop") + 6)).toEqual(["-loop", "1", "-framerate", "30/1", "-i", "/f/backdrop.png"]);
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("overlay=shortest=1");
    expect(args).toEqual(expect.arrayContaining(["libx264", "veryfast", "+faststart"]));
  });
});
