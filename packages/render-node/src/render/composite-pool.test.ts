import { availableParallelism } from "node:os";
import { describe, expect, it } from "vitest";
import { containerLimits, ffmpegThreads } from "../limits.js";
import { compositeThreads } from "./composite-pool.js";

const GiB = 1024 * 1024 * 1024;
const files = (entries: Record<string, string>) => (file: string) => entries[file];

describe("containerLimits", () => {
  it("reads a cgroup v2 CPU quota and memory limit", () => {
    expect(containerLimits(files({ "/sys/fs/cgroup/cpu.max": "100000 100000\n", "/sys/fs/cgroup/memory.max": `${2 * GiB}\n` }))).toEqual({ cpus: 1, memoryBytes: 2 * GiB });
  });

  it("has no limits when cgroup v2 says max, or outside a container", () => {
    expect(containerLimits(files({ "/sys/fs/cgroup/cpu.max": "max 100000", "/sys/fs/cgroup/memory.max": "max" }))).toEqual({});
    expect(containerLimits(files({}))).toEqual({});
  });

  it("reads cgroup v1, where no memory limit is a huge number", () => {
    expect(
      containerLimits(
        files({
          "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "150000",
          "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000",
          "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712",
        }),
      ),
    ).toEqual({ cpus: 1.5 });
  });
});

describe("compositeThreads", () => {
  it("composites on the main thread in a 1-vCPU, 2 GiB container (workers there ran it out of memory)", () => {
    expect(compositeThreads(480, {}, { cpus: 1, memoryBytes: 2 * GiB })).toBe(0);
  });

  it("lets a container's memory limit cap the workers its CPUs would allow", () => {
    // A quarter of 2 GiB holds two workers' caches and heaps.
    expect(compositeThreads(480, {}, { cpus: 8, memoryBytes: 2 * GiB })).toBe(Math.min(2, availableParallelism() - 1));
  });

  it("uses up to four workers outside a container, none for a short render, and ZENVI_RENDER_THREADS when set", () => {
    expect(compositeThreads(480, {}, {})).toBe(Math.max(0, Math.min(4, availableParallelism() - 1)));
    expect(compositeThreads(30, {}, {})).toBe(0);
    expect(compositeThreads(480, { ZENVI_RENDER_THREADS: "3" }, { cpus: 1, memoryBytes: GiB })).toBe(3);
  });
});

describe("ffmpegThreads", () => {
  it("keeps ffmpeg's own thread count outside a container and follows the CPU quota inside one", () => {
    expect(ffmpegThreads("decode", {})).toEqual([]);
    expect(ffmpegThreads("decode", { cpus: 1 })).toEqual(["-threads", "1"]);
    expect(ffmpegThreads("encode", { cpus: 1 })).toEqual(["-threads", "2"]);
    expect(ffmpegThreads("decode", { cpus: 0.5 })).toEqual(["-threads", "1"]);
    expect(ffmpegThreads("encode", { cpus: 4 })).toEqual(["-threads", "6"]);
  });
});
