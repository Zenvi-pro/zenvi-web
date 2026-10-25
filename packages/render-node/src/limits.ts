/**
 * What a container gives this process: its cgroup CPU quota and memory
 * limit. Node's availableParallelism() and ffmpeg's automatic thread count
 * both see the host's cores, not a container's quota, so a 1-vCPU Zenvi
 * Cloud replica on a big host would run renders with many times the threads
 * (and frame buffers) it has room for. Outside a container both are empty
 * and the defaults stand.
 */

import { readFileSync } from "node:fs";

export interface ContainerLimits {
  cpus?: number;
  memoryBytes?: number;
}

function readSmallFile(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** The cgroup v2 (or v1) limits of the container this process runs in. */
export function containerLimits(read: (file: string) => string | undefined = readSmallFile): ContainerLimits {
  const limits: ContainerLimits = {};
  const [quota, period] = (read("/sys/fs/cgroup/cpu.max") ?? "").trim().split(/\s+/);
  if (quota && quota !== "max" && Number(quota) > 0 && Number(period) > 0) limits.cpus = Number(quota) / Number(period);
  else {
    const v1Quota = Number(read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")?.trim());
    const v1Period = Number(read("/sys/fs/cgroup/cpu/cpu.cfs_period_us")?.trim());
    if (v1Quota > 0 && v1Period > 0) limits.cpus = v1Quota / v1Period;
  }
  const memory = (read("/sys/fs/cgroup/memory.max") ?? read("/sys/fs/cgroup/memory/memory.limit_in_bytes") ?? "").trim();
  // cgroup v1 writes a huge number for "no limit".
  if (/^\d+$/.test(memory) && Number(memory) > 0 && Number(memory) < 2 ** 60) limits.memoryBytes = Number(memory);
  return limits;
}

let cached: ContainerLimits | undefined;

/** containerLimits(), read once per process; `ZENVI_CPU_LIMIT` sets the CPUs where there is no cgroup (tests, other sandboxes). */
export function processLimits(env: NodeJS.ProcessEnv = process.env): ContainerLimits {
  if (!cached) {
    cached = containerLimits();
    const forced = Number(env.ZENVI_CPU_LIMIT);
    if (forced > 0) cached.cpus = forced;
  }
  return cached;
}

/**
 * ffmpeg's `-threads` for a decoder or an encoder in a container: one per
 * CPU of the quota to decode, about one and a half to encode (x264's own
 * ratio). Empty outside a container, where ffmpeg's automatic count is right.
 */
export function ffmpegThreads(role: "decode" | "encode", limits: ContainerLimits = processLimits()): string[] {
  if (limits.cpus === undefined) return [];
  const cpus = Math.max(1, limits.cpus);
  return ["-threads", String(role === "decode" ? Math.max(1, Math.floor(cpus)) : Math.max(1, Math.ceil(cpus * 1.5)))];
}
