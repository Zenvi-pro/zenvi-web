/**
 * Recent transcriptions, per person and media, in this process.
 *
 * A cloud edit that loses a race with another editor's save runs again on
 * the newer project (mcp/projects.ts `editProject`), which has no kept
 * transcript yet (the losing save carried it). Without this, that retry would
 * send the audio and bill the person again. Entries live 15 minutes; failed
 * transcriptions are not kept.
 */

import type { Transcription } from "@zenvi/engine";
import type { Clock } from "../util/clock.js";

const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 64;

export class RecentTranscripts {
  private readonly entries = new Map<string, { at: number; value: Promise<Transcription> }>();

  constructor(private readonly clock: Clock) {}

  /** The transcription for `key`, made once by `make` while it is recent. */
  get(key: string, make: () => Promise<Transcription>): Promise<Transcription> {
    const now = this.clock.now();
    for (const [k, entry] of this.entries) if (now - entry.at > TTL_MS) this.entries.delete(k);
    const hit = this.entries.get(key);
    if (hit) return hit.value;
    const value = make();
    this.entries.set(key, { at: now, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }
}
