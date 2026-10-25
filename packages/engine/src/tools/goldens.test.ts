/**
 * Byte-for-byte parity with zenvi-core's own tool text.
 *
 * __fixtures__/desktop-goldens.json is recorded by
 * scripts/gen-tool-goldens.py, which runs the desktop's real handlers
 * (contract ref 1f80cb3d0) headlessly over __fixtures__/golden-project.json.
 * develop replaced get_project_info and list_markers with editor tools that
 * answer structured receipts; until those are re-ported the engine keeps
 * their earlier text, recorded at b63c39be7 (LEGACY below).
 */

import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import type { Project } from "../model/types.js";
import goldens from "./__fixtures__/desktop-goldens.json" with { type: "json" };
import fixture from "./__fixtures__/golden-project.json" with { type: "json" };
import {
  buildEditorSnapshot,
  listClipsReport,
  listFilesText,
  listLayersText,
  listMarkersText,
  projectInfoText,
  timelineStateData,
  timelineStateText,
} from "./reports.js";
import { runTool } from "./registry.js";
import { resolveTimelineClip } from "./resolve.js";
import { fakeHost } from "./test-support/fake-host.js";
import { formatTrackLabelForLlm, normalizeTrackOrLayerArg, trackStackJson } from "./tracks.js";

const project = fixture as unknown as Project;

/** zenvi-core b63c39be7 tool_handlers.get_project_info / list_markers on the golden project. */
const LEGACY = {
  get_project_info: "Project: profile=HD 720p 30 fps, fps=30/1, duration=300, scale=15.0",
  list_markers: "Markers (1):\n  id=MARKER0001 position=12.5 name=",
};

describe("desktop parity: read tool text", () => {
  it("get_project_info_tool", () => {
    expect(projectInfoText(project)).toBe(LEGACY.get_project_info);
  });

  it("list_files_tool", () => {
    expect(listFilesText(project)).toBe(goldens.list_files);
  });

  it("list_clips_tool (all, and filtered by a track label)", () => {
    const all = listClipsReport(project)!;
    expect(all.text).toBe(goldens.list_clips.data.legacy_text);
    expect(all.clips).toEqual(goldens.list_clips.data.clips);
    const voice = listClipsReport(project, 2000000)!;
    expect(voice.text).toBe(goldens.list_clips_voice.data.legacy_text);
    expect(voice.clips).toEqual(goldens.list_clips_voice.data.clips);
  });

  it("list_layers_tool and TRACK_STACK_JSON (ensure_ascii escapes)", () => {
    expect(listLayersText(project)).toBe(goldens.list_layers);
    expect(trackStackJson(project.layers)).toBe(goldens.track_stack_json);
  });

  it("list_markers_tool", () => {
    expect(listMarkersText(project)).toBe(LEGACY.list_markers);
  });

  it("get_timeline_state_tool text and structured data", () => {
    expect(timelineStateText(project)).toBe(goldens.get_timeline_state.data.legacy_text);
    const data = timelineStateData(project);
    expect(data.clips).toEqual(goldens.get_timeline_state.data.clips);
    expect(data.tracks).toEqual(goldens.get_timeline_state.data.tracks);
    expect(data.effects).toEqual(goldens.get_timeline_state.data.effects);
  });
});

describe("desktop parity: editor snapshot for chat", () => {
  it("matches build_editor_snapshot_for_chat", () => {
    expect(buildEditorSnapshot(project)).toBe(goldens.editor_snapshot);
  });

  it("truncates like the desktop", () => {
    expect(buildEditorSnapshot(project, { maxChars: 900 })).toBe(goldens.editor_snapshot_900);
  });
});

describe("desktop parity: track references", () => {
  for (const [raw, [layer, error]] of Object.entries(goldens.normalize_track)) {
    it(`normalize_track_or_layer_arg(${JSON.stringify(raw)})`, () => {
      const got = normalizeTrackOrLayerArg(raw, project.layers);
      expect([got.layer ?? null, got.error ?? null]).toEqual([layer, error]);
    });
  }

  it("format_track_label_for_llm", () => {
    for (const [n, text] of Object.entries(goldens.format_track_label)) {
      expect(formatTrackLabelForLlm(Number(n), project.layers)).toBe(text);
    }
  });
});

describe("desktop parity: clip resolver", () => {
  const cases: Record<string, Parameters<typeof resolveTimelineClip>[1]> = {
    query_interview: { clipQuery: "interview" },
    query_interview_occ2: { clipQuery: "interview", occurrence: 2 },
    query_interview_track: { clipQuery: "founder", track: "Voice" },
    query_drone: { clipQuery: "drone mountain" },
    query_nothing: { clipQuery: "spaceship explosion" },
    id_missing: { timelineClipId: "NOPE" },
    no_target: {},
    near_45: { positionNear: 45 },
  };
  for (const [label, input] of Object.entries(cases)) {
    it(label, async () => {
      // The golden harness's fake window reports playhead 1.0 (MagicMock __float__).
      const got = await resolveTimelineClip(project, { playhead: 1.0, ...input });
      const want = goldens.resolve[label as keyof typeof goldens.resolve];
      expect({ ok: got.ok, clip: got.ok ? got.clip.id : null, error: got.ok ? "" : got.error }).toEqual(want);
    });
  }
});

describe("desktop parity: tool results through runTool", () => {
  const run = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const doc = new ProjectDocument(structuredClone(project));
    const host = fakeHost({ without: ["backend", "frames", "audio"], playhead: 1 });
    const result = await runTool({ doc, host }, name, args);
    return result.data!.summary;
  };

  it.each([
    ["analyze_timeline_audio_tool", {}, "analyze_timeline_audio"],
    ["analyze_timeline_audio_tool", { detail: "windows" }, "analyze_timeline_audio_windows"],
    ["get_clips_with_full_metadata_tool", {}, "get_clips_with_full_metadata"],
    ["get_clips_with_full_metadata_tool", { detail_level: "full" }, "get_clips_with_full_metadata_full"],
    ["get_timeline_placements_metadata_tool", {}, "get_timeline_placements_metadata"],
  ] as const)("%s %j", async (name, args, key) => {
    expect(await run(name, args)).toBe(goldens[key]);
  });
});
