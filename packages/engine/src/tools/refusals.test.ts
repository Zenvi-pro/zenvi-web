/**
 * Surface limitations: every refusal for something this surface cannot do
 * starts with "Error:" and says "not available", so the Zenvi Assistant
 * knows not to retry (zenvi-backend #40). Other failures keep the desktop's
 * own wording.
 */

import { describe, expect, it } from "vitest";
import { transcriptionHttpError } from "../analysis/transcription.js";
import { allTools, runTool } from "./registry.js";
import { fakeHost, type FakeHostOptions } from "./test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "./test-support/fixture.js";
import type { HostCapability } from "./types.js";

const ALL_CAPABILITIES: HostCapability[] = ["media", "player", "ui", "exporter", "frames", "backend", "storage", "audio", "assets"];

/** Minimal valid arguments so a refusal comes from the surface, not from validation. */
const REQUIRED_ARGS: Record<string, Record<string, unknown>> = {
  search_clips_tool: { query: "cameras" },
  add_kinetic_title_tool: { text: "Title" },
  match_cut_montage_tool: { file_ids: [IDS.interview] },
  search_pexels_videos_tool: { query: "coffee" },
  gather_stock_footage_tool: { queries: ["coffee"] },
  search_freesound_music_tool: { query: "lofi" },
  search_clip_scenes_tool: { query: "cameras" },
  slice_clip_at_best_match_tool: { query: "cameras" },
  search_transitions_tool: { query: "fade" },
  generate_video_and_add_to_timeline_tool: { prompt: "a sunset over the sea" },
  generate_tts_and_add_to_timeline_tool: { text: "Hello there" },
  generate_image_and_add_to_timeline_tool: { prompt: "a red fox in snow" },
  generate_sfx_tool: { prompt: "deep cinematic boom", duration_seconds: 2 },
  ingest_web_video_tool: { url: "https://youtu.be/abc" },
  resummarize_project_file_tool: { file_id: IDS.interview },
  reindex_project_file_tool: { file_id: IDS.broll },
  set_export_setting_tool: { key: "width", value: "640" },
  add_title_tool: { text: "Hello" },
  set_keyframes_tool: { property: "alpha", points: [{ frame: 1, value: 1 }] },
  inspect_media_tool: { fileId: IDS.interview },
  export_captions_tool: { path: "/out/captions.srt" },
  search_media_local_tool: { query: "dog" },
  probe_media_tool: { path: "/media/interview.mp4" },
  watch_clip_window_tool: { timeline_clip_id: IDS.clipA, start: "1", end: "3" },
  watch_clip_tool: { timeline_clip_id: IDS.clipA },
  open_project_tool: { file_path: "/projects/a.zvn" },
  remove_silence_tool: { clipId: IDS.clipA },
  add_captions_tool: { clipId: IDS.clipA },
  add_emoji_tool: { emoji: "fire" },
  import_image_sequence_tool: { path: "/frames" },
  add_motion_template_tool: { template: "end_card", text: "Zenvi" },
  add_sfx_tool: { recipe: "pop", at_seconds: "1" },
  add_motion_block_tool: { block: "kinetic_headline" },
  update_motion_block_tool: { file_id: "MOTIONFILE" },
  add_3d_scene_tool: { scene: "glass_hero" },
  rerender_3d_scene_tool: { file_id: IDS.broll },
  apply_fx_tool: { clip_id: IDS.clipB, effects: [{ effect: "bloom" }] },
  update_fx_tool: { clip_id: IDS.clipB, amount: 0.8 },
  datamosh_cut_tool: { clip_id: IDS.clipB },
  review_render_tool: { path: "/out/reel.mp4" },
};

async function expectNotAvailable(name: string, args: Record<string, unknown>, host: FakeHostOptions): Promise<void> {
  const doc = fixtureDoc();
  const before = snapshotOf(doc.project);
  const result = await runTool({ doc, host: fakeHost(host) }, name, args);
  expect(result.ok, name).toBe(false);
  expect(result.data?.status, name).toBe("refused");
  expect(result.data?.summary, name).toMatch(/^Error: .*not available/);
  expect(doc.undoLabels, name).toEqual([]);
  expect(snapshotOf(doc.project), name).toEqual(before);
}

describe("surface-limitation refusals say 'not available'", () => {
  it("for an unknown tool, and the desktop's MCP-only extras", async () => {
    await expectNotAvailable("make_coffee_tool", {}, {});
    // Desktop #237: edits here run to completion inside the call, so there is no job to wait for.
    await expectNotAvailable("wait_for_editor_job_tool", { job_id: "j1" }, {});
  });

  it("for every tool whose host capability is missing", async () => {
    const needing = allTools.filter((t) => (t.requires ?? []).length > 0);
    expect(needing.length).toBeGreaterThan(20);
    for (const tool of needing) {
      for (const cap of tool.requires!) {
        await expectNotAvailable(tool.name, REQUIRED_ARGS[tool.name] ?? {}, { without: [cap] });
      }
    }
  }, 60_000);

  it("names the missing capability", async () => {
    const result = await runTool({ doc: fixtureDoc(), host: fakeHost({ without: ALL_CAPABILITIES }) }, "play_tool", {});
    expect(result.data?.summary).toBe("Error: play_tool is not available in this Zenvi surface: it needs playback, which this host does not provide.");
  });

  it("for the desktop-only ML and ffmpeg tools", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["detect_beats_tool", { fileId: IDS.music }],
      ["diarize_media_tool", { fileId: IDS.interview }],
      ["search_media_local_tool", { query: "dog" }],
      ["modify_clip_tool", { timeline_clip_id: IDS.clipA, description: "make it night" }],
      ["generate_transition_clip_tool", { clip_a_id: IDS.clipA, clip_b_id: IDS.clipB }],
    ];
    for (const [name, args] of cases) await expectNotAvailable(name, args, {});
  });

  it("for Zenvi desktop's ComfyUI and recording tools, and web pages on hosted surfaces", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["list_comfyui_templates_tool", {}],
      ["list_comfyui_jobs_tool", { job_id: "j1" }],
      ["create_media_with_comfyui_tool", { prompt: "misty pine forest" }],
      ["enhance_file_with_comfyui_tool", { file_id: IDS.broll, action: "upscale" }],
      ["cancel_comfyui_job_tool", { all_jobs: "true" }],
      ["prepare_recording_tool", { sources: ["mic"] }],
    ];
    for (const [name, args] of cases) await expectNotAvailable(name, args, {});
    await expectNotAvailable("ingest_web_video_tool", { url: "https://youtu.be/abc" }, { omit: ["media.fetchWebVideo"] });
    await expectNotAvailable("generate_image_and_add_to_timeline_tool", { prompt: "a red fox" }, { omit: ["media.writeGenerated"] });
  });

  it("for speech recognition a host does not have, or a server without it", async () => {
    const deaf: FakeHostOptions = { omit: ["audio.transcribe"] };
    await expectNotAvailable("transcribe_media_tool", { fileId: IDS.broll }, deaf);
    await expectNotAvailable("transcribe_media_tool", { fileId: IDS.interview }, deaf);
    await expectNotAvailable("remove_words_tool", { clipId: IDS.clipA, matches: ["um"] }, deaf);
    await expectNotAvailable("get_transcript_tool", { clipId: IDS.clipB }, deaf);
    await expectNotAvailable("export_captions_tool", { path: "/out/captions.srt", clipId: IDS.clipB }, deaf);
    // A server from before zenvi-backend #67 answers 404.
    const older: FakeHostOptions = { transcripts: { "/media/broll.mp4": transcriptionHttpError(404, { detail: "Not Found" }) } };
    for (const [name, args] of [
      ["get_transcript_tool", { clipId: IDS.clipB }],
      ["transcribe_media_tool", { fileId: IDS.broll }],
      ["remove_words_tool", { clipId: IDS.clipB, fillerPreset: "um_uh" }],
      ["export_captions_tool", { path: "/out/b.srt", clipId: IDS.clipB }],
      ["add_captions_tool", { timeline_clip_id: IDS.clipB }],
    ] as const) {
      const doc = fixtureDoc();
      const result = await runTool({ doc, host: fakeHost(older) }, name, args);
      expect(result.data?.status, name).toBe("refused");
      expect(result.data?.summary, name).toMatch(new RegExp(`^Error: ${name} is not available in this Zenvi surface: speech recognition is not available yet on this Zenvi server`));
      expect(doc.undoLabels, name).toEqual([]);
    }
  });

  it("for local paths on a host without file access (the web editor)", async () => {
    const editor: FakeHostOptions = { omit: ["media.importPath", "media.listPaths", "storage.readText", "storage.writeText"], without: ["audio", "assets"] };
    await expectNotAvailable("import_files_tool", { paths: '["/clips/a.mp4"]' }, editor);
    await expectNotAvailable("watch_clip_tool", { file_path: "/clips/a.mp4" }, editor);
    await expectNotAvailable("import_stock_media_tool", { local_path: "/clips/a.mp4" }, editor);
    await expectNotAvailable("export_captions_tool", { path: "/out/captions.srt" }, editor);
    await expectNotAvailable("add_captions_tool", { srtPath: "/subs/a.srt" }, { omit: ["storage.readText"] });
  });

  it("for downloads and generated media a host cannot store", async () => {
    const noUrls: FakeHostOptions = { omit: ["media.importUrl"] };
    await expectNotAvailable("import_video_url_and_add_to_timeline_tool", { video_url: "https://example.com/a.mp4" }, noUrls);
    await expectNotAvailable("fetch_motion_graphics_video_tool", { segment_urls: "https://example.com/mg.webm" }, noUrls);
    await expectNotAvailable("generate_video_and_add_to_timeline_tool", { prompt: "a sunset over the sea" }, noUrls);
    const noWrites: FakeHostOptions = { omit: ["media.writeGenerated"] };
    await expectNotAvailable("generate_tts_and_add_to_timeline_tool", { text: "Hello there" }, noWrites);
    await expectNotAvailable("add_title_tool", { text: "Hello" }, noWrites);
    await expectNotAvailable("export_video_tool", { show_dialog: "false" }, { without: ["exporter"] });
  });

  it("for editor state a host does not have", async () => {
    await expectNotAvailable("seek_playhead_tool", { to: "start", play: "true" }, { without: ["player"] });
    await expectNotAvailable("select_timeline_items_tool", { mode: "none" }, { omit: ["ui.setSelection"] });
    await expectNotAvailable("set_timeline_view_tool", { zoom: "fit" }, { omit: ["ui.showTimelineRange"] });
    await expectNotAvailable("set_timeline_view_tool", { timing: "true" }, {});
  });

  it("for re-indexing, which uploads from the desktop", async () => {
    await expectNotAvailable("reindex_project_file_tool", { file_id: IDS.broll }, {});
  });

  it("but keeps the desktop's wording for ordinary failures", async () => {
    const result = await runTool({ doc: fixtureDoc(), host: fakeHost() }, "delete_from_timeline_tool", { timeline_clip_id: "NOPE000000" });
    expect(result.ok).toBe(false);
    expect(result.data?.summary).toMatch(/^Error: /);
    expect(result.data?.summary).not.toMatch(/not available/);
  });
});
