import { describe, expect, it } from "vitest";
import { createProject } from "../../model/defaults.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { pickNarrationTrack } from "./generation.js";

function project(clips: Array<[layer: number, position: number, seconds: number, fileId: string]>, files: Array<[id: string, path: string]> = []): Project {
  const p = createProject();
  p.files = files.map(([id, path]) => ({ id, path, media_type: "audio" }) as unknown as ProjectFile);
  p.clips = clips.map(([layer, position, seconds, file_id], i) => ({ id: `C${i}`, layer, position, start: 0, end: seconds, file_id }) as unknown as Clip);
  return p;
}

describe("pickNarrationTrack (W53 B8)", () => {
  it("never picks the bottom picture track: the narration track, else the lowest empty one above it", () => {
    const tracks = createProject().layers.map((l) => l.number).sort((a, b) => a - b);
    expect(tracks.length).toBeGreaterThan(2);
    // Footage on the bottom track and the one above it: the next empty one.
    expect(pickNarrationTrack(project([[tracks[0]!, 0, 10, "V"], [tracks[1]!, 0, 10, "V"]]), 2, 4)).toBe(tracks[2]);
    // A track holding only earlier narration, free over the range, wins.
    const tts = project([[tracks[0]!, 0, 10, "V"], [tracks[2]!, 0, 1.5, "N"]], [["N", "/p/zenvi_tts_abc.mp3"]]);
    expect(pickNarrationTrack(tts, 2, 4)).toBe(tracks[2]);
    // ...unless the new line would overlap it.
    expect(pickNarrationTrack(tts, 1, 3)).toBe(tracks[1]);
  });

  it("asks for a new track when every track above the main one is busy or locked", () => {
    const p = project([]);
    const [bottom, ...rest] = [...p.layers].sort((a, b) => a.number - b.number);
    p.clips = [{ id: "B", layer: bottom!.number, position: 0, start: 0, end: 5, file_id: "V" } as unknown as Clip];
    for (const t of rest) t.lock = true;
    expect(pickNarrationTrack(p, 0, 2)).toBeNull();
  });
});
