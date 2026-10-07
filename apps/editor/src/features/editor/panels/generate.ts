/**
 * AI generation through the engine tools the Assistant uses
 * (`generate_video_and_add_to_timeline_tool`, `generate_tts_and_add_to_timeline_tool`),
 * which call the backend's `/generation/*` with the person's Supabase token.
 */
import type { Placement } from "../actions/importMedia";
import { runAssistantTool } from "../assistant/bridge";
import { createToolHost } from "../assistant/host";
import type { EditorSession } from "../session/EditorSession";

export const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export interface VideoRequest {
  prompt: string;
  durationSeconds: 5 | 10;
  width: number;
  height: number;
}

export async function generateVideo(session: EditorSession, request: VideoRequest, placement: Placement): Promise<void> {
  const args: Record<string, unknown> = { prompt: request.prompt, duration_seconds: request.durationSeconds === 10 ? "10" : "" };
  if (placement && placement !== "end") args.position_seconds = String(placement.position);
  const wire = await runAssistantTool(session, createToolHost(session, async () => []), "generate_video_and_add_to_timeline_tool", args, new AbortController().signal);
  if (wire.result.startsWith("Error")) throw new Error(wire.result.replace(/^Error:\s*/, ""));
}

export async function generateVoiceover(session: EditorSession, text: string, voice: TtsVoice, speed: number, placement: Placement): Promise<void> {
  const args: Record<string, unknown> = { text, voice, model: "tts-1", speed };
  if (placement && placement !== "end") args.position = placement.position;
  const wire = await runAssistantTool(session, createToolHost(session, async () => []), "generate_tts_and_add_to_timeline_tool", args, new AbortController().signal);
  if (wire.result.startsWith("Error")) throw new Error(wire.result.replace(/^Error:\s*/, ""));
}
