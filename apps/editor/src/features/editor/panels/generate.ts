/**
 * AI generation (backend `/generation/video`, `/generation/tts`). Uses the
 * engine tools the Assistant uses when the catalog is exported, otherwise the
 * same backend endpoints directly, with the person's Supabase token.
 */
import { backendRequest } from "@/lib/backend";
import { importMedia, type Placement } from "../actions/importMedia";
import { runAssistantTool, toolsAvailable } from "../assistant/bridge";
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

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "clip";
}

export async function generateVideo(session: EditorSession, request: VideoRequest, placement: Placement): Promise<void> {
  if (toolsAvailable()) {
    const host = createToolHost(session, async () => []);
    const args: Record<string, unknown> = { prompt: request.prompt, duration_seconds: request.durationSeconds === 10 ? "10" : "" };
    if (placement && placement !== "end") args.position_seconds = String(placement.position);
    const wire = await runAssistantTool(session, host, "generate_video_and_add_to_timeline_tool", args, new AbortController().signal);
    if (wire.result.startsWith("Error")) throw new Error(wire.result.replace(/^Error:\s*/, ""));
    return;
  }
  const result = await backendRequest<{ video_url?: string | null; error?: string | null }>("/generation/video", {
    method: "POST",
    auth: true,
    body: { prompt: request.prompt, duration_seconds: request.durationSeconds, width: request.width, height: request.height },
  });
  if (result.error || !result.video_url) throw new Error(result.error || "The generator returned no video.");
  const response = await fetch(result.video_url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  await importMedia(session, [new File([blob], `ai-${slug(request.prompt)}.mp4`, { type: blob.type || "video/mp4" })], placement);
}

export async function generateVoiceover(session: EditorSession, text: string, voice: TtsVoice, speed: number, placement: Placement): Promise<void> {
  if (toolsAvailable()) {
    const host = createToolHost(session, async () => []);
    const args: Record<string, unknown> = { text, voice, model: "tts-1", speed };
    if (placement && placement !== "end") args.position = placement.position;
    const wire = await runAssistantTool(session, host, "generate_tts_and_add_to_timeline_tool", args, new AbortController().signal);
    if (wire.result.startsWith("Error")) throw new Error(wire.result.replace(/^Error:\s*/, ""));
    return;
  }
  const result = await backendRequest<{ success?: boolean; audio_base64?: string | null; error?: string | null }>("/generation/tts", {
    method: "POST",
    auth: true,
    body: { text, voice, model: "tts-1", speed },
  });
  if (!result.success || !result.audio_base64) throw new Error(result.error || "The voice generator returned no audio.");
  const bytes = Uint8Array.from(atob(result.audio_base64), (c) => c.charCodeAt(0));
  await importMedia(session, [new File([bytes], `voiceover-${slug(text)}.mp3`, { type: "audio/mpeg" })], placement);
}
