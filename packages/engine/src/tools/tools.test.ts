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
import { createProject } from "../model/defaults.js";
import { addClip } from "../ops/clips.js";
import { addFile } from "../ops/files.js";
import { addTransition } from "../ops/transitions.js";
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

/** A snapshot without speech recognition results kept on files (`ai_metadata.asr`): they are not edits and survive undo. */
function withoutTranscripts(snapshot: unknown): unknown {
  const project = structuredClone(snapshot) as { files?: { ai_metadata?: Record<string, unknown> }[] };
  for (const file of project.files ?? []) {
    if (!file.ai_metadata || !("asr" in file.ai_metadata)) continue;
    delete file.ai_metadata.asr;
    if (Object.keys(file.ai_metadata).length === 0) delete file.ai_metadata;
  }
  return project;
}

function clipIds(doc: ProjectDocument): string[] {
  return (doc.project.clips ?? []).map((c) => String(c.id));
}

/** A fade-out at the end of the interview clip and a circle wipe on the b-roll, with known ids. */
function withTransitions(doc: ProjectDocument): void {
  doc.transaction("transitions", (tx) => {
    addTransition(tx, { layer: L1, position: 9, duration: 1, maskId: "common/fade", direction: "out", id: "TRANSFADE1" });
    addTransition(tx, { layer: L1, position: 12, duration: 1, maskId: "common/circle_in_to_out", id: "TRANSCIRC1" });
  });
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

  // --- timeline edit (editor_tools/timeline_edit*.py) -------------------------
  add_clips_to_timeline_tool: {
    happy: {
      args: { file_ids: IDS.broll, track: "1" },
      summary: /^Placed 1 clip\(s\) on track 1 from 19\.00 s to 31\.00 s \(12\.0 s\)\.$/,
      check: ({ doc }) => expect(doc.project.clips).toHaveLength(6),
    },
    failure: { args: { file_ids: "NOPE" }, summary: /^Error: no project file with id='NOPE'/ },
  },
  move_clips_tool: {
    happy: { args: { timeline_clip_ids: IDS.clipLogo, by_seconds: "1" }, summary: /^Moved 1 clip\(s\) to track 3 at 3\.00 s\.$/ },
    failure: { args: { timeline_clip_ids: IDS.clipLogo }, summary: /^Error: nothing to do/ },
  },
  trim_clips_tool: {
    happy: { args: { timeline_clip_ids: IDS.clipA, trim_start_seconds: "1" }, summary: /^Trimmed 1 clip\(s\): now 1\.00-10\.00 s of the source, 9\.00 s long\.$/ },
    failure: { args: { timeline_clip_ids: IDS.clipA, trim_end_seconds: "-2" }, summary: /^Error: The trim would overlap 'broll\.mp4' \(CLIPBROL01\)/ },
  },
  slice_clips_tool: {
    happy: { args: { timeline_clip_ids: IDS.clipA, at_seconds: "5" }, summary: /^Sliced 1 clip\(s\) at 5\.00 s, kept both\.$/, check: ({ doc }) => expect(doc.project.clips).toHaveLength(6) },
    failure: { args: { timeline_clip_ids: IDS.clipA, at_seconds: "50" }, summary: /is not under 50\.00 s; cut inside the clip$/ },
  },
  remove_gaps_tool: {
    happy: { args: { track: "3" }, summary: /^Closed 1 gap\(s\) \(2\.00 s\) on track 3; 1 item\(s\) moved left\.$/ },
    failure: { args: { track: "Nope" }, summary: /^Error: Unknown track or layer 'Nope'/ },
  },
  duplicate_clips_tool: {
    happy: { args: { timeline_clip_ids: IDS.clipLogo }, summary: /^Made 1 copy of 1 clip\(s\); the first starts at 5\.00 s on track 3\.$/ },
    failure: { args: { timeline_clip_ids: IDS.clipA }, summary: /^Error: The copies would overlap/ },
  },
  align_clips_tool: {
    happy: { args: { timeline_clip_ids: [IDS.clipLogo, IDS.clipMusic] }, summary: /^Aligned the starts of 2 clip\(s\) at 0\.00 s \(1 moved\)\.$/ },
    failure: { args: { timeline_clip_ids: [IDS.clipA] }, summary: /^Error: aligning needs at least two clips/ },
  },
  set_clip_speed_tool: {
    // The web's older arguments still work (clip_id, factor, direction).
    happy: { args: { clip_id: IDS.clipB, factor: "2" }, summary: /^Retimed 1 clip\(s\): 5\.00 s -> 2\.50 s, now 2\.0x forward\.$/ },
    failure: { args: { timeline_clip_ids: IDS.clipB, speed: "0.5" }, summary: /^Error: The longer clip would overlap 'interview\.mp4' \(CLIPINTV02\)/ },
  },
  repeat_clip_tool: {
    happy: { args: { timeline_clip_ids: IDS.clipTail, times: "2" }, summary: /^Repeated 1 clip\(s\) 2x \(loop\): 4\.00 s -> 8\.00 s\.$/ },
    failure: { args: { timeline_clip_ids: IDS.clipA, times: "2" }, summary: /^Error: The repeated clip would overlap/ },
  },
  freeze_frame_tool: {
    happy: { args: { timeline_clip_id: IDS.clipTail, frame: "last", hold_seconds: "1" }, summary: /^Froze 'interview\.mp4' at 18\.97 s for 1\.00 s; it now ends at 20\.00 s\.$/ },
    failure: { args: { timeline_clip_id: IDS.clipA, frame: "last" }, summary: /^Error: The freeze would overlap/ },
  },
  separate_clip_audio_tool: {
    happy: {
      args: { timeline_clip_ids: IDS.clipB },
      summary: /^Separated the audio of 1 clip\(s\) into 1 audio clip\(s\) on track\(s\) 1; the originals are muted\.$/,
      check: ({ receipt }) => expect(receipt.createdTracks).toHaveLength(1),
    },
    failure: { args: { timeline_clip_ids: IDS.clipLogo }, summary: /^Error: 'logo\.png' has no audio to separate$/ },
  },
  set_clip_audio_video_tool: {
    happy: { args: { timeline_clip_ids: IDS.clipMusic, audio: "off" }, summary: /^Set audio off on 1 clip\(s\) on track 2\.$/ },
    failure: { args: { timeline_clip_ids: IDS.clipLogo, audio: "on" }, summary: /^Error: 'logo\.png' has no audio in its media$/ },
  },
  reverse_clip_tool: {
    happy: { args: { timeline_clip_id: IDS.clipB }, summary: /^Reversed timeline_clip_id=CLIPBROL01\.$/ },
    failure: { args: { timeline_clip_id: IDS.clipB, mode: "sideways" }, summary: /^Error: mode must be 'reverse' or 'reset'\.$/ },
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
      summary: /^Exported 19\.00s of video with 'MP4 \(h\.264\)' \(High\) to \/exports\/out\.mp4 \(0\.0 MB\), 1280x720 at 30\.0 fps\.$/,
      check: ({ host }) => {
        expect(host.exports).toHaveLength(1);
        expect(host.exports[0]!.format).toBe("mp4");
        expect(host.exports[0]!.width).toBe(1280);
      },
    },
    failure: { args: { show_dialog: "false", output_path: "/media/interview.mp4" }, summary: /^Error: \/media\/interview\.mp4 is one of the project's input files; choose a different name$/ },
  },
  get_export_settings_tool: { happy: { summary: /^Next export: 'MP4 \(h\.264\)' High video_audio 1280x720 30\.0 fps, 0\.0-19\.0s -> current\.mp4\.$/ }, failure: null },
  set_export_setting_tool: {
    happy: {
      args: { key: "width", value: "640" },
      summary: /^Stored export width = 640\.$/,
      check: ({ doc }) => {
        expect(doc.project.export_overrides).toMatchObject({ width: 640 });
        expect(doc.undoLabels).toEqual([]);
      },
    },
    failure: { args: { key: "width", value: "wide" }, summary: /^Error: width must be a whole number, got 'wide'$/ },
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
      summary: /^Added Blur to 1 clip\(s\)\.$/,
      check: ({ doc, receipt }) => {
        const effects = doc.project.clips.find((c) => c.id === IDS.clipA)?.effects;
        expect(effects).toHaveLength(1);
        expect(receipt.data).toMatchObject({ effect: "Blur", effect_id: effects![0]!.id, timeline_clip_id: IDS.clipA, changed: true });
      },
    },
    failure: { args: { timeline_clip_id: IDS.clipA, effect: "NoSuchEffect" }, summary: /^Error: unknown effect 'NoSuchEffect'.* list_effects_tool lists all 43 effects$/ },
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
    happy: {
      args: { fps: "25" },
      summary: /^Updated project settings: 1280x720 at 25\.0 fps \(HD 720p 25 fps\)\.$/,
      // The profile follows the new rate: Zenvi desktop re-applies a project's profile by name when it opens it.
      check: ({ doc }) => expect([doc.project.fps, doc.project.profile]).toEqual([{ num: 25, den: 1 }, "HD 720p 25 fps"]),
    },
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
  transcribe_media_tool: {
    happy: {
      args: { fileId: IDS.interview },
      summary: /^Transcribed 9 words \(server, en\)\. fileId=FILEINTV01 /,
      check: ({ receipt, doc, host }) => {
        expect(receipt.data).toMatchObject({ transcriptionSource: "server", transcriptGeneration: 2, modelId: "whisper-1", script: expect.stringContaining("Um, today") });
        expect(host.calls).toContain("transcribe /media/interview.mp4 auto");
        expect(doc.project.files.find((f) => f.id === IDS.interview)?.ai_metadata).toMatchObject({ analyzed: true, asr: { generation: 2, words: expect.any(Array) } });
      },
    },
    failure: { args: { fileId: "NOPE" }, summary: /^Error: Unknown fileId 'NOPE'\.$/ },
  },
  remove_words_tool: {
    happy: {
      args: { clipId: IDS.clipA, fillerPreset: "um_uh" },
      summary: /^Removed 1 word\(s\), closed 0\.30s\.$/,
      check: ({ receipt, doc }) => {
        expect(receipt.data).toMatchObject({ removedWordIndices: [3], transcriptionSource: "server", fragmentCount: 2 });
        expect(doc.project.clips.find((c) => c.id === IDS.clipB)?.position).toBeCloseTo(9.7, 9);
      },
    },
    failure: { args: { clipId: IDS.clipA, fillerPreset: "ums" }, summary: /^Error: Unknown fillerPreset 'ums'\. Use one of: english_fillers, um_uh\.$/ },
  },
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
    failure: { args: { path: "/out/captions.srt", clipId: "NOPE" }, summary: /^Error: Unknown clipId 'NOPE'\.$/ },
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
  generate_image_and_add_to_timeline_tool: {
    happy: {
      args: { prompt: "a red fox in snow", position_seconds: "20", duration_seconds: "3" },
      summary: /^Added clip to timeline at position 20\.0s on track 1000000 .* duration=3\.00s timeline_clip_id=\w+\.$/,
      check: ({ host }) => expect(host.backendCalls.find((c) => c.path === "/api/v1/generation/image")?.body).toEqual({ prompt: "a red fox in snow", width: 1920, height: 1080 }),
    },
    failure: { args: { prompt: "a red fox", track: "Nope" }, summary: /^Error: Unknown track or layer 'Nope'/ },
  },
  ingest_web_video_tool: {
    happy: {
      args: { url: "https://youtu.be/abc", intent: "reference" },
      summary: /^Ingested “Web clip” as media_bin file_id=\w+\.\nColour match: match_color_to_reference_tool/,
      check: ({ host }) => expect(host.calls).toContain("fetchWebVideo https://youtu.be/abc reference subs=true"),
    },
    failure: { args: { url: "https://youtu.be/abc", intent: "edit" }, status: "refused", summary: /^Error: Unknown intent 'edit'\. Use reference, timeline, or recreate\.$/ },
  },
  list_comfyui_templates_tool: { happy: { args: {}, status: "refused", summary: /not available in this Zenvi surface: ComfyUI/ }, failure: null },
  list_comfyui_jobs_tool: { happy: { args: {}, status: "refused", summary: /not available in this Zenvi surface: ComfyUI/ }, failure: null },
  create_media_with_comfyui_tool: { happy: { args: { prompt: "misty pine forest" }, status: "refused", summary: /not available in this Zenvi surface: ComfyUI/ }, failure: null },
  enhance_file_with_comfyui_tool: { happy: { args: { file_id: IDS.broll }, status: "refused", summary: /not available in this Zenvi surface: ComfyUI/ }, failure: null },
  cancel_comfyui_job_tool: { happy: { args: { job_id: "j1" }, status: "refused", summary: /not available in this Zenvi surface: ComfyUI/ }, failure: null },
  prepare_recording_tool: { happy: { args: { sources: ["mic"] }, status: "refused", summary: /not available in this Zenvi surface: recording/ }, failure: null },
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

  // --- timeline transitions and Project Files (media_files*.py) ---------------------------------------
  list_timeline_transitions_tool: {
    happy: { args: { track: "1" }, setup: withTransitions, summary: /^2 transition\(s\) on track 1\.$/, check: ({ receipt }) => expect((receipt.data as { transitions: unknown[] }).transitions).toHaveLength(2) },
    failure: { args: { track: "nine" }, summary: /^Error/ },
  },
  update_transition_tool: {
    happy: {
      args: { transition_ids: ["TRANSFADE1"], contrast: "10", audio_crossfade: "true" },
      setup: withTransitions,
      summary: /^Updated 1 transition\(s\)\.$/,
      check: ({ doc }) => expect(doc.project.effects.find((t) => t.id === "TRANSFADE1")?.fade_audio_hint).toBe(true),
    },
    failure: { args: { contrast: "5" }, summary: /^Error: the timeline has no transitions$/ },
  },
  reverse_transition_tool: {
    happy: { args: { scope: "all" }, setup: withTransitions, summary: /^Reversed 2 transition\(s\)\.$/ },
    failure: { args: { scope: "all" }, summary: /^Error: the timeline has no transitions$/ },
  },
  remove_transition_tool: {
    happy: { args: { at_seconds: "9.5" }, setup: withTransitions, summary: /^Removed 1 transition\(s\); the clips were not changed\.$/, check: ({ doc }) => expect(doc.project.effects).toHaveLength(1) },
    failure: { args: {}, summary: /^Error: the timeline has no transitions$/ },
  },
  copy_transition_tool: {
    happy: {
      args: { source_transition_id: "TRANSCIRC1", transition_ids: "TRANSFADE1", what: "mask" },
      setup: withTransitions,
      summary: /^Copied mask from transition TRANSCIRC1 onto 1 transition\(s\)\.$/,
      check: ({ doc }) => expect(doc.project.effects.find((t) => t.id === "TRANSFADE1")?.reader.path).toBe("@transitions/common/circle_in_to_out.svg"),
    },
    failure: { args: { source_transition_id: "NOPE", scope: "all" }, summary: /^Error: no transition with id='NOPE'$/ },
  },
  add_transitions_between_clips_tool: {
    happy: {
      args: { track: "1", duration_seconds: "0.5" },
      summary: /^Added 2 transition\(s\) on track 1; moved 2 clip\(s\) earlier to make the overlaps\.$/,
      check: ({ doc }) => expect(doc.project.effects).toHaveLength(2),
    },
    failure: { args: { track: "2" }, summary: /^Error: track 2 has fewer than two clips to join$/ },
  },
  list_project_files_tool: {
    happy: { args: { usage: "used", detail: "full" }, summary: /^4 of 4 project files match \(used\)\.$/ },
    failure: { args: { file_ids: "NOPE" }, summary: /^Error: no project file with id\(s\) NOPE$/ },
  },
  update_project_files_tool: {
    happy: { args: { file_ids: IDS.broll, name: "B-roll", add_tags: "b-roll" }, summary: /^Updated 1 file\(s\): renamed, tagged\. Refreshed 1 timeline clip\(s\)\.$/ },
    failure: { args: { file_ids: IDS.broll }, summary: /^Error: nothing to change/ },
  },
  import_image_sequence_tool: {
    happy: {
      args: { path: "/renders/intro", fps: "24" },
      host: { disk: ["/renders/intro/f_0001.png", "/renders/intro/f_0002.png", "/renders/intro/f_0003.png"] },
      summary: /^Imported 3 frames of f_%04d\.png as one 24 fps sequence \(0\.12s\)\. Place it with add_clip_to_timeline_tool\.$/,
    },
    failure: { args: { path: "/renders/none" }, host: { disk: [] }, summary: /^Error: no file or folder at '\/renders\/none'$/ },
  },
  remove_files_from_project_tool: {
    happy: { args: { file_ids: IDS.logo, confirm_remove_clips: "true" }, summary: /^Removed 1 file\(s\) from the project and 1 timeline clip\(s\) that used them\. The media files stay on disk\.$/ },
    failure: { args: { file_ids: IDS.logo }, summary: /used on the timeline.*confirm_remove_clips=true/ },
  },
  create_subclips_tool: {
    happy: {
      args: { file_id: IDS.interview, subclips: [{ source_start_seconds: "2", source_end_seconds: "4", name: "Hook" }] },
      summary: /^Created 1 sub-clip\(s\) of 'interview\.mp4'\. Place one with add_clip_to_timeline_tool\(file_id=\.\.\.\)\.$/,
    },
    failure: { args: { file_id: IDS.logo, subclips: [{ source_start_seconds: 0, source_end_seconds: 2 }] }, summary: /^Error: a still image has no time range to split$/ },
  },
  manage_optimized_previews_tool: { happy: { args: { action: "optimize", all_videos: "true" }, status: "refused", summary: /not available in this Zenvi surface: optimized previews exist only in Zenvi desktop/ }, failure: null },
  add_title_tool: {
    happy: {
      args: { text: "Chapter One", position_seconds: "3", duration_seconds: "4" },
      summary: /^Added title 'Chapter One' \(Bar_1\) on track 4 at 3\.00-7\.00s\.$/,
      check: ({ host, receipt, doc }) => {
        const path = (receipt.data as { path: string }).path;
        expect(String(new TextDecoder().decode(host.written.get(path) as Uint8Array))).toContain(">Chapter One</tspan>");
        // Over the picture, not on the video's track: the first free track above the logo on track 3.
        const title = doc.project.clips.find((c) => c.position === 3 && c.file_id === (receipt.data as { file_id: string }).file_id);
        expect(title?.layer).toBe(4_000_000);
        expect(doc.project.layers).toHaveLength(5);
      },
    },
    failure: {
      args: { text: "Chapter One", template: "NoSuchTemplate" },
      summary: /^Error: unknown title template 'NoSuchTemplate'; close matches: .+ \(list_title_templates_tool lists them all\)$/,
    },
  },
  add_captions_tool: {
    happy: {
      args: { srtPath: "/subs/a.srt" },
      host: { texts: { "/subs/a.srt": SRT } },
      summary: /^Added 2 caption\(s\) from file on a Captions overlay on track 4\.$/,
      check: ({ receipt, doc }) => {
        expect(receipt.data).toMatchObject({ source: "file", style: "classic", captioned: [{ overlay: true, cues: 2, first: 1, last: 4 }] });
        const overlay = doc.project.clips.find((c) => c.zenvi_role === "captions");
        expect(overlay?.effects.map((e) => e.class_name)).toEqual(["Caption"]);
        expect(doc.project.files).toHaveLength(5);
      },
    },
    failure: { args: { srtPath: "/subs/missing.srt" }, summary: /^Error: subtitle file not found: \/subs\/missing\.srt$/ },
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

  // --- clip properties (editor_tools/clip_props*.py) -----------------------------------------------------
  get_clip_properties_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA, properties: "alpha, scale" }, summary: /^Clip CLIPINTV01 '.*' \(track 1, 0\.00-10\.00 s\) at 1\.00 s: alpha 1, scale Best Fit\. Animated: nothing\.$/ },
    failure: { args: { timeline_clip_id: IDS.clipA, properties: "sparkle" }, summary: /^Error: unknown clip property 'sparkle'; settable: / },
  },
  set_clip_properties_tool: {
    happy: {
      args: { timeline_clip_ids: IDS.clipLogo, properties: '{"alpha": "0.5", "gravity": "top right"}' },
      summary: /^Set alpha=0\.5, gravity=top right on 1 clip\(s\)\.$/,
      check: ({ doc }) => expect(doc.project.clips.find((c) => c.id === IDS.clipLogo)).toMatchObject({ gravity: 2, alpha: { Points: [{ co: { X: 1, Y: 0.5 } }] } }),
    },
    failure: { args: { timeline_clip_ids: IDS.clipA, properties: { alpha: 2 } }, summary: /^Error: alpha on clip CLIPINTV01 must be between 0 and 1, got 2$/ },
  },
  remove_keyframes_tool: {
    happy: {
      setup: (doc) => {
        doc.transaction("fade", (tx) => tx.update(["clips", { id: IDS.clipA }], { alpha: { Points: [{ co: { X: 1, Y: 0 }, interpolation: 0 }, { co: { X: 31, Y: 1 }, interpolation: 0 }] } }));
      },
      args: { timeline_clip_ids: IDS.clipA, properties: "alpha" },
      summary: /^Removed 2 keyframe\(s\) from 1 clip\(s\)\.$/,
    },
    failure: { args: { timeline_clip_ids: IDS.clipA, properties: ["all"] }, summary: /^Error: no keyframes to remove on 1 clip\(s\) for any animated property$/ },
  },
  copy_clip_keyframes_tool: {
    happy: {
      setup: (doc) => {
        doc.transaction("fade", (tx) => tx.update(["clips", { id: IDS.clipA }], { alpha: { Points: [{ co: { X: 1, Y: 0 }, interpolation: 0 }, { co: { X: 31, Y: 1 }, interpolation: 0 }] } }));
      },
      args: { source_clip_id: IDS.clipA, timeline_clip_ids: IDS.clipB, groups: "alpha" },
      summary: /^Copied alpha keyframes from clip CLIPINTV01 to 1 clip\(s\) \(timing=stretch\)\.$/,
    },
    failure: { args: { source_clip_id: IDS.clipA }, summary: /^Error: name the target clips/ },
  },
  apply_clip_preset_tool: {
    happy: {
      args: { timeline_clip_ids: IDS.clipA, preset: "fade_in_out", duration_seconds: "2" },
      summary: /^Applied Fade > Fade In and Out \(duration_seconds, default 1 s\) to 1 clip\(s\); changed alpha, volume\.$/,
    },
    failure: { args: { timeline_clip_ids: IDS.clipMusic, preset: "zoom_in" }, summary: /^Error: zoom_in does not apply to the chosen clip\(s\)/ },
  },

  // --- tracks, markers, playhead, view, selection (editor_tools/tracks_nav.py) ----------------------------
  update_track_tool: {
    happy: { args: { track: "2", name: "Music", lock: "true" }, summary: /^Track 2 renamed to 'Music' and locked\.$/ },
    failure: { args: { track: "1" }, summary: /^Error: nothing to change: pass name and\/or lock$/ },
  },
  remove_track_tool: {
    happy: { args: { track: "4" }, summary: /^Removed track 4\. One undo restores it\.$/, check: ({ doc }) => expect(doc.project.layers).toHaveLength(4) },
    failure: { args: { track: "1" }, summary: /^Error: track 1 still has 3 clip\(s\) and 0 transition\(s\); pass with_clips=true/ },
  },
  update_marker_tool: {
    happy: { args: { marker: IDS.marker, name: "Chorus", color: "red" }, summary: /^Updated the marker 'Chorus' at 00:00:04,00 \(name, color\)\.$/ },
    failure: { args: { marker: "Nope", name: "x" }, summary: /^Error: no marker with id or name 'Nope'; markers: Intro ends \(00:00:04,00\)$/ },
  },
  remove_marker_tool: {
    happy: { args: { markers: "Intro ends" }, summary: /^Removed the marker 'Intro ends' at 00:00:04,00\.$/, check: ({ doc }) => expect(doc.project.markers).toEqual([]) },
    failure: { args: {}, summary: /^Error: say which markers/ },
  },
  seek_playhead_tool: {
    happy: { args: { seconds: "4" }, summary: /^Playhead at 00:00:04,00, frame 121\.$/, check: ({ host }) => expect(host.player!.playhead).toBe(4) },
    failure: { args: { seconds: "1", to: "end" }, summary: /^Error: give only one of seconds, frame, marker or to \(got seconds, to\)$/ },
  },
  select_timeline_items_tool: {
    happy: { args: { track: "1" }, summary: /^Selection: 3 clips\.$/, check: ({ host }) => expect(host.editor.selection.clips).toEqual([IDS.clipA, IDS.clipB, IDS.clipTail]) },
    failure: { host: { without: ["ui"] }, summary: /not available/ },
  },
  set_timeline_view_tool: {
    happy: { args: { zoom: "fit" }, summary: /^Timeline view: fit every clip \(0 to 00:00:19,00\)\.$/ },
    failure: { args: {}, summary: /^Error: nothing to change/ },
  },
  get_playhead_and_selection_tool: { happy: { summary: /^Playhead at 00:00:01,00 \(frame 31\), paused; 0 item\(s\) selected\.$/ }, failure: null },

  // --- effects and colour (effects_color*.py, the older colour tools) ------------------------------------
  list_effects_tool: {
    // category is the web's older name for kind.
    happy: { args: { category: "audio" }, summary: /^9 effect\(s\)$/ },
    failure: { args: { category: "smell" }, status: "refused", summary: /^Error: Invalid arguments/ },
  },
  get_clip_effects_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA }, summary: /^Clip CLIPINTV01 has 0 effect\(s\): none$/ },
    failure: { args: { timeline_clip_id: "NOPE" }, summary: /^Error: / },
  },
  update_effect_tool: {
    happy: {
      args: { timeline_clip_id: IDS.clipA, effect: "blur", properties: '{"sigma": "5"}' },
      setup: async (doc, host) => {
        await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur" });
      },
      summary: /^Updated sigma on 1 effect\(s\)\.$/,
    },
    failure: { args: { timeline_clip_id: IDS.clipA, effect: "Sharpen", properties: '{"amount": "2"}' }, summary: /no Sharpen effect/ },
  },
  remove_effect_tool: {
    // effect_id (filled from the setup by runCase) is the web's older single-id argument.
    happy: {
      setup: async (doc, host) => {
        await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur" });
      },
      summary: /^Removed 1 effect\(s\) from 1 clip\(s\)\.$/,
      check: ({ doc }) => expect(doc.project.clips.find((c) => c.id === IDS.clipA)?.effects).toHaveLength(0),
    },
    failure: { args: { effect_id: "NOPE" }, summary: /^Error: no effect with id='NOPE' on the timeline/ },
  },
  copy_effects_tool: {
    happy: {
      args: { source_clip_id: IDS.clipA, timeline_clip_ids: IDS.clipB },
      setup: async (doc, host) => {
        await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur" });
      },
      summary: /^Copied 1 effect\(s\) from clip CLIPINTV01 onto 1 clip\(s\) \(merge\)\.$/,
      check: ({ doc }) => expect(doc.project.clips.find((c) => c.id === IDS.clipB)?.effects.map((e) => e.class_name)).toEqual(["Blur"]),
    },
    failure: { args: { source_clip_id: IDS.clipA, timeline_clip_ids: IDS.clipB }, summary: /has no any effects to copy/ },
  },
  process_clip_effect_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA, effect: "Stabilizer" }, status: "refused", summary: /not available in this Zenvi surface: Stabilizer analysis/ },
    failure: null,
  },
  apply_look_preset_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA, look: "film_grain_35mm_fine" }, summary: /^Applied look film_grain_35mm_fine on 1 clip\(s\)\.$/ },
    failure: { args: { timeline_clip_id: IDS.clipMusic, look: "glow_neon" }, summary: /is audio-only/ },
  },
  color_grade_clip_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA, look: "warm", exposure: "0.1" }, summary: /^Graded 1 clip\(s\): look warm\.$/ },
    failure: { args: { timeline_clip_id: IDS.clipA }, summary: /say what to change/ },
  },
  list_luts_tool: {
    happy: { args: { query: "moody" }, summary: /^12 LUT\(s\) matching 'moody'$/ },
    failure: { args: { query: "glitter" }, summary: /^Error: no LUT matches 'glitter'$/ },
  },
  apply_audio_effect_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA, preset: "echo" }, summary: /^Applied echo \(Echo\) to 1 clip\(s\)\.$/ },
    failure: { args: { timeline_clip_id: IDS.clipLogo, preset: "echo" }, summary: /has no sound/ },
  },
  chroma_key_clip_tool: {
    happy: { args: { timeline_clip_id: IDS.clipB, key_color: "#00ff00" }, summary: /^Keyed out #00ff00 \(given, basic_soft, fuzz 20, halo 10\) on clip CLIPBROL01\./ },
    failure: { args: { timeline_clip_id: IDS.clipMusic }, summary: /is audio-only/ },
  },
  analyze_frame_colors_tool: {
    happy: { args: { timeline_clip_id: IDS.clipA }, summary: /^Frame at 5\.00s of clip CLIPINTV01: / },
    failure: { args: { timeline_clip_id: IDS.clipA, time: "50" }, summary: /time 50s is outside the clip/ },
  },
  apply_color_tool: {
    happy: { args: { clipIds: IDS.clipA, exposure: "0.1" }, summary: /^\{"ok":true,"clips":\[\{"timeline_clip_id":"CLIPINTV01","status":"applied"/ },
    failure: { args: { clipIds: IDS.clipA, exposure: "x" }, summary: /^Error: exposure must be a finite number$/ },
  },
  apply_look_tool: {
    happy: { args: { clipIds: IDS.clipA, lookId: "sunny" }, summary: /"status":"preset"/ },
    failure: { args: { clipIds: IDS.clipA, lookId: "nope" }, summary: /^Error: Unknown lookId 'nope'/ },
  },
  inspect_color_tool: {
    happy: { args: { clipId: IDS.clipA }, summary: /^\{"ok":true,"timeline_clip_id":"CLIPINTV01"/ },
    failure: { args: { clipId: IDS.clipA, atFrame: "x" }, summary: /^Error: atFrame must be an integer frame number\.$/ },
  },
  list_looks_tool: { happy: { args: { query: "teal" }, summary: /^\{"ok":true,"count":\d+,"looks":/ }, failure: null },
  match_color_to_reference_tool: {
    happy: { args: { clipId: IDS.clipA, reference: IDS.clipB, dry_run: "true" }, summary: /^\{"ok":true/ },
    failure: { args: { clipId: IDS.clipA }, summary: /requires referenceClipId, referenceFileId, or referenceImagePath/ },
  },

  // --- direct tools ----------------------------------------------------------------------------------------
  describe_project_tool: { happy: { summary: /^1280x720 30\/1 fps, 5 track\(s\), 5 clip\(s\), 0 transition\(s\), 4 file\(s\); content ends at 19\.00s\.$/ }, failure: null },
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
  build_reel_tool: {
    happy: {
      args: { style: "cinematic", replace: "true", duration_seconds: "8", hook: "Camera day" },
      summary: /^Built a cinematic montage reel: \d+ shots cut to 96 BPM, [\d.]+ seconds, landscape 16:9\.$/,
      check: ({ doc }) => expect(doc.project.clips.some((c) => c.id === IDS.clipA)).toBe(false),
    },
    failure: { args: { file_ids: ["NOPE000000"] }, status: "refused", summary: /^Error: unknown file id\(s\): NOPE000000\.$/ },
  },

  add_motion_template_tool: {
    happy: {
      args: { template: "end_card", text: "Northwind", subtitle: "Brews in four minutes", position_seconds: "1", bpm: "120" },
      summary: /^Added end_card at 1\.00-\d+\.\d\ds on 4 track\(s\), entrances on 120 BPM\.$/,
      check: ({ host }) => expect([...host.written.keys()].filter((p) => p.startsWith("/generated/end_card-"))).toHaveLength(4),
    },
    failure: { args: { template: "word_scroll", words: ["Only"] }, status: "refused", summary: /^Error: word_scroll needs words: 2 to 10 of them\.$/ },
  },

  kinetic_captions_tool: {
    happy: {
      args: { style: "karaoke", start_seconds: "0", accent: "#00ff88" },
      summary: /^Added \d+ karaoke caption group\(s\) \(\d+ words\) at [\d.]+-[\d.]+s on 2 track\(s\)\.$/,
      check: ({ host }) => expect([...host.written.keys()].some((p) => p.startsWith("/generated/captions-karaoke-"))).toBe(true),
    },
    failure: { args: { timeline_clip_ids: ["NOPE"] }, status: "refused", summary: /^Error: unknown timeline clip NOPE\.$/ },
  },

  // --- sound design --------------------------------------------------------------------
  list_sfx_tool: {
    happy: { args: { family: "impact" }, summary: /^\d+ sound effects: impact_punch, /, check: ({ doc, before }) => expect(doc.project).toEqual(before) },
    failure: null,
  },
  add_sfx_tool: {
    happy: {
      args: { recipe: "impact_punch", clip_id: IDS.clipB },
      summary: /^Added impact, punch with its transient on the start of clip CLIPBROL01 \(clip \w+, -8 dB\)\.$/,
      check: ({ doc, host }) => {
        expect(doc.project.layers.some((l) => l.label === "SFX")).toBe(true);
        expect([...host.written.keys()].some((p) => /^\/generated\/sfx-impact_punch-[0-9a-f]{8}\.wav$/.test(p))).toBe(true);
      },
    },
    failure: { args: { recipe: "pop" }, status: "refused", summary: /^Error: give exactly one of at_seconds, clip_id or marker_id\.$/ },
  },
  auto_sound_design_tool: {
    happy: { args: { intensity: "hype" }, summary: /^Sound-designed the edit \(hype\): \d+ effects/, check: ({ doc }) => expect(doc.undoLabels.at(-1)).toBe("Automatic sound design") },
    failure: { args: { climax_seconds: "999" }, status: "refused", summary: /^Error: climax_seconds \(999\) is after the end of the edit/ },
  },

  // --- motion transitions ------------------------------------------------------------------
  list_motion_transitions_tool: {
    happy: { args: {}, summary: /^13 motion transitions; 0 on the timeline\.$/ },
    failure: null,
  },
  apply_motion_transition_tool: {
    happy: {
      args: { preset: "whip", clip1_id: IDS.clipA, direction: "left", intensity: "1.5" },
      summary: /^Added whip left on the cut at 10\.00s \(8 frames\) between CLIPINTV01 and CLIPBROL01\.$/,
      check: ({ receipt }) => expect((receipt.data as { sfx_cues: { kind: string }[] }).sfx_cues.map((c) => c.kind)).toEqual(["whoosh"]),
    },
    failure: { args: { preset: "whip", clip1_id: IDS.clipA, clip2_id: IDS.clipLogo }, status: "refused", summary: /^Error: Clips CLIPINTV01 and CLIPLOGO01 are on different tracks/ },
  },
  apply_motion_transitions_tool: {
    happy: { args: { track: String(L1), style: "hype" }, summary: /^Added 2 motion transition\(s\) on track 1 \(hype\): whip@10\.00s, whip@15\.00s\.$/ },
    failure: { args: { track: String(L1), preset: "whip", style: "hype" }, status: "refused", summary: /^Error: give preset or style/ },
  },
  remove_motion_transition_tool: {
    happy: {
      setup: async (doc, host) => {
        await runTool({ doc, host }, "apply_motion_transition_tool", { preset: "spin", clip1_id: IDS.clipB });
      },
      args: { clip_id: IDS.clipTail },
      summary: /^Removed 1 motion transition\(s\); restored clips CLIPBROL01, CLIPINTV02\.$/,
    },
    failure: { args: { transition_id: "MTNOPE" }, status: "refused", summary: /^Error: no motion transition with id MTNOPE\.$/ },
  },

  // --- stock search (web) -------------------------------------------------------------
  search_pexels_videos_tool: {
    happy: {
      args: { query: "coffee pour", count: "2" },
      host: { routes: { "/api/v1/pexels/search": () => PEXELS } },
      // The landscape project gets landscape footage first, each with the smallest rendition that covers most of the frame.
      summary: /^Pexels results for 'coffee pour' \(3 total\):\n {2}id=11 {2}duration=0:12 {2}res=1280×720 {2}landscape {2}user=Ana {2}link=https:\/\/cdn\.test\/11-720\.mp4\n {2}id=12 /,
      check: ({ host, receipt }) => {
        expect(host.backendCalls[0]?.path).toBe("/api/v1/pexels/search?query=coffee%20pour&per_page=4&page=1");
        expect((receipt.data as { results: unknown[] }).results).toHaveLength(2);
      },
    },
    failure: { args: { query: "coffee" }, host: { routes: { "/api/v1/pexels/search": () => ({ error: "Pexels is not configured" }) } }, status: "refused", summary: /^Error: Pexels search failed: Pexels is not configured$/ },
  },
  search_freesound_music_tool: {
    happy: {
      args: { query: "lofi", count: "2", min_seconds: "20" },
      host: { routes: { "/api/v1/freesound/search": () => FREESOUND } },
      // Open licences first (CC0, then CC BY), non-commercial last; sounds without a preview are left out.
      summary: /^Freesound results for 'lofi' \(4 total\):\n {2}id=22 {2}duration=1:30 {2}licence=CC0 .*\n {2}id=21 {2}duration=2:00 {2}licence=CC BY 4\.0 /,
      check: ({ host }) => expect(host.backendCalls[0]?.path).toBe("/api/v1/freesound/search?query=lofi&page_size=4&min_duration=20"),
    },
    failure: {
      args: { query: "lofi" },
      host: {
        routes: {
          "/api/v1/freesound/search": () => {
            throw new Error("backend down");
          },
        },
      },
      status: "refused",
      summary: /^Error: Freesound search failed: backend down$/,
    },
  },
  // --- project and export (zenvi-core develop editor_tools/project_export*.py) ---------------
  list_recent_projects_tool: {
    happy: { host: { recent: [{ path: "/films/trip.zvn", name: "trip", exists: true, modifiedAt: 1_790_000_000 }] }, summary: /^1 recent project\(s\); most recent: trip\.$/ },
    failure: { host: { omit: ["storage.recentProjects"] }, status: "refused", summary: /not available in this Zenvi surface: this surface keeps no list of recent projects/ },
  },
  forget_recent_projects_tool: {
    happy: { args: { missing_only: "true" }, status: "refused", summary: /not available in this Zenvi surface: the recent projects listed here are the projects themselves/ },
    failure: null,
  },
  list_recovery_versions_tool: {
    happy: { host: { recovery: [{ path: "/rec/1-current.zip", savedAt: Date.now() / 1000 - 120, sizeBytes: 10, project: createProject() }] }, summary: /^1 recovery version\(s\); newest saved \d+\.\d min ago\.$/ },
    failure: { host: { omit: ["storage.recoveryCopies"] }, status: "refused", summary: /keeps no recovery copies/ },
  },
  restore_recovery_version_tool: {
    happy: {
      host: { recovery: [{ path: "/rec/1-current.zip", savedAt: Date.now() / 1000 - 60, sizeBytes: 10, project: createProject() }] },
      summary: /^Restored the version saved \d+\.\d min ago \(0 clips\); the previous file was kept as current-1-backup\.zvn\.$/,
      check: ({ doc }) => expect(doc.project.clips).toEqual([]),
    },
    failure: {
      args: { version: "3" },
      host: { recovery: [{ path: "/rec/1-current.zip", savedAt: 1, sizeBytes: 10, project: createProject() }] },
      status: "error",
      summary: /^Error: there are only 1 recovery versions$/,
    },
  },
  import_project_file_tool: { happy: { args: { file_path: "/in/cut.edl" }, status: "refused", summary: /not available in this Zenvi surface: Zenvi desktop converts timelines to and from EDL/ }, failure: null },
  export_project_file_tool: { happy: { args: { format: "edl" }, status: "refused", summary: /not available in this Zenvi surface: Zenvi desktop converts timelines to and from EDL/ }, failure: null },
  consolidate_project_media_tool: {
    happy: {
      args: { action: "collect" },
      host: { projectPath: "/proj/film.zvn" },
      summary: /^Copied 4 file\(s\); skipped 0\.$/,
      check: ({ doc }) => expect(doc.project.files.find((f) => f.id === IDS.broll)).toMatchObject({ path: "/proj/film_assets/media/broll.mp4", original_path: "/media/broll.mp4" }),
    },
    failure: { args: { action: "collect" }, host: { projectPath: null }, status: "error", summary: /^Error: save the project first/ },
  },
  reset_caches_and_history_tool: {
    happy: {
      setup: (doc) => doc.transaction("ui", (tx) => tx.update(["files", { id: IDS.music }], { ui: { audio_data: [0.1, 0.4] } })),
      args: { target: "waveforms" },
      summary: /^Dropped waveform data from 1 file\(s\) and 0 clip\(s\)\.$/,
    },
    failure: { args: { target: "undo_history" }, status: "error", summary: /^Error: clearing the undo history cannot be undone; ask the user, then pass confirm=true$/ },
  },
  get_editor_layout_tool: {
    happy: { summary: /^View 'simple' with 4 open panel\(s\)\.$/ },
    failure: { host: { omit: ["ui.layout"] }, status: "refused", summary: /not available in this Zenvi surface: there is no editor window here/ },
  },
  set_editor_layout_tool: {
    happy: { args: { show_panels: "Effects" }, summary: /^Layout: opened Effects\.$/, check: ({ host }) => expect(host.calls).toContain('layout {"show":["Effects"],"hide":[]}') },
    failure: { args: { view: "color" }, status: "error", summary: /^Error: this editor has no Color Grade view/ },
  },
  get_preferences_tool: {
    happy: { host: { preferences: [{ key: "snapping", title: "Snapping", tab: "Timeline", type: "bool", value: true, default: true }] }, args: { key: "Snapping" }, summary: /^Snapping = True \(default True\)\.$/ },
    failure: { host: { omit: ["ui.preferences"] }, status: "refused", summary: /no editor window here/ },
  },
  set_preference_tool: {
    happy: { host: { preferences: [{ key: "snapping", title: "Snapping", tab: "Timeline", type: "bool", value: true, default: true }] }, args: { key: "snapping", value: "off" }, summary: /^Set Snapping to False \(was True\)\.$/ },
    failure: {
      host: { preferences: [{ key: "snapping", title: "Snapping", tab: "Timeline", type: "bool", value: true, default: true }] },
      args: { key: "snapping", value: "maybe" },
      status: "error",
      summary: /^Error: snapping is on\/off: give true or false$/,
    },
  },
  list_export_presets_tool: {
    happy: { args: { query: "gif" }, summary: /^1 export preset\(s\)\.$/ },
    failure: { host: { without: ["exporter"] }, status: "refused", summary: /it needs video rendering/ },
  },
  list_project_profiles_tool: { happy: { args: { query: "FHD Vertical 1080p", fps: "30" }, summary: /^1 profile\(s\) match\.$/ }, failure: null },
  set_project_profile_tool: {
    happy: {
      args: { profile: "instagram_reel", reframe: "fill" },
      summary: /^Project is now FHD Vertical 1080p 30 fps \(1080x1920 9:16, 30\.0 fps\); 4 clip\(s\) set to crop-to-fill\.$/,
      check: ({ doc }) => expect([doc.project.width, doc.project.height, doc.project.clips.find((c) => c.id === IDS.clipA)?.scale]).toEqual([1080, 1920, 0]),
    },
    failure: { args: { profile: "hologram" }, status: "error", summary: /^Error: no profile or social preset matches 'hologram'/ },
  },
  manage_custom_profiles_tool: {
    happy: {
      args: { action: "create", name: "Phone", width: "720", height: "1280", fps: "24" },
      summary: /^Created custom profile 'Phone' \(720x1280, 24 fps\)\.$/,
      check: ({ host }) => expect(Object.keys(host.profiles)).toEqual(["00720x1280p0024_09-16"]),
    },
    failure: { args: { action: "edit", profile: "HD 720p 30 fps", width: "10" }, status: "error", summary: /built-in profile; duplicate it/ },
  },
  save_frame_image_tool: {
    happy: { args: { time: "2", file_path: "/exports/still.png" }, summary: /^Saved frame 61 \(2\.000s\) as \/exports\/still\.png\.$/ },
    failure: { args: { time: "99" }, status: "error", summary: /^Error: 99\.000s is after the end of the last clip \(19\.000s\)$/ },
  },
  export_files_to_folder_tool: {
    happy: { args: { file_ids: IDS.broll, folder: "/handoff" }, summary: /^Exported 1 file\(s\) to \/handoff\.$/ },
    failure: { args: { file_ids: ["NOPE"] }, status: "error", summary: /^Error: no project file with id='NOPE'$/ },
  },
};

const pexelsVideo = (id: number, width: number, height: number, duration: number, user: string) => ({
  id,
  width,
  height,
  duration,
  user_name: user,
  url: `https://www.pexels.com/video/${id}/`,
  video_files: [
    { quality: "uhd", file_type: "video/mp4", width, height, link: `https://cdn.test/${id}-full.mp4` },
    { quality: "hd", file_type: "video/mp4", width: width > height ? 1280 : 720, height: width > height ? 720 : 1280, link: `https://cdn.test/${id}-720.mp4` },
    { quality: "sd", file_type: "video/mp4", width: width > height ? 640 : 360, height: width > height ? 360 : 640, link: `https://cdn.test/${id}-360.mp4` },
  ],
});
const PEXELS = { total_results: 3, videos: [pexelsVideo(10, 1080, 1920, 9, "Bo"), pexelsVideo(11, 1920, 1080, 12, "Ana"), pexelsVideo(12, 3840, 2160, 20, "Cy")] };
const freesoundSound = (id: number, duration: number, license: string, preview = true) => ({
  id,
  name: `track ${id}`,
  duration,
  username: `user${id}`,
  license,
  tags: ["lofi", "beat"],
  previews: preview ? { hq_mp3: `https://cdn.freesound.test/${id}-hq.mp3` } : {},
});
const FREESOUND = {
  count: 4,
  sounds: [
    freesoundSound(20, 180, "http://creativecommons.org/licenses/by-nc/4.0/"),
    freesoundSound(21, 120, "http://creativecommons.org/licenses/by/4.0/"),
    freesoundSound(22, 90, "http://creativecommons.org/publicdomain/zero/1.0/"),
    freesoundSound(23, 200, "http://creativecommons.org/publicdomain/zero/1.0/", false),
  ],
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

describe("backend errors", () => {
  it("say Error: once when the backend's message already starts with it", async () => {
    const host = fakeHost({ routes: { "/api/v1/generation/tts": () => ({ success: false, error: "Error: Out of credits for tts. Need 3, have 0." }) } });
    const result = await runTool({ doc: fixtureDoc(), host }, "generate_tts_and_add_to_timeline_tool", { text: "Hi there" });
    expect(result.data?.summary).toBe("Error: Out of credits for tts. Need 3, have 0.");
  });
});

describe("add_title_tool without a track", () => {
  it("opens a 'Titles' track on top when every track above the picture is busy, in the same undo step", async () => {
    const doc = fixtureDoc();
    doc.transaction("fill the top tracks", (tx) => {
      addClip(tx, { fileId: IDS.logo, position: 2, layer: 4_000_000, start: 0, end: 6 });
      addClip(tx, { fileId: IDS.logo, position: 2, layer: 5_000_000, start: 0, end: 6 });
    });
    const steps = doc.undoLabels.length;
    const result = await runTool({ doc, host: fakeHost() }, "add_title_tool", { text: "On top", position_seconds: "3", duration_seconds: "2" });
    expect(result.ok, result.text).toBe(true);
    const fileId = (result.data!.data as { file_id: string }).file_id;
    expect(doc.project.clips.find((c) => c.file_id === fileId)?.layer).toBe(6_000_000);
    expect(doc.project.layers.find((l) => l.number === 6_000_000)?.label).toBe("Titles");
    expect(doc.undoLabels).toHaveLength(steps + 1);
    doc.undo();
    expect(doc.project.layers.some((l) => l.number === 6_000_000)).toBe(false);
  });
});

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
        expect(withoutTranscripts(snapshotOf(doc.project))).toEqual(before);
      } else if (!["undo_tool", "redo_tool", "new_project_tool", "open_project_tool", "restore_recovery_version_tool"].includes(name)) {
        // No undo step: nothing tracked changed (untracked export overrides and kept transcripts aside).
        const after = withoutTranscripts(snapshotOf(doc.project)) as Record<string, unknown>;
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
        expect(withoutTranscripts(snapshotOf(doc.project))).toEqual(before);
        expect(doc.undoLabels.length).toBe(failure.setup ? doc.undoLabels.length : 0);
      });
    }
  });
}
