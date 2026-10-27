/**
 * "Sound design" in the command palette and the Sound panel: runs
 * auto_sound_design_tool (one undo step, same receipt as every other
 * surface) and reports the result in a toast.
 */
import type { SfxIntensity } from "@zenvi/engine";
import { runToolWithToast } from "./editorTools";
import type { EditorSession } from "./session/EditorSession";

export async function runSoundDesign(session: EditorSession, intensity: SfxIntensity): Promise<void> {
  await runToolWithToast(session, "auto_sound_design_tool", { intensity }, { done: "Sound design added", failed: "Could not add sound design", unchanged: "No sound design added" });
}
