/**
 * A product launch in five beats (the SaaS and 3D product references):
 * the problem, the reveal, one feature per bar, the proof, the end card.
 * Every section starts on a downbeat of the music (or of the tempo when
 * there is none), so the reveal's hit and each feature's entrance land on
 * the bar.
 */

export type LaunchSectionKind = "problem" | "reveal" | "feature" | "proof" | "end";

export interface LaunchSection {
  kind: LaunchSectionKind;
  /** Feature sections: which feature (0-based). */
  index?: number;
  start: number;
  end: number;
}

export interface LaunchInput {
  features: number;
  hasProblem: boolean;
  hasProof: boolean;
  /** Bar lines on the timeline (seconds, ascending, from 0); the plan extends them at the last bar's length when it needs more. */
  downbeats: readonly number[];
  fps: number;
}

/** Bars each section holds. */
const BARS: Record<LaunchSectionKind, number> = { problem: 2, reveal: 2, feature: 1, proof: 2, end: 2 };

export function planLaunch(input: LaunchInput): { sections: LaunchSection[]; duration: number } {
  const kinds: { kind: LaunchSectionKind; index?: number }[] = [
    ...(input.hasProblem ? [{ kind: "problem" as const }] : []),
    { kind: "reveal" },
    ...Array.from({ length: input.features }, (_, index) => ({ kind: "feature" as const, index })),
    ...(input.hasProof ? [{ kind: "proof" as const }] : []),
    { kind: "end" },
  ];
  const bars = kinds.reduce((n, k) => n + BARS[k.kind], 0);
  const lines = [...input.downbeats].filter((t) => t >= 0).sort((a, b) => a - b);
  if (lines.length === 0 || lines[0]! > 1e-6) lines.unshift(0);
  const bar = lines.length > 1 ? lines[lines.length - 1]! - lines[lines.length - 2]! : 2;
  while (lines.length < bars + 1) lines.push(lines[lines.length - 1]! + bar);
  const snap = (t: number) => Math.round(t * input.fps) / input.fps;
  const sections: LaunchSection[] = [];
  let at = 0;
  for (const k of kinds) {
    const next = at + BARS[k.kind];
    sections.push({ ...k, start: snap(lines[at]!), end: snap(lines[next]!) });
    at = next;
  }
  return { sections, duration: sections[sections.length - 1]!.end };
}
