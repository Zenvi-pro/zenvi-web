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
  /** The longest the film may run: sections give up their second bar (proof, reveal, end card, problem, in that order) until it fits. */
  maxSeconds?: number;
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
  const lines = [...input.downbeats].filter((t) => t >= 0).sort((a, b) => a - b);
  if (lines.length === 0 || lines[0]! > 1e-6) lines.unshift(0);
  const bar = lines.length > 1 ? lines[lines.length - 1]! - lines[lines.length - 2]! : 2;
  const bars = new Map(kinds.map((k) => [k, BARS[k.kind]]));
  const total = () => [...bars.values()].reduce((a, b) => a + b, 0);
  const at = (n: number) => lines[n] ?? lines[lines.length - 1]! + (n - lines.length + 1) * bar;
  if (input.maxSeconds !== undefined) {
    for (const kind of ["proof", "reveal", "end", "problem"] as const) {
      for (const k of kinds) if (k.kind === kind && at(total()) > input.maxSeconds + 0.05 && bars.get(k)! > 1) bars.set(k, 1);
    }
  }
  while (lines.length < total() + 1) lines.push(lines[lines.length - 1]! + bar);
  const snap = (t: number) => Math.round(t * input.fps) / input.fps;
  const sections: LaunchSection[] = [];
  let n = 0;
  for (const k of kinds) {
    const next = n + bars.get(k)!;
    sections.push({ ...k, start: snap(lines[n]!), end: snap(lines[next]!) });
    n = next;
  }
  return { sections, duration: sections[sections.length - 1]!.end };
}
