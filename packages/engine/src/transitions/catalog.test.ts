import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_MASK_MAX_SIZE,
  TRANSITIONS,
  lookupTransition,
  matchTransition,
  getTransition,
  listTransitions,
  resolveTransitionAsset,
  searchTransitions,
  transitionDisplayName,
  transitionReader,
} from "./catalog.js";

const assetUrl = (assetPath: string): URL => new URL(`../../assets/${assetPath}`, import.meta.url);

/** Width/height from a JPEG's SOFn segment. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("not a JPEG marker");
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + length;
  }
  throw new Error("no SOF segment");
}

describe("transition catalog", () => {
  it("has the desktop's 412 masks with unique ids", () => {
    expect(TRANSITIONS).toHaveLength(412);
    expect(listTransitions("common")).toHaveLength(7);
    expect(listTransitions("extra")).toHaveLength(405);
    expect(listTransitions()).toHaveLength(412);
    expect(new Set(TRANSITIONS.map((t) => t.id)).size).toBe(412);
    expect(listTransitions("common").map((t) => t.file)).toEqual([
      "circle_in_to_out.svg",
      "circle_out_to_in.svg",
      "fade.svg",
      "wipe_bottom_to_top.svg",
      "wipe_left_to_right.svg",
      "wipe_right_to_left.svg",
      "wipe_top_to_bottom.svg",
    ]);
  });

  it("describes each entry like the desktop stores it", () => {
    expect(getTransition("common/fade")).toEqual({
      id: "common/fade",
      name: "Fade",
      category: "common",
      file: "fade.svg",
      storedPath: "@transitions/common/fade.svg",
      assetPath: "transitions/common/fade.svg",
      width: 720,
      height: 576,
      fileSize: 5832000,
    });
  });

  it("names masks like transition_model.py", () => {
    expect(transitionDisplayName("wipe_left_to_right.svg")).toBe("Wipe left to right");
    expect(transitionDisplayName("fish-eyes_1.jpg")).toBe("Fish-eyes 1");
    expect(transitionDisplayName("4_squares_leftt_barr.jpg")).toBe("4 squares leftt barr");
    expect(transitionDisplayName("big_barr_shaking2.jpg")).toBe("Big barr shaking2");
    expect(getTransition("extra/luminous_boxes_11")!.name).toBe("Luminous boxes 11");
  });

  it("bundles every mask under its desktop name, JPGs at most 512 px", () => {
    const onDisk = ["common", "extra"].flatMap((c) => readdirSync(assetUrl(`transitions/${c}/`)).map((f) => `${c}/${f}`));
    expect(onDisk.sort()).toEqual(TRANSITIONS.map((t) => `${t.category}/${t.file}`).sort());
    for (const t of TRANSITIONS) {
      expect(existsSync(assetUrl(t.assetPath))).toBe(true);
      if (!t.file.endsWith(".jpg")) continue;
      const { width, height } = jpegSize(readFileSync(assetUrl(t.assetPath)));
      expect(Math.max(width, height)).toBeLessThanOrEqual(BUNDLED_MASK_MAX_SIZE);
      // Same aspect as the original, within a rounding pixel.
      expect(Math.abs(width / height - t.width / t.height)).toBeLessThan(0.01);
    }
  });
});

describe("searchTransitions (search_transitions_tool)", () => {
  it("matches names and file stems case-insensitively, common first", () => {
    const wipes = searchTransitions("WIPE").map((t) => t.id);
    expect(wipes.slice(0, 4)).toEqual(["common/wipe_bottom_to_top", "common/wipe_left_to_right", "common/wipe_right_to_left", "common/wipe_top_to_bottom"]);
    expect(wipes.slice(4)).toEqual(["extra/wipe_diagonal_1", "extra/wipe_diagonal_2", "extra/wipe_diagonal_3", "extra/wipe_diagonal_4"]);
    expect(searchTransitions("left to right").map((t) => t.id)).toEqual(["common/wipe_left_to_right", "extra/clock_left_to_right"]);
    expect(searchTransitions("fish-eyes_1").map((t) => t.id)).toEqual(["extra/fish-eyes_1", "extra/fish-eyes_10"]);
    expect(searchTransitions("")).toHaveLength(412);
    expect(searchTransitions("no such mask")).toEqual([]);
  });
});

describe("matchTransition (apply_transition_tool)", () => {
  it("prefers exact ids, files and names", () => {
    expect(matchTransition("extra/board_10")!.id).toBe("extra/board_10");
    expect(matchTransition("board_10")!.id).toBe("extra/board_10");
    expect(matchTransition("board_10.jpg")!.id).toBe("extra/board_10");
    expect(matchTransition("Board 10")!.id).toBe("extra/board_10");
    expect(matchTransition("Wipe left to right")!.id).toBe("common/wipe_left_to_right");
    expect(matchTransition("FADE")!.id).toBe("common/fade");
  });

  it("falls back to the desktop's containment rule", () => {
    expect(matchTransition("fade in")!.id).toBe("common/fade");
    expect(matchTransition("crossfade")!.id).toBe("common/fade");
    expect(matchTransition("circle")!.id).toBe("common/circle_in_to_out");
    expect(matchTransition("ripple")!.id).toBe("extra/barr_ripple_1");
    expect(matchTransition("common/wipe_top_to_bottom please")!.id).toBe("common/wipe_top_to_bottom");
    expect(matchTransition("no such mask")).toBeUndefined();
    // Desktop: an empty name matches the first file.
    expect(matchTransition("")!.id).toBe("common/circle_in_to_out");
  });
});

describe("lookupTransition (the transition editor tools)", () => {
  const key = (name: string) => lookupTransition(name).entry?.id;

  // zenvi-core develop tests/test_transition_ops.py test_find_transition_exact_alias_partial_and_ambiguous,
  // on the real catalog.
  it("takes exact keys and names, then aliases, then a unique part of a key", () => {
    expect(key("Fade")).toBe("common/fade");
    expect(key("crossfade")).toBe("common/fade");
    expect(key("Cross Dissolve")).toBe("common/fade");
    expect(key("wipe right")).toBe("common/wipe_left_to_right");
    expect(key("Wipe_Left_To_Right.svg")).toBe("common/wipe_left_to_right");
    expect(key("circle")).toBe("common/circle_in_to_out");
    expect(key("iris close")).toBe("common/circle_out_to_in");
    expect(key("fractal 3")).toBe("extra/fractal_3");
    expect(key("bottom to top")).toBe("common/wipe_bottom_to_top");
  });

  it("answers candidates when a name matches several masks or none", () => {
    expect(lookupTransition("fractal")).toEqual({
      entry: undefined,
      candidates: ["fractal_1", "fractal_2", "fractal_3", "fractal_4", "fractal_5", "fractal_6", "fractal_7", "fractal_8"],
    });
    expect(lookupTransition("wipe").candidates).toEqual([
      "wipe_bottom_to_top",
      "wipe_left_to_right",
      "wipe_right_to_left",
      "wipe_top_to_bottom",
      "wipe_diagonal_1",
      "wipe_diagonal_2",
      "wipe_diagonal_3",
      "wipe_diagonal_4",
    ]);
    expect(lookupTransition("nothing-like-it")).toEqual({ entry: undefined, candidates: [] });
    expect(lookupTransition("  ")).toEqual({ entry: undefined, candidates: [] });
  });

  it("takes the web's own references: ids and stored or installed paths", () => {
    expect(key("common/fade")).toBe("common/fade");
    expect(key("@transitions/extra/fractal_1.jpg")).toBe("extra/fractal_1");
    expect(key("/Applications/Zenvi.app/Contents/Resources/transitions/common/fade.svg")).toBe("common/fade");
  });
});

describe("resolveTransitionAsset", () => {
  it("maps stored and installed paths to the catalog", () => {
    expect(resolveTransitionAsset("@transitions/common/fade.svg")!.id).toBe("common/fade");
    expect(resolveTransitionAsset("/Applications/Zenvi.app/Contents/Resources/transitions/extra/board_1.jpg")!.id).toBe("extra/board_1");
    expect(resolveTransitionAsset("C:\\Program Files\\Zenvi\\transitions\\common\\fade.svg")!.id).toBe("common/fade");
    expect(resolveTransitionAsset("@transitions/common/missing.svg")).toBeUndefined();
    expect(resolveTransitionAsset("/media/fade.svg")).toBeUndefined();
    expect(resolveTransitionAsset("/home/me/my_transitions/common/fade.svg")).toBeUndefined();
  });
});

describe("transitionReader", () => {
  it("is QtImageReader(path).Json() with the stored path", () => {
    // libopenshot 1.0 QtImageReader for fade.svg (desktop timeline.py _load_transition_reader_data).
    const reader = transitionReader(getTransition("common/fade")!);
    expect(reader).toEqual({
      acodec: "",
      audio_bit_rate: 0,
      audio_stream_index: -1,
      audio_timebase: { den: 1, num: 1 },
      channel_layout: 4,
      channels: 0,
      display_ratio: { den: 4, num: 5 },
      duration: 3600,
      file_size: 5832000,
      fps: { den: 1, num: 30 },
      has_audio: false,
      has_single_image: true,
      has_video: true,
      height: 576,
      interlaced_frame: false,
      metadata: {},
      path: "@transitions/common/fade.svg",
      pixel_format: -1,
      pixel_ratio: { den: 1, num: 1 },
      sample_rate: 0,
      top_field_first: true,
      type: "QtImageReader",
      vcodec: "",
      video_bit_rate: 0,
      video_length: 108000,
      video_stream_index: -1,
      video_timebase: { den: 30, num: 1 },
      width: 720,
    });
    expect(Object.keys(reader)).toEqual([...Object.keys(reader)].sort());
  });

  it("reduces the display ratio like libopenshot Fraction::Reduce and returns fresh objects", () => {
    const wide = transitionReader(getTransition("extra/wipe_diagonal_1")!);
    expect([wide.width, wide.height, wide.display_ratio]).toEqual([1920, 1080, { num: 16, den: 9 }]);
    const a = transitionReader(getTransition("common/fade")!);
    const b = transitionReader(getTransition("common/fade")!);
    expect(a.metadata).not.toBe(b.metadata);
    expect(a.fps).not.toBe(b.fps);
  });
});
