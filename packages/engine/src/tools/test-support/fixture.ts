/**
 * Tool-test fixtures (used only by `*.test.ts`): a small edit built with the
 * real ops — an indexed interview with transcript cues, b-roll, a music bed
 * and a logo on three tracks, plus a marker — and a fake ToolHost whose
 * capabilities can be switched off one by one.
 */

import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Project, ReaderInfo } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { addMarker } from "../../ops/markers.js";
import type { ImportedMedia } from "../types.js";

/** Track numbers of the default project (UI track 1 = bottom = 1000000). */
export const L1 = 1_000_000;
export const L2 = 2_000_000;
export const L3 = 3_000_000;

export const IDS = {
  interview: "FILEINTV01",
  broll: "FILEBROL01",
  music: "FILEMUSC01",
  logo: "FILELOGO01",
  clipA: "CLIPINTV01",
  clipB: "CLIPBROL01",
  clipMusic: "CLIPMUSC01",
  clipLogo: "CLIPLOGO01",
  clipTail: "CLIPINTV02",
  marker: "MARKER0001",
} as const;

export function videoInfo(path: string, duration: number, extra: Partial<ReaderInfo> = {}): ReaderInfo {
  return {
    type: "FFmpegReader",
    path,
    has_video: true,
    has_audio: true,
    has_single_image: false,
    duration,
    width: 1280,
    height: 720,
    fps: { num: 30, den: 1 },
    video_length: String(Math.round(duration * 30)),
    pixel_ratio: { num: 1, den: 1 },
    display_ratio: { num: 16, den: 9 },
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    vcodec: "h264",
    acodec: "aac",
    ...extra,
  };
}

export function audioInfo(path: string, duration: number): ReaderInfo {
  return videoInfo(path, duration, { has_video: false, video_length: "0", vcodec: "", width: 1280, height: 720 });
}

export function imageInfo(path: string): ReaderInfo {
  return videoInfo(path, 3600, {
    type: "QtImageReader",
    has_audio: false,
    has_single_image: true,
    video_length: "108000",
    channels: 0,
    sample_rate: 0,
    acodec: "",
    vcodec: "QImage",
  });
}

/** The reader info the fake host's probe returns for a path (by extension). */
export function infoForPath(path: string): ReaderInfo {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return audioInfo(path, 12);
  if (["png", "jpg", "jpeg", "svg", "webp", "gif"].includes(ext)) return imageInfo(path);
  return videoInfo(path, 8);
}

export function media(path: string, info: ReaderInfo = infoForPath(path), name?: string): ImportedMedia {
  return name === undefined ? { path, info } : { path, info, name };
}

export const TRANSCRIPT_CUES = [
  { start: 0.5, end: 2.0, text: "Hello and welcome" },
  { start: 2.5, end: 4.5, text: "today we talk about cameras" },
  { start: 6.0, end: 8.0, text: "um so let us start" },
];

/** The fixture edit (history empty). */
export function fixtureProject(): Project {
  const scratch = new ProjectDocument(createProject({ id: "PROJECT001" }));
  scratch.transaction("fixture", (tx) => {
    addFile(tx, media("/media/interview.mp4", videoInfo("/media/interview.mp4", 20)), { id: IDS.interview });
    addFile(tx, media("/media/broll.mp4", videoInfo("/media/broll.mp4", 12)), { id: IDS.broll });
    addFile(tx, media("/media/music.mp3", audioInfo("/media/music.mp3", 60)), { id: IDS.music });
    addFile(tx, media("/media/logo.png", imageInfo("/media/logo.png")), { id: IDS.logo });
    tx.update(["files", { id: IDS.interview }], {
      ai_metadata: {
        analyzed: true,
        short_summary: "A speaker introduces a camera review.",
        tags: "interview, speaker, camera",
        index: { provider: "twelvelabs", status: "ready", index_id: "IDX0001", video_id: "VID0001", index_name: "zenvi-PROJECT001" },
        transcript_cues: TRANSCRIPT_CUES,
        chapters: [
          { start: 0, end: 5, title: "Intro", summary: "The speaker says hello and introduces cameras" },
          { start: 5, end: 20, title: "Review", summary: "Hands-on camera review" },
        ],
        scene_descriptions: [{ time: 3, description: "a man holding a tablet" }],
      },
    });
    addClip(tx, { fileId: IDS.interview, position: 0, layer: L1, start: 0, end: 10, id: IDS.clipA });
    addClip(tx, { fileId: IDS.broll, position: 10, layer: L1, start: 0, end: 5, id: IDS.clipB });
    addClip(tx, { fileId: IDS.interview, position: 15, layer: L1, start: 10, end: 14, id: IDS.clipTail });
    addClip(tx, { fileId: IDS.music, position: 0, layer: L2, start: 0, end: 19, id: IDS.clipMusic });
    addClip(tx, { fileId: IDS.logo, position: 2, layer: L3, start: 0, end: 3, id: IDS.clipLogo });
    addMarker(tx, 4, "Intro ends", { id: IDS.marker });
  });
  const project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return project;
}

let transactions = 0;

/** A fresh document on the fixture edit, with deterministic transaction ids. */
export function fixtureDoc(project: Project = fixtureProject()): ProjectDocument {
  return new ProjectDocument(project, { newTransactionId: () => `tx-${(transactions += 1)}` });
}

/** JSON-equal snapshot of a project for before/after comparisons. */
export function snapshotOf(project: Project): unknown {
  return JSON.parse(JSON.stringify(project));
}
