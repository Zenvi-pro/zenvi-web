/**
 * Test helpers for op tests (used only by `*.test.ts`): a small project with
 * video, audio and image media, and assertions that an op refused cleanly.
 */

import { expect } from "vitest";
import { ProjectDocument, type Transaction } from "../history/document.js";
import type { Project, ProjectFile, ReaderInfo } from "../model/types.js";
import { createProject } from "../model/defaults.js";
import { OpError, type OpErrorCode } from "./errors.js";

export function reader(extra: Partial<ReaderInfo> = {}): ReaderInfo {
  return {
    type: "FFmpegReader",
    path: "/media/clip.mp4",
    has_video: true,
    has_audio: true,
    has_single_image: false,
    duration: 20,
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
    video_length: "600",
    pixel_ratio: { num: 1, den: 1 },
    display_ratio: { num: 16, den: 9 },
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    ...extra,
  };
}

export function videoFile(id = "VIDEO00001", extra: Partial<ProjectFile> = {}): ProjectFile {
  return { ...reader(), id, media_type: "video", ...extra } as ProjectFile;
}

export function audioFile(id = "AUDIO00001"): ProjectFile {
  return {
    ...reader({ path: "/media/song.mp3", has_video: false, width: 1280, height: 720, duration: 30, video_length: "0" }),
    id,
    media_type: "audio",
  } as ProjectFile;
}

export function imageFile(id = "IMAGE00001"): ProjectFile {
  return {
    ...reader({
      type: "QtImageReader",
      path: "/media/photo.png",
      has_audio: false,
      has_single_image: true,
      duration: 3600,
      video_length: 108000,
      channels: 0,
      sample_rate: 0,
    }),
    id,
    media_type: "image",
  } as ProjectFile;
}

/** A 30 fps 1280×720 project with three media files and no clips. */
export function baseProject(): Project {
  const project = createProject({ id: "PROJECT001" });
  project.files = [videoFile(), audioFile(), imageFile()];
  return project;
}

let counter = 0;
/** A document with deterministic transaction ids. */
export function makeDoc(project: Project = baseProject()): ProjectDocument {
  return new ProjectDocument(project, { newTransactionId: () => `tx-${(counter += 1)}` });
}

/**
 * Assert that running `body` in a transaction throws `OpError` with `code`
 * and leaves the document (snapshot and history) exactly as it was.
 */
export function expectRefused(doc: ProjectDocument, code: OpErrorCode, body: (tx: Transaction) => unknown): OpError {
  const before = doc.project;
  const undo = doc.undoLabels.length;
  const redo = doc.redoLabels.length;
  let caught: unknown;
  try {
    doc.transaction("refused", body);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(OpError);
  expect((caught as OpError).code).toBe(code);
  expect(doc.project).toBe(before);
  expect(doc.undoLabels.length).toBe(undo);
  expect(doc.redoLabels.length).toBe(redo);
  return caught as OpError;
}

/** Assert an undo restores `before` exactly and redo restores `after`. */
export function expectUndoRedo(doc: ProjectDocument, before: Project): void {
  const after = doc.project;
  doc.undo();
  expect(JSON.parse(JSON.stringify(doc.project))).toEqual(JSON.parse(JSON.stringify(before)));
  doc.redo();
  expect(JSON.parse(JSON.stringify(doc.project))).toEqual(JSON.parse(JSON.stringify(after)));
}
