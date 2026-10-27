import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Project } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { L1, imageInfo, media, videoInfo } from "./fixture.js";

/** A 10 s cut: A (0-2 s), B (2-4 s), A again from the same moment (4-6 s), C (6-10 s); `extra` files wait in the bin. */
export function repeatedCut(extra: ("video" | "still")[] = ["video"]): Project {
  const doc = new ProjectDocument(createProject({ id: "SWAPS00001" }));
  doc.transaction("fixture", (tx) => {
    for (const [id, seconds] of [["FILEAAAAAA", 8], ["FILEBBBBBB", 8], ["FILECCCCCC", 8]] as const) addFile(tx, media(`/media/${id}.mp4`, videoInfo(`/media/${id}.mp4`, seconds)), { id });
    extra.forEach((kind, i) => {
      const id = `FILEXTRA0${i}`;
      if (kind === "still") addFile(tx, media(`/media/${id}.png`, imageInfo(`/media/${id}.png`)), { id });
      else addFile(tx, media(`/media/${id}.mp4`, videoInfo(`/media/${id}.mp4`, 6)), { id });
    });
    addClip(tx, { fileId: "FILEAAAAAA", position: 0, layer: L1, start: 1, end: 3, id: "CLIPA00001" });
    addClip(tx, { fileId: "FILEBBBBBB", position: 2, layer: L1, start: 0, end: 2, id: "CLIPB00001" });
    addClip(tx, { fileId: "FILEAAAAAA", position: 4, layer: L1, start: 1, end: 3, id: "CLIPA00002" });
    addClip(tx, { fileId: "FILECCCCCC", position: 6, layer: L1, start: 0, end: 4, id: "CLIPC00001" });
  });
  return doc.project;
}
