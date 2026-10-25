import type { Project } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { MemoryMediaStore } from "@/lib/storage/media";
import { uploadMissingMedia } from "./cloudMedia";

describe("uploadMissingMedia", () => {
  it("never reports a bundled emoji as missing from Zenvi Cloud", async () => {
    const project = {
      files: [
        { id: "EMOJI", path: "@emojis/1F525.svg", media_type: "image", name: "Fire" },
        { id: "LOCAL", path: "/Users/me/take.mov", media_type: "video" },
      ],
    } as unknown as Project;
    const cloud = { checkMedia: vi.fn(async () => new Set<string>()) };
    const result = await uploadMissingMedia(project, cloud as never, new MemoryMediaStore(), new Set());
    expect(result.missing).toEqual([{ fileId: "LOCAL", name: "take.mov" }]);
    expect(cloud.checkMedia).not.toHaveBeenCalled();
  });
});
