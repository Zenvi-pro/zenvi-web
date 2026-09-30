/** Injectable time source so expiry logic is testable. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A clock tests can move by hand. */
export class ManualClock implements Clock {
  constructor(private current = Date.UTC(2026, 8, 30, 12, 0, 0)) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}
