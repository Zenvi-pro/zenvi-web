/**
 * Every tool, through runTool with string arguments (as the Zenvi backend
 * sends them) on the fixture edit and a fake host: the happy-path receipt,
 * a failure that leaves the document and its history untouched, and undo
 * restoring the document after a change.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEffect } from "../effects/registry.js";
import type { ProjectDocument } from "../history/document.js";
import type { Project } from "../model/types.js";
import type { ReceiptStatus, ToolReceipt } from "./receipt.js";
import { allTools, runTool } from "./registry.js";
import { fakeHost, type FakeHost, type FakeHostOptions } from "./test-support/fake-host.js";
import { IDS, L1, L3, fixtureDoc, imageInfo, media, snapshotOf } from "./test-support/fixture.js";
import { addClip } from "../ops/clips.js";
import { addFile } from "../ops/files.js";
import { parseTitleSvg, setFieldText, titleFields, titleSvgText } from "../titles/title-svg.js";
import type { ToolResult } from "./types.js";

interface Ctx {
  result: ToolResult<ToolReceipt>;
  receipt: ToolReceipt;
  doc: ProjectDocument;
  host: FakeHost;
  before: Project;
}

interface Case {
  args?: Record<string, unknown>;
  host?: FakeHostOptions;
  /** Runs on the document first; history it records is kept (undo/redo tools). */
  setup?: (doc: ProjectDocument, host: FakeHost) => Promise<void> | void;
  status?: ReceiptStatus;
  summary?: RegExp;
  check?: (ctx: Ctx) => void;
}

interface Spec {
  happy: Case;
  /** null: no failure beyond invalid arguments (covered for every tool in registry.test.ts). */
  failure: Case | null;
}

const SRT = "1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line\n";

/** The engine's bundled assets (title templates, emoji), read on demand. */
const ENGINE_ASSETS = new Proxy({} as Record<string, string>, {
  get: (_target, key) => {
    if (typeof key !== "string") return undefined;
    try {
      return readFileSync(new URL(`../../assets/${key}`, import.meta.url), "utf8");
    } catch {
      return undefined;
    }
  },
});

/** Standard_1 filled with "Day 1" / "Tokyo", the title the title-editing specs edit. */
function dayOneTitle(): string {
  const doc = parseTitleSvg(ENGINE_ASSETS["titles/Standard_1.svg"]!);
  const [title, sub] = titleFields(doc);
  setFieldText(title!, "Day 1");
  setFieldText(sub!, "Tokyo");
  return titleSvgText(doc);
}

/** A Caption effect with two cues on the interview clip. */
function captionInterview(doc: ProjectDocument): void {
  const text = "00:00:01:000 --> 00:00:02:000\nHello there\n\n00:00:03:000 --> 00:00:04:000\nSecond line\n\n";
  doc.transaction("captions", (tx) => tx.update(["clips", { id: IDS.clipA }], { effects: [createEffect("Caption", { caption_text: text }, { id: "CAPTION001" })] }));
}

function clipIds(doc: ProjectDocument): string[] {
  return (doc.project.clips ?? []).map((c) => String(c.id));
}

const SPECS: Record<string, Spec> = {
  // --- project -------------------------------------------------------------
  get_project_info_tool: { happy: { summary: /^Project: profile=HD 720p 30 fps, fps=30\/1, duration=300, scale=15\.0$/ }, failure: null },
  list_files_tool: { happy: { summary: /^Media bin files \(4\):\n {2}media_bin_file_id=FILEINTV01 name='interview\.mp4'/ }, failure: null },
  list_clips_tool: {
    happy: {
      args: { layer: String(L1) },
      summary: /^Timeline clips \(3\)\.$/,
      check: ({ receipt }) => expect((receipt.data as { clips: unknown[] }).clips).toHaveLength(3),
    },
    failure: { args: { layer: "Bogus" }, summary: /^Error: Unknown track or layer 'Bogus'/ },
  },
  list_layers_tool: { happy: { summary: /^Layers \(5\)\. Z-ORDER uses layer_number only/ }, failure: null },
  list_markers_tool: { happy: { summary: /^Markers \(1\):\n {2}id=MARKER0001 position=4\.0 name=Intro ends$/ }, failure: null },
  new_project_tool: {
    happy: {
      summary: /^New project created\.$/,
      check: ({ doc }) => {
        expect(doc.project.clips).toEqual([]);
        expect(doc.project.files).toEqual([]);
        expect(doc.project.profile).toBe("HD 720p 30 fps");
        expect(doc.undoLabels).toEqual([]);
      },
    },
    failure: null,
  },
  save_project_tool: {
    happy: { args: { path: "/projects/edit" }, summary: /^Project saved to \/projects\/edit\.zvn\.$/, check: ({ host }) => expect(host.calls).toContain("save /projects/edit.zvn") },
    failure: { host: { without: ["storage"] }, summary: /not available/ },
  },
  open_project_tool: {
    happy: {
      args: { file_path: "/projects/other.zvn" },
      host: {},
      setup: (_doc, host) => {
        host.storage!.open = async () => ({ ...fixtureDoc().project, id: "OTHER00001", clips: [] });
      },
      summary: /\S/,
      check: ({ doc }) => {
        expect(doc.project.id).toBe("OTHER00001");
        expect(doc.undoLabels).toEqual([]);
      },
    },
    failure: { args: { file_path: "/projects/broken.zvn" }, summary: /^Error: .*cannot open \/projects\/broken\.zvn/ },
  },
  undo_tool: {
    happy: {
      args: { steps: "1" },
      setup: async (doc, host) => {
        await runTool({ doc, host }, "add_marker_tool", { position_seconds: "7.5", label: "Beat" });
      },
      check: ({ doc, receipt }) => {
        expect(doc.project.markers).toHaveLength(1);
        expect(doc.redoLabels).toHaveLength(1);
        expect(receipt.undoSteps).toBe(0);
      },
    },
    failure: { args: { steps: "1" }, summary: /^Error: nothing to undo\.$/ },
  },
  redo_tool: {
    happy: {
      args: { steps: "1" },
      setup: async (doc, host) => {
        await runTool({ doc, host }, "add_marker_tool", { position_seconds: "7.5", label: "Beat" });
        doc.undo();
      },
      check: ({ doc }) => {
        expect(doc.project.markers).toHaveLength(2);
        expect(doc.redoLabels).toHaveLength(0);
      },
    },
    failure: { args: { steps: "1" }, summary: /^Error: nothing to redo\.$/ },
  },

  // --- timeline ------------------------------------------------------------
  add_track_tool: {
    happy: {
      args: { label: "Captions" },
      summary: /^Added track 6 \('Captions'\) at the top\. Track numbers count from the bottom\.$/,
      check: ({ doc, receipt }) => {
        expect(doc.project.layers).toHaveLength(6);
        expect(doc.project.layers.some((l) => l.label === "Captions")).toBe(true);
        expect(receipt.createdTracks).toHaveLength(1);
      },
    },
    failure: null,
  },
  add_marker_tool: {
    happy: {
      args: { position_seconds: "7.5", label: "Beat" },
      summary: /^Marker added\.$/,
      check: ({ doc }) => expect(doc.project.markers.map((m) => m.position)).toContain(7.5),
    },
    // develop's schema: position_seconds is a number (the desktop refuses timecodes too).
    failure: { args: { position_seconds: "abc" }, summary: /^Error: Invalid arguments for add_marker_tool: 'abc' is not valid under any of the given schemas \(at position_seconds\)\.$/ },
  },
  delete_from_timeline_tool: {
    happy: {
      args: { timeline_clip_id: IDS.clipB },
      summary: /^Deleted timeline clip CLIPBROL01 \('broll\.mp4'\) from track 1000000/,
      check: ({ receipt, doc }) => {
        expect(receipt.removedClipIds).toEqual([IDS.clipB]);
        expect(clipIds(doc)).not.toContain(IDS.clipB);
      },
    },
    failure: { args: { timeline_clip_id: "NOPE000000" }, summary: /^Error: No timeline clip with id='NOPE000000'\.$/ },
  },
  remove_clip_tool: {
    happy: { args: { timeline_clip_id: IDS.clipLogo }, summary: /^Deleted timeline clip CLIPLOGO01/, check: ({ receipt }) => expect(receipt.removedClipIds).toEqual([IDS.clipLogo]) },
    failure: { args: { timeline_clip_id: "NOPE000000" }, summary: /^Error: / },
  },
  delete_clips_on_track_tool: {
    happy: { args: { track: "3" }, summary: /^Deleted 1 clips and 0 transitions on track 3000000/, check: ({ doc }) => expect(doc.project.clips.some((c) => c.layer === L3)).toBe(false) },
    failure: { args: { track: "Nope" }, summary: /^Error: / },
  },
  slice_clip_at_playhead_tool: {
    happy: { summary: /^Sliced 2 item\(s\) at the playhead; both sides kept\.$/, check: ({ doc }) => expect(doc.project.clips).toHaveLength(7) },
    // Slices whatever is under the playhead; no argument can fail it.
    failure: null,
  },

  // --- clips / placement -----------------------------------------------------
  get_file_info_tool: {
    happy: { args: { file_id: IDS.interview }, summary: /^file_id=FILEINTV01 path=\/media\/interview\.mp4 duration_seconds=20\.00 source_fps=30\/1/ },
    failure: { args: { file_id: "NOPE" }, summary: /^Error: File not found for id=NOPE\.$/ },
  },
  add_clip_to_timeline_tool: {
    happy: {
      args: { file_id: IDS.broll, start_seconds: "1", end_seconds: "4", position_seconds: "20", track: "1" },
      summary: /^Added clip to timeline at position 20\.0s on track 1000000 .* duration=3\.00s timeline_clip_id=\w+ \(watched\)\.$/,
      check: ({ receipt }) => expect(receipt.clips).toHaveLength(1),
    },
    failure: { args: { file_id: IDS.music }, summary: /^Error: audio placement needs position_seconds/ },
  },
  split_file_add_clip_tool: {
    happy: {
      args: { file_id: IDS.interview, start_seconds: "2", end_seconds: "6" },
      summary: /^Subclip created: "interview \(00:00:02:00\)" \(file_id=\w+\) from 0:02–0:06 source/,
      check: ({ doc }) => expect(doc.project.files).toHaveLength(5),
    },
    failure: { args: { file_id: "NOPE", start_seconds: "2", end_seconds: "6" }, summary: /^Error: / },
  },
  import_video_url_and_add_to_timeline_tool: {
    happy: { args: { video_url: "https://example.com/clip.mp4", position_seconds: "20" }, summary: /^✅ Video imported \(file_id: \w+, 0\.0 MB\) and added to the timeline\./ },
    failure: { args: { video_url: "" }, summary: /^Error: video_url is required\.$/ },
  },

  // --- playback / view ---------------------------------------------------------
  play_tool: { happy: { summary: /^Playing at 1x, now at 1\.00 s\.$/, check: ({ host }) => expect(host.calls).toEqual(["toggle"]) }, failure: { host: { without: ["player"] }, summary: /not available/ } },
  go_to_start_tool: { happy: { summary: /^Seeked to start\.$/, check: ({ host }) => expect(host.player!.playhead).toBe(0) }, failure: { host: { without: ["player"] }, summary: /not available/ } },
  go_to_end_tool: { happy: { summary: /^Seeked to end\.$/, check: ({ host }) => expect(host.player!.playhead).toBeCloseTo(18.9667, 3) }, failure: { host: { without: ["player"] }, summary: /not available/ } },
  zoom_in_tool: { happy: { summary: /zoomed in/, check: ({ host }) => expect(host.calls).toEqual(["zoomIn"]) }, failure: { host: { without: ["ui"] }, summary: /not available/ } },
  zoom_out_tool: { happy: { summary: /zoomed out/, check: ({ host }) => expect(host.calls).toEqual(["zoomOut"]) }, failure: { host: { without: ["ui"] }, summary: /not available/ } },
  center_on_playhead_tool: { happy: { summary: /^Centered on playhead\.$/, check: ({ host }) => expect(host.calls).toEqual(["centerOnPlayhead"]) }, failure: { host: { without: ["ui"] }, summary: /not available/ } },
  watch_clip_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA }, summary: /^Loaded and playing: interview\.mp4$/, check: ({ host }) => expect(host.calls).toEqual(["seek 0", "play"]) },
    failure: { args: { timeline_clip_id: "NOPE" }, summary: /^Error: No timeline clip with id='NOPE'\.$/ },
  },

  // --- audio -------------------------------------------------------------------
  analyze_timeline_audio_tool: {
    happy: { summary: /^Timeline audio \(4 clip\(s\) with sound\):\n {2}timeline_clip_id=CLIPINTV01 audio_role=speech/ },
    failure: { args: { track: "Nope" }, summary: /^Error: Unknown track or layer 'Nope'/ },
  },
  set_clip_volume_tool: {
    happy: { args: { timeline_clip_id: IDS.clipMusic, db: "-6" }, summary: /^Set volume on timeline_clip_id=CLIPMUSC01 .*: 1\.00 -> 0\.501 \(-6\.0 dB\) over whole clip/ },
    failure: { args: { timeline_clip_id: IDS.clipMusic, volume: "loud" }, summary: /^Error: set_clip_volume requires level_db or level\.$/ },
  },
  duck_under_speech_tool: {
    happy: { args: { bed_clip_ids: IDS.clipMusic }, summary: /^Ducked 1 bed clip\(s\) under 1 speech clip\(s\)\./ },
    failure: { args: { bed_clip_ids: "NOPE" }, summary: /^Error: no timeline clip with audio for id=NOPE\.$/ },
  },

  // --- export --------------------------------------------------------------------
  export_video_tool: {
    happy: {
      args: { show_dialog: "false", output_path: "/exports/out.mp4" },
      summary: /^Exported to \/exports\/out\.mp4\.$/,
      check: ({ host }) => {
        expect(host.exports).toHaveLength(1);
        expect(host.exports[0]!.format).toBe("mp4");
        expect(host.exports[0]!.width).toBe(1280);
      },
    },
    failure: { args: { show_dialog: "false", output_path: "/media/interview.mp4" }, summary: /^Error: Export failed: Output path is an input file/ },
  },
  get_export_settings_tool: { happy: { summary: /^Export type: Video & Audio\nDefault path: export\.mp4\nVideo: 1280x720, 30\/1 fps, codec libx264/ }, failure: null },
  set_export_setting_tool: {
    happy: {
      args: { key: "width", value: "640" },
      summary: /^Set width = 640\.$/,
      check: ({ doc }) => {
        expect(doc.project.export_overrides).toMatchObject({ width: 640 });
        expect(doc.undoLabels).toEqual([]);
      },
    },
    failure: { args: { key: "width", value: "wide" }, summary: /^Error: width must be an integer \(got wide\)\.$/ },
  },

  // --- media / import --------------------------------------------------------------
  import_files_tool: {
    happy: { args: { paths: '["/clips/new.mp4"]' }, summary: /^Imported 1 file\(s\)\. indexing_started=false\nfile_id=\w+ path=\/clips\/new\.mp4$/, check: ({ doc }) => expect(doc.project.files).toHaveLength(5) },
    failure: { args: { paths: "/missing/a.mp4" }, summary: /^Error: Nothing to import/ },
  },
  import_stock_media_tool: {
    happy: {
      args: { source: "pexels", video_id: "101", link: "https://videos.pexels.com/101-hd.mp4", position_seconds: "20" },
      summary: /^Added to project: \/downloads\/pexels_101\.mp4 \(file_id=\w+\)\. Added clip to timeline at position 20\.0s/,
      check: ({ host }) => expect(host.calls).toContain("importUrl https://videos.pexels.com/101-hd.mp4"),
    },
    failure: { args: { link: "https://videos.pexels.com/101-hd.mp4" }, summary: /^Error: source must be 'pexels' or 'freesound'/ },
  },
  wait_until_project_indexed_tool: { happy: { summary: /^Indexed 1\/4 file\(s\)/ }, failure: null },
  resummarize_project_file_tool: {
    happy: {
      args: { file_id: IDS.interview },
      summary: /^Summarize complete for file FILEINTV01/,
      check: ({ doc }) => expect(doc.project.files.find((f) => f.id === IDS.interview)?.ai_metadata).toMatchObject({ short_summary: "Re-summarized." }),
    },
    failure: { args: { file_id: "NOPE" }, summary: /^Error: File not found \(id=NOPE\)\.$/ },
  },
  reindex_project_file_tool: {
    happy: { args: { file_id: IDS.interview }, status: "unchanged", summary: /^File FILEINTV01 is already indexed \(index_id=IDX0001, video_id=VID0001\)\./ },
    failure: { args: { file_id: IDS.broll }, summary: /not available/ },
  },

  // --- search / index ----------------------------------------------------------------
  search_clips_tool: {
    happy: {
      args: { query: "cameras", look_for: "spoken", top_k: "5" },
      // The desktop classifies this prose by its words ("already-placed"), so it reads as unchanged.
      status: "unchanged",
      summary: /2 occurrences:\n {6}1\. start_seconds=2\.500 .* \(rank=2\)\n {6}2\. start_seconds=12\.000 .* \(rank=1\) {2}<-- best match\n {6}Place the best match/,
      check: ({ host }) => expect(host.backendCalls.find((c) => c.path === "/api/v1/search")?.body).toMatchObject({ look_for: "spoken" }),
    },
    failure: { args: { query: "cameras" }, host: { routes: { "/api/v1/search": () => ({ error: "index offline" }) } }, summary: /^Error: index offline$/ },
  },
  search_clip_scenes_tool: {
    happy: { args: { query: "cameras", timeline_clip_id: IDS.clipA }, summary: /^Index matches in 'interview\.mp4' \(0:00 - 0:10\):\n- keep 0:02-0:04/ },
    failure: { args: { query: "cameras", timeline_clip_id: "NOPE" }, summary: /^Error: / },
  },
  get_project_catalog_tool: {
    happy: { summary: /^Project catalog \(1 media items\):\n- \[video\] interview\.mp4 \[20\.0s\] file_id=FILEINTV01: A speaker introduces a camera review\.$/ },
    failure: { host: { routes: { "/api/v1/indexing/catalog": () => ({ error: "catalog offline" }) } }, summary: /^Error: catalog offline$/ },
  },
  slice_clip_at_best_match_tool: {
    happy: {
      args: { query: "the intro", timeline_clip_id: IDS.clipA, start_seconds: "2", end_seconds: "4" },
      summary: /^Sliced at 0:02 and 0:04 \(source\)\. Three segments: before, selected range, after\.$/,
      check: ({ doc }) => expect(doc.project.clips).toHaveLength(7),
    },
    failure: { args: { query: "x", timeline_clip_id: IDS.clipA, start_seconds: "nan" }, summary: /^Error: start_seconds='nan' is not a time in seconds/ },
  },
  watch_clip_window_tool: {
    happy: {
      args: { timeline_clip_id: IDS.clipA, start: "1", end: "3", query: "a man holding a tablet" },
      summary: /^Watched \d+ frames of 'interview\.mp4' \(source seconds; this clip plays 0\.00-10\.00\): 0\.00, .*\nShot cuts in window: none\.\nVisible 1\.000s–3\.000s source; peak 1\.000s source \(0:01 into the clip\)\./,
    },
    failure: { args: { timeline_clip_id: IDS.clipA, start: "0:14x", end: "3" }, summary: /^Error: start='0:14x' is not a time in seconds/ },
  },

  // --- motion graphics ------------------------------------------------------------------
  suggest_motion_graphics_placements_tool: {
    // Removed on the desktop too: the receipt points at its replacement.
    happy: { status: "error", summary: /^Error: suggest_motion_graphics_placements_tool is removed\. Call propose_overlay_windows_tool/ },
    failure: null,
  },
  propose_overlay_windows_tool: {
    happy: { args: { beat_count: "3" }, summary: /^\{\n {2}"timeline_end": 19,/, check: ({ receipt }) => expect(receipt.data).toMatchObject({ windows: expect.any(Array) }) },
    failure: null,
  },
  place_motion_graphic_tool: {
    happy: { args: { file_id: IDS.logo, mode: "cut_in", position_seconds: "5", duration_seconds: "2" }, summary: /^Added clip to timeline at position 5\.0s .*\[mg_place mode=cut_in/ },
    failure: { args: { file_id: IDS.logo, mode: "gap", position_seconds: "10", duration_seconds: "2" }, summary: /^Error: gap mode refused/ },
  },
  fetch_motion_graphics_video_tool: {
    happy: { args: { segment_urls: "https://cdn.example.com/mg.webm" }, summary: /^✅ Imported 1\/1 HyperFrames segments/, check: ({ doc }) => expect(doc.project.files).toHaveLength(5) },
    failure: { summary: /^Error: segment_urls or supabase_url is required\.$/ },
  },
  fetch_remotion_video_from_supabase_tool: {
    happy: { args: { supabase_url: "https://cdn.example.com/mg2.mp4" }, summary: /^✅ HyperFrames motion graphic imported/ },
    failure: { summary: /^Error: segment_urls or supabase_url is required\.$/ },
  },

  // --- metadata ---------------------------------------------------------------------------
  get_clips_with_full_metadata_tool: { happy: { summary: /^Project files with full metadata:\n\n {2}media_bin_file_id=FILEINTV01/ }, failure: null },
  get_timeline_placements_metadata_tool: { happy: { summary: /^Timeline placements \(5\):/ }, failure: { args: { track: "Nope" }, summary: /^Error: / } },
  get_timeline_state_tool: {
    happy: { summary: /^Timeline: 5 clip\(s\), 5 track\(s\)\.$/, check: ({ receipt }) => expect(receipt.data).toMatchObject({ tracks: expect.any(Array) }) },
    failure: null,
  },

  // --- effects / keyframes / settings -----------------------------------------------------------
  add_effect_tool: {
    happy: {
      args: { timeline_clip_id: IDS.clipA, effect: "Blur" },
      summary: /^Added effect 'Blur' to timeline_clip_id=CLIPINTV01 \(effect_id=\w+\)\.$/,
      check: ({ doc }) => expect(doc.project.clips.find((c) => c.id === IDS.clipA)?.effects).toHaveLength(1),
    },
    failure: { args: { timeline_clip_id: IDS.clipA, effect: "NoSuchEffect" }, summary: /^Error: unknown effect 'NoSuchEffect'\./ },
  },
  set_keyframes_tool: {
    happy: {
      args: { timeline_clip_id: IDS.clipLogo, property: "alpha", points: [{ seconds: 0, value: 0 }, { seconds: 1, value: 1 }] },
      summary: /^Set 2 keyframe\(s\) on alpha for timeline_clip_id=CLIPLOGO01\.$/,
    },
    failure: {
      args: { timeline_clip_id: IDS.clipLogo, property: "alpha", points: [{ value: 1 }] },
      summary: /^Error: points\[0\] needs exactly one of frame, seconds, timeline_seconds or source_seconds\.$/,
    },
  },
  set_project_setting_tool: {
    happy: { args: { fps: "25" }, summary: /^Updated project settings: fps=25\/1\.$/, check: ({ doc }) => expect(doc.project.fps).toEqual({ num: 25, den: 1 }) },
    failure: { args: { fps: "fast" }, summary: /^Error: Invalid arguments for set_project_setting_tool: 'fast' is not valid under any of the given schemas \(at fps\)\.$/ },
  },

  // --- inspect -------------------------------------------------------------------------------------
  inspect_timeline_tool: {
    happy: {
      args: { startFrame: "1", endFrame: "60", maxFrames: "3" },
      summary: /^Rendered 3 inspect image\(s\)\.$/,
      check: ({ result }) => {
        expect(result.images).toHaveLength(3);
        expect(["image/png", "image/jpeg"]).toContain(result.images![0]!.mimeType);
      },
    },
    failure: { summary: /^Error: Provide startFrame, or clipId\+start\+end, or overview=true\.$/ },
  },
  inspect_media_tool: {
    happy: { args: { fileId: IDS.interview, maxFrames: "2" }, summary: /^Rendered 2 inspect image\(s\)\.$/, check: ({ result }) => expect(result.images).toHaveLength(2) },
    failure: { args: { fileId: "NOPE" }, summary: /^Error: Unknown fileId 'NOPE'\.$/ },
  },

  // --- speech --------------------------------------------------------------------------------------
  get_transcript_tool: {
    happy: {
      args: { clipId: IDS.clipA },
      summary: /^Transcribed 13 words \(index_cues\)\. clipId=CLIPINTV01/,
      check: ({ receipt }) => expect(receipt.data).toMatchObject({ transcriptionSource: "index_cues", script: expect.stringContaining("Hello and welcome") }),
    },
    failure: { args: { clipId: "NOPE" }, summary: /^Error: Unknown clipId 'NOPE'\.$/ },
  },
  transcribe_media_tool: { happy: { args: { fileId: IDS.interview }, status: "refused", summary: /not available in this Zenvi surface/ }, failure: null },
  remove_words_tool: { happy: { args: { clipId: IDS.clipA, matches: ["um"] }, status: "refused", summary: /not available in this Zenvi surface/ }, failure: null },
  remove_silence_tool: {
    happy: {
      args: { clipId: IDS.clipA },
      summary: /^Removed 3\.70s silence \(3 gap\(s\)\)\.$/,
      check: ({ receipt }) => expect(receipt.data).toMatchObject({ vadSource: expect.any(String) }),
    },
    failure: { args: { clipId: "NOPE" }, summary: /^Error: Unknown clipId 'NOPE'\.$/ },
  },
  export_captions_tool: {
    happy: {
      args: { path: "/out/captions.srt", clipId: IDS.clipA },
      summary: /^Exported 3 cue\(s\) to \/out\/captions\.srt\.$/,
      check: ({ host }) => expect(String(host.written.get("/out/captions.srt"))).toMatch(/^1\n00:00:00,500 --> /),
    },
    failure: { args: { path: "/out/captions.srt", clipId: IDS.clipB }, summary: /not available/ },
  },
  detect_beats_tool: { happy: { args: { fileId: IDS.music }, status: "refused", summary: /not available in this Zenvi surface/ }, failure: null },
  diarize_media_tool: { happy: { args: { fileId: IDS.interview }, status: "refused", summary: /not available in this Zenvi surface/ }, failure: null },
  search_media_local_tool: { happy: { args: { query: "dog" }, status: "refused", summary: /not available in this Zenvi surface/ }, failure: null },

  // --- generation ------------------------------------------------------------------------------------
  generate_video_and_add_to_timeline_tool: {
    happy: {
      args: { prompt: "a sunset over the sea", position_seconds: "20" },
      summary: /^Added clip to timeline at position 20\.0s on track 1000000/,
      check: ({ host }) => expect(host.backendCalls.find((c) => c.path === "/api/v1/generation/video")?.body).toMatchObject({ prompt: "a sunset over the sea", duration_seconds: 5 }),
    },
    failure: { args: { prompt: "a" }, summary: /^Error: Prompt must be at least 2 characters\.$/ },
  },
  generate_tts_and_add_to_timeline_tool: {
    happy: {
      args: { text: "Welcome to the show", position: "2" },
      summary: /^Added TTS audio to timeline at position 2\.0s on track 1000000 .* timeline_clip_id=\w+\.$/,
      check: ({ host }) => expect(host.backendCalls.find((c) => c.path === "/api/v1/generation/tts")?.body).toMatchObject({ text: "Welcome to the show", voice: "alloy" }),
    },
    failure: { args: { text: "Hi", track: "Nope" }, summary: /^Error: Unknown track or layer 'Nope'/ },
  },
  modify_clip_tool: { happy: { args: { timeline_clip_id: IDS.clipA, description: "make it night" }, status: "refused", summary: /not available in this Zenvi surface/ }, failure: null },
  generate_transition_clip_tool: { happy: { args: { clip_a_id: IDS.clipA, clip_b_id: IDS.clipB }, status: "refused", summary: /not available in this Zenvi surface/ }, failure: null },

  // --- transitions / titles ------------------------------------------------------------------------------
  list_transitions_tool: {
    happy: {
      args: { category: "common" },
      summary: /^\{\n {2}"total": 7,\n {2}"transitions": \[\n {4}\{\n {6}"name": "Circle in to out",/,
    },
    failure: null,
  },
  search_transitions_tool: {
    happy: { args: { query: "wipe left" }, summary: /"matches": 1,[\s\S]*"filename": "wipe_left_to_right\.svg"/ },
    failure: null,
  },
  apply_transition_tool: {
    happy: {
      args: { clip1_id: IDS.clipA, clip2_id: IDS.clipB, transition_name: "fade", duration: "1" },
      summary: /^Added 'fade' transition between clips \(overlap: 1\.00s\)\.\nClip2 moved to 9\.00s\. Transition ID: \w+$/,
      check: ({ doc }) => {
        expect(doc.project.effects).toHaveLength(1);
        expect(doc.project.clips.find((c) => c.id === IDS.clipB)?.position).toBe(9);
      },
    },
    failure: { args: { clip1_id: IDS.clipA, clip2_id: IDS.clipB, transition_name: "no such thing" }, summary: /^Error: Transition 'no such thing' not found\. Use search_transitions_tool\.$/ },
  },
  add_title_tool: {
    happy: {
      args: { text: "Chapter One", position_seconds: "3", duration_seconds: "4" },
      summary: /^Added title 'Chapter One' from template Bar_1\.svg at 3\.000s for 4\.000s\. Added clip to timeline at position 3\.0s/,
      check: ({ host, receipt }) => {
        const path = (receipt.data as { path: string }).path;
        expect(String(new TextDecoder().decode(host.written.get(path) as Uint8Array))).toContain(">Chapter One</tspan>");
      },
    },
    failure: { args: { text: "Chapter One", template: "NoSuchTemplate" }, summary: /^Error: title template not found \(NoSuchTemplate\)\.$/ },
  },
  add_captions_tool: {
    happy: {
      args: { srtPath: "/subs/a.srt" },
      host: { texts: { "/subs/a.srt": SRT } },
      summary: /^Placed 2 caption\(s\) \(group cap_\w+\)\.$/,
      check: ({ receipt, doc }) => {
        expect(receipt.data).toMatchObject({ count: 2, transcriptionSource: "srt" });
        expect(doc.project.files).toHaveLength(6);
      },
    },
    failure: { args: { srtPath: "/subs/missing.srt" }, summary: /^Error: srtPath not found: \/subs\/missing\.srt$/ },
  },
  list_title_templates_tool: {
    happy: { args: { kind: "static", query: "lower third" }, host: { assets: ENGINE_ASSETS }, summary: /^Found 3 title template\(s\) matching 'lower third'\.$/ },
    failure: { args: { kind: "sideways" }, status: "refused", summary: /^Error: Invalid arguments for list_title_templates_tool: 'sideways' is not one of/ },
  },
  edit_title_tool: {
    happy: {
      args: { title_query: "tokyo", text: "Day 2", text_color: "#FFD700" },
      host: { texts: { "/titles/Day 1.svg": dayOneTitle() } },
      setup: (doc) => {
        doc.transaction("title", (tx) => {
          const file = addFile(tx, media("/titles/Day 1.svg", imageInfo("/titles/Day 1.svg")), { mediaType: "image" });
          addClip(tx, { fileId: file.id, position: 0, layer: 4_000_000, start: 0, end: 5 });
        });
      },
      summary: /^Updated title 'Day 2 \/ Tokyo' on 1 clip\(s\)\.$/,
      check: ({ receipt, host }) => {
        expect(receipt.data).toMatchObject({ scope: "all_clips", text_color: "#ffd700", path: "/generated/Day 1 v2.svg" });
        expect(new TextDecoder().decode(host.written.get("/generated/Day 1 v2.svg") as Uint8Array)).toContain(">Day 2</tspan>");
      },
    },
    failure: { args: { text: "x" }, summary: /^Error: which title\? pass timeline_clip_id, file_id or title_query \(0 titles in the project/ },
  },
  add_animated_title_tool: {
    happy: {
      args: { template: "fly_by_1", text: "Chapter One", position_seconds: "2" },
      summary: /^Added animated title 'Fly Towards Camera' \(a 2D keyframed title, 80 frames\) on track \d at 2\.00-4\.67s\.$/,
      check: ({ receipt, doc }) => {
        const clip = doc.project.clips.find((c) => c.id === (receipt.data as { timeline_clip_id: string }).timeline_clip_id);
        expect(clip?.title).toBe("Fly Towards Camera");
      },
    },
    failure: { args: { template: "earth" }, status: "refused", summary: /^Error: add_animated_title_tool is not available in this Zenvi surface: World Map is a 3D scene/ },
  },
  list_captions_tool: {
    happy: { setup: captionInterview, summary: /^1 caption track\(s\), 2 cue\(s\)\.$/ },
    failure: { args: { timeline_clip_id: "NOPE" }, summary: /^Error: no timeline clip with id='NOPE'$/ },
  },
  edit_captions_tool: {
    happy: { setup: captionInterview, args: { shift_seconds: "0.5", uppercase: "true" }, summary: /^Updated captions on CLIPINTV01: shifted \+0\.50s, uppercase \(2 cue\(s\)\)\.$/ },
    failure: { args: { shift_seconds: "1" }, summary: /^Error: there are no captions in the project; add them with add_captions_tool$/ },
  },
  remove_captions_tool: {
    happy: { setup: captionInterview, args: { all_captions: "true" }, summary: /^Removed 1 caption track\(s\) from 1 clip\(s\)\.$/ },
    failure: { summary: /^Error: there are no captions in the project; add them with add_captions_tool$/ },
  },
  add_timer_tool: {
    happy: {
      args: { mode: "count_down", countdown_from_seconds: "5" },
      summary: /^Added a count down timer on track 4 at 0\.00-5\.00s \(bottom center\)\.$/,
      check: ({ doc, receipt }) => {
        const clip = doc.project.clips.find((c) => c.id === (receipt.data as { timeline_clip_id: string }).timeline_clip_id);
        expect(clip?.effects.map((e) => e.class_name)).toEqual(["Timer"]);
      },
    },
    failure: { args: { timeline_clip_id: "NOPE" }, summary: /^Error: no timeline clip with id='NOPE'$/ },
  },
  search_emojis_tool: {
    happy: { args: { query: "fire", limit: "3" }, host: { assets: ENGINE_ASSETS }, summary: /^3 emoji match 'fire': 🔥 Fire, / },
    failure: { host: { assets: ENGINE_ASSETS }, summary: /^Error: pass a query \(e\.g\. 'fire'\) or a group$/ },
  },
  add_emoji_tool: {
    happy: {
      args: { emoji: "fire", position_seconds: "6", duration_seconds: "2" },
      host: { assets: ENGINE_ASSETS },
      summary: /^Added 🔥 Fire on track \d at 6\.00-8\.00s \(center, size 0\.2\)\.$/,
    },
    failure: { args: { emoji: "zzqqxxjj" }, host: { assets: ENGINE_ASSETS }, summary: /^Error: no emoji matches 'zzqqxxjj'; try search_emojis_tool with a simpler word$/ },
  },

  // --- direct tools ----------------------------------------------------------------------------------------
  describe_project_tool: { happy: { summary: /^1280x720 30\/1 fps, 5 track\(s\), 5 clip\(s\), 0 transition\(s\), 4 file\(s\); content ends at 19\.00s\.$/ }, failure: null },
  list_effects_tool: { happy: { args: { category: "audio" }, summary: /^\d+ effect\(s\)\.$/ }, failure: { args: { category: "smell" }, status: "refused", summary: /^Error: Invalid arguments/ } },
  move_clip_tool: {
    happy: { args: { clip_id: IDS.clipLogo, position_seconds: "6", track: "4" }, summary: /^Moved clip CLIPLOGO01\.$/, check: ({ doc }) => expect(doc.project.clips.find((c) => c.id === IDS.clipLogo)).toMatchObject({ position: 6, layer: 4_000_000 }) },
    failure: { args: { clip_id: "NOPE", position_seconds: "6" }, summary: /^Error: No timeline clip with id='NOPE'\.$/ },
  },
  trim_clip_tool: {
    happy: { args: { clip_id: IDS.clipA, start_seconds: "1", end_seconds: "9" }, summary: /^Trimmed clip CLIPINTV01\.$/, check: ({ doc }) => expect(doc.project.clips.find((c) => c.id === IDS.clipA)).toMatchObject({ start: 1, end: 9 }) },
    failure: { args: { clip_id: IDS.clipA, edge: "left" }, summary: /^Error: edge and at_seconds go together\.$/ },
  },
  split_clip_tool: {
    happy: { args: { clip_id: IDS.clipA, at_seconds: "5" }, summary: /^Split clip CLIPINTV01 at 5s \(keep both\)\.$/, check: ({ doc }) => expect(doc.project.clips).toHaveLength(6) },
    failure: { args: { clip_id: IDS.clipA, at_seconds: "50" }, summary: /^Error: Time 50 s is not inside clip CLIPINTV01/ },
  },
  set_clip_property_tool: {
    happy: { args: { clip_id: IDS.clipLogo, property: "alpha", value: "0.5" }, summary: /^Set alpha on clip CLIPLOGO01\.$/ },
    failure: { args: { clip_id: IDS.clipLogo, property: "bogus", value: "1" }, summary: /^Error: Unknown clip property: bogus\.$/ },
  },
  set_effect_property_tool: {
    happy: {
      args: { property: "sigma", value: "5" },
      setup: async (doc, host) => {
        await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur" });
      },
      summary: /^Set sigma on effect \w+\.$/,
    },
    failure: { args: { effect_id: "NOPE", property: "sigma", value: "5" }, summary: /^Error: / },
  },
  remove_effect_tool: {
    happy: {
      setup: async (doc, host) => {
        await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur" });
      },
      summary: /^Removed effect \w+ from clip CLIPINTV01\.$/,
      check: ({ doc }) => expect(doc.project.clips.find((c) => c.id === IDS.clipA)?.effects).toHaveLength(0),
    },
    failure: { args: { effect_id: "NOPE" }, summary: /^Error: No effect with id NOPE\.$/ },
  },
  set_clip_speed_tool: {
    happy: { args: { clip_id: IDS.clipB, factor: "2" }, summary: /^Set clip CLIPBROL01 to 2x forward\.$/ },
    failure: { args: { clip_id: IDS.clipB, factor: "0" }, status: "refused", summary: /^Error: Invalid arguments for set_clip_speed_tool: 0 is less than or equal to the minimum of 0 \(at factor\)\.$/ },
  },
  fade_clip_tool: {
    happy: { args: { clip_id: IDS.clipA, fade_in_seconds: "1", fade_out_seconds: "1" }, summary: /^Faded clip CLIPINTV01\.$/ },
    failure: { args: { clip_id: IDS.clipA }, summary: /^Error: Pass fade_in_seconds and\/or fade_out_seconds\.$/ },
  },
  add_transition_tool: {
    happy: { args: { track: "1", position_seconds: "9", duration_seconds: "1", transition: "common/fade" }, summary: /^Added transition \w+ \(Transition\)\.$/, check: ({ doc }) => expect(doc.project.effects).toHaveLength(1) },
    failure: { args: { track: "1", position_seconds: "9", duration_seconds: "1", transition: "nope/none" }, summary: /^Error: Transition 'nope\/none' not found\.$/ },
  },
  probe_media_tool: {
    happy: { args: { path: "/media/interview.mp4" }, summary: /^\/media\/interview\.mp4: 1280x720 30\/1 fps, 2 ch 48000 Hz, 8\.00s\.$/ },
    failure: { args: { path: "/media/missing.mp4" }, summary: /^Error: No media at \/media\/missing\.mp4$/ },
  },
};

/** Fill an arg that needs the setup's ids (set_effect_property_tool / remove_effect_tool). */
function effectArgs(doc: ProjectDocument, args: Record<string, unknown>): Record<string, unknown> {
  if ("effect_id" in args) return args;
  const effect = doc.project.clips.find((c) => c.id === IDS.clipA)?.effects?.[0];
  return effect ? { effect_id: effect.id, ...args } : args;
}

async function runCase(name: string, c: Case): Promise<Ctx> {
  const doc = fixtureDoc();
  const host = fakeHost(c.host);
  if (c.setup) await c.setup(doc, host);
  const before = snapshotOf(doc.project) as Project;
  const args = name === "set_effect_property_tool" || name === "remove_effect_tool" ? effectArgs(doc, c.args ?? {}) : c.args ?? {};
  const result = await runTool({ doc, host }, name, args);
  return { result, receipt: result.data!, doc, host, before };
}

describe("every tool has a spec", () => {
  it("covers the whole catalog", () => {
    expect(Object.keys(SPECS).sort()).toEqual(allTools.map((t) => t.name).sort());
  });
});

for (const [name, spec] of Object.entries(SPECS)) {
  describe(name, () => {
    it("happy path receipt; undo restores the document", async () => {
      const ctx = await runCase(name, spec.happy);
      const { result, receipt, doc, before } = ctx;
      expect(result.text).toBe(JSON.stringify(receipt));
      expect(receipt.contract).toBe(3);
      expect(receipt.tool).toBe(name);
      const status = spec.happy.status ?? "applied";
      expect({ status: receipt.status, summary: receipt.summary }).toMatchObject({ status });
      expect(result.ok).toBe(status === "applied" || status === "unchanged");
      if (spec.happy.summary) expect(receipt.summary).toMatch(spec.happy.summary);
      spec.happy.check?.(ctx);
      if (receipt.undoSteps === 1) {
        const undoneLabels = doc.undo();
        expect(undoneLabels).toHaveLength(1);
        expect(snapshotOf(doc.project)).toEqual(before);
      } else if (!["undo_tool", "redo_tool", "new_project_tool", "open_project_tool"].includes(name)) {
        // No undo step: nothing tracked changed (untracked export overrides aside).
        const after = snapshotOf(doc.project) as Record<string, unknown>;
        const { export_overrides: _a, ...restAfter } = after;
        const { export_overrides: _b, ...restBefore } = before as unknown as Record<string, unknown>;
        expect(restAfter).toEqual(restBefore);
      }
    });

    if (spec.failure) {
      const failure = spec.failure;
      it("failure leaves the document and history untouched", async () => {
        const { result, receipt, doc, before } = await runCase(name, failure);
        expect(result.ok).toBe(false);
        expect(["error", "refused"]).toContain(receipt.status);
        if (failure.status) expect(receipt.status).toBe(failure.status);
        expect(receipt.summary).toMatch(/^Error/);
        if (failure.summary) expect(receipt.summary).toMatch(failure.summary);
        expect(receipt.undoSteps).toBe(0);
        expect(snapshotOf(doc.project)).toEqual(before);
        expect(doc.undoLabels.length).toBe(failure.setup ? doc.undoLabels.length : 0);
      });
    }
  });
}
