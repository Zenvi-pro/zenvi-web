/**
 * Waveform data stored in a project (Edit > Clear > Waveform).
 *
 * Zenvi desktop keeps a file's and a clip's waveform samples in its `ui`
 * object (`audio_data` with its format, RMS and rate); the web timelines
 * draw waveforms from the media and never store them. Port of zenvi-core
 * develop src/classes/waveform.py `clear_waveform_data`.
 */

import type { Transaction } from "../history/document.js";
import { isRecord } from "./internal.js";

const WAVEFORM_UI_KEYS = ["audio_data", "audio_data_format", "audio_data_rms", "audio_data_rate"];

function withoutWaveform(ui: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ui)) if (!WAVEFORM_UI_KEYS.includes(key)) out[key] = value;
  return out;
}

/**
 * Drop the stored waveform data of every file and clip that has some (its
 * `ui.audio_data`, with the keys that describe it), as part of the caller's
 * transaction. Returns how many files and clips had it.
 */
export function clearWaveformData(tx: Transaction): { files: number; clips: number } {
  let files = 0;
  let clips = 0;
  for (const file of tx.project.files) {
    if (!isRecord(file.ui) || !("audio_data" in file.ui)) continue;
    // A shallow update of the record replaces `ui` whole, as the desktop's File.save() does.
    tx.update(["files", { id: file.id }], { ui: withoutWaveform(file.ui) });
    files += 1;
  }
  for (const clip of tx.project.clips) {
    if (!isRecord(clip.ui) || !("audio_data" in clip.ui)) continue;
    tx.update(["clips", { id: clip.id }], { ui: withoutWaveform(clip.ui) });
    clips += 1;
  }
  return { files, clips };
}
