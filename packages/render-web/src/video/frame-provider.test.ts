import { describe, expect, it, vi } from "vitest";
import type { MediaLease, MediaRegistry, OpenMedia } from "../media/registry.js";
import { FrameProvider } from "./frame-provider.js";

describe("FrameProvider", () => {
  it("rejects a request whose media finished opening after dispose, and releases the lease", async () => {
    let open!: (lease: MediaLease) => void;
    const release = vi.fn();
    const media = {
      keyOf: () => "clip.mp4",
      acquire: () => new Promise<MediaLease>((resolve) => (open = resolve)),
      onInvalidate: () => () => undefined,
    } as unknown as MediaRegistry;
    const provider = new FrameProvider({ media });

    const request = provider.frame({ ref: { fileId: "F1" }, sourceTime: 0, width: 64, height: 36, lane: "C1", mode: "sequential" });
    await provider.dispose();
    open({ media: { key: "clip.mp4", version: 1, video: null } as unknown as OpenMedia, release });

    await expect(request).rejects.toThrow(/disposed/);
    expect(release).toHaveBeenCalledOnce();
  });
});
