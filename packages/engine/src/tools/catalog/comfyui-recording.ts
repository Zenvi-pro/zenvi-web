/**
 * Zenvi desktop's local ComfyUI tools and its Recording dock, refused on the
 * web surfaces: list_comfyui_templates_tool, list_comfyui_jobs_tool,
 * create_media_with_comfyui_tool, enhance_file_with_comfyui_tool,
 * cancel_comfyui_job_tool (zenvi-core develop 1f80cb3d0
 * editor_tools/ai_generation_comfyui.py) and prepare_recording_tool
 * (editor_tools/ai_generation_recording.py).
 *
 * The ComfyUI tools drive a ComfyUI server on the person's own computer,
 * configured in the desktop's Preferences > AI > ComfyUI URL (blank = off),
 * through the desktop's template registry, generation queue and workflow
 * graphs; Zenvi Cloud and the browser cannot reach that server, and no web
 * surface has that integration. Recording uses the desktop's dock (devices,
 * screens, level meters, the clip landing when the person stops). The
 * answers say so and name what does work here.
 */

import { contractTool, unavailable, type CatalogTool } from "../define.js";

/** Why ComfyUI is not available, and the web's own generation tools. */
const COMFYUI_REASON =
  "ComfyUI is an optional AI server on the person's own computer that only Zenvi desktop drives (Preferences > AI > ComfyUI URL); " +
  "this surface has no ComfyUI connection and no ComfyUI jobs.";

const GENERATE_INSTEAD =
  " Here, generate_image_and_add_to_timeline_tool and generate_video_and_add_to_timeline_tool make images and clips with Zenvi's cloud models (they use credits).";

const LIST = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const QUEUE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

export const comfyuiRecordingTools: CatalogTool[] = [
  contractTool("list_comfyui_templates_tool", {
    annotations: LIST,
    run: (call) => unavailable(call.tool, `${COMFYUI_REASON} Use Zenvi desktop for AI Tools > Create / Enhance with AI.${GENERATE_INSTEAD}`),
  }),

  contractTool("list_comfyui_jobs_tool", {
    annotations: LIST,
    run: (call) => unavailable(call.tool, `${COMFYUI_REASON} Generation jobs started in Zenvi desktop are listed there.`),
  }),

  contractTool("create_media_with_comfyui_tool", {
    annotations: QUEUE,
    run: (call) => unavailable(call.tool, `${COMFYUI_REASON}${GENERATE_INSTEAD}`),
  }),

  contractTool("enhance_file_with_comfyui_tool", {
    annotations: QUEUE,
    run: (call) =>
      unavailable(
        call.tool,
        `${COMFYUI_REASON} Upscaling, object tracking, restyling and audio clean-up with ComfyUI templates need Zenvi desktop (Project Files > Enhance with AI).`,
      ),
  }),

  contractTool("cancel_comfyui_job_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call) => unavailable(call.tool, `${COMFYUI_REASON} Cancel generation jobs in Zenvi desktop (Project Files > Cancel Job).`),
  }),

  contractTool("prepare_recording_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call) =>
      unavailable(
        call.tool,
        "recording a voiceover, the screen or a webcam happens in Zenvi desktop's Recording dock, which this surface does not have. " +
          "Record in Zenvi desktop, or import a recording you already have; generate_tts_and_add_to_timeline_tool makes a narration from text.",
      ),
  }),
];
