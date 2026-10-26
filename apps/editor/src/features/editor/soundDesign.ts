/**
 * "Sound design" in the command palette: runs auto_sound_design_tool through
 * the Assistant bridge (one undo step, same receipt as every other surface)
 * and reports the result in a toast.
 */
import type { SfxIntensity } from "@zenvi/engine";
import { toast } from "@/ui/Toast";
import { runAssistantTool } from "./assistant/bridge";
import { createToolHost } from "./assistant/host";
import type { EditorSession } from "./session/EditorSession";

export async function runSoundDesign(session: EditorSession, intensity: SfxIntensity): Promise<void> {
  const wire = await runAssistantTool(session, createToolHost(session, async () => []), "auto_sound_design_tool", { intensity }, new AbortController().signal);
  let summary = wire.result;
  let status: string | undefined;
  try {
    const receipt = JSON.parse(wire.result) as { summary?: string; status?: string };
    summary = receipt.summary ?? summary;
    status = receipt.status;
  } catch {
    // plain text result
  }
  if (summary.startsWith("Error")) toast.error("Could not add sound design", { description: summary.replace(/^Error:\s*/, "") });
  else if (status === "unchanged") toast.info("No sound design added", { description: summary });
  else toast.success("Sound design added", { description: summary });
}
