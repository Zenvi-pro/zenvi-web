/**
 * Caption gestures (clip menu, command palette): add_captions_tool's look
 * presets, and kinetic_captions_tool's styles when this build has it.
 */
import { runToolWithToast } from "../editorTools";
import type { EditorSession } from "../session/EditorSession";

export const CAPTION_STYLES: readonly { style: string; label: string }[] = [
  { style: "reels", label: "Reels: big bold, outlined" },
  { style: "classic", label: "Classic subtitles" },
  { style: "minimal", label: "Minimal" },
  { style: "yellow", label: "Yellow TV subtitles" },
  { style: "boxed", label: "Boxed" },
];

/** kinetic_captions_tool styles (word by word, timed to the speech). */
export const KINETIC_CAPTION_STYLES: readonly { style: string; label: string }[] = [
  { style: "creator", label: "Creator: huge emphasis words" },
  { style: "documentary", label: "Documentary: a phrase at a time" },
  { style: "split", label: "Split: either side of the subject" },
  { style: "karaoke", label: "Karaoke: the spoken word lights up" },
  { style: "stack", label: "Stack" },
  { style: "editorial", label: "Editorial" },
];

export async function addCaptions(session: EditorSession, clipId: string, style: string): Promise<void> {
  await runToolWithToast(session, "add_captions_tool", { timeline_clip_id: clipId, style }, { done: "Captions added", failed: "Could not add captions" });
}

export async function addKineticCaptions(session: EditorSession, clipIds: readonly string[], style: string): Promise<void> {
  await runToolWithToast(session, "kinetic_captions_tool", { ...(clipIds.length ? { timeline_clip_ids: [...clipIds] } : {}), style }, { done: "Kinetic captions added", failed: "Could not add kinetic captions" });
}
