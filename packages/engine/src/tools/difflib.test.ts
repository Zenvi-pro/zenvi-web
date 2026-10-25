/** difflib.get_close_matches against CPython 3.12's answers for the same inputs. */

import { describe, expect, it } from "vitest";
import { getCloseMatches, sequenceRatio } from "./difflib.js";

const KWLIST = [
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
];

const EFFECTS = [
  "AnalogTape", "AudioVisualization", "Bars", "BeatSync", "Blur", "Brightness", "Caption", "ChromaKey", "ColorGrade",
  "ColorMap", "ColorShift", "Crop", "Deinterlace", "DenoiseImage", "Displace", "FilmGrain", "Glow", "Hue", "LensFlare",
  "Mask", "Negate", "ObjectDetection", "ObjectMask", "Outline", "Pixelate", "Saturation", "Shadow", "Sharpen", "Shift",
  "SphericalProjection", "Stabilizer", "Timer", "Tracker", "Wave", "Compressor", "Delay", "Distortion", "Echo",
  "Expander", "Noise", "ParametricEQ", "Robotization", "Whisperization",
];

describe("getCloseMatches", () => {
  it("answers like CPython", () => {
    expect(getCloseMatches("appel", ["ape", "apple", "peach", "puppy"])).toEqual(["apple", "ape"]);
    expect(getCloseMatches("wheel", KWLIST)).toEqual(["while"]);
    expect(getCloseMatches("Apple", KWLIST)).toEqual([]);
    expect(getCloseMatches("accept", KWLIST)).toEqual(["except"]);
    expect(getCloseMatches("Blurr", EFFECTS, 4, 0.5)).toEqual(["Blur"]);
    expect(
      getCloseMatches("radius", ["horizontal_radius", "vertical_radius", "sigma", "iterations", "mask_mode", "apply_before_clip"], 3, 0.5),
    ).toEqual(["vertical_radius", "horizontal_radius", "iterations"]);
    expect(getCloseMatches("no such lut", ["cinematic_&_blockbuster/teal_cinema", "dark_&_moody/cold_shadows"], 5, 0.3)).toEqual([]);
    // Equal scores: the larger string first (heapq.nlargest on (score, x)).
    expect(getCloseMatches("abcab", ["bcaba", "abcab", "cabab", "babca"], 4, 0)).toEqual(["abcab", "bcaba", "babca", "cabab"]);
  });

  it("scores like SequenceMatcher.ratio, popular elements included", () => {
    expect(sequenceRatio("teal", "teal_cinema")).toBeCloseTo(0.5333333333333333, 15);
    expect(sequenceRatio("a".repeat(250) + "b", "a".repeat(300))).toBeCloseTo(0.9074410163339383, 15);
  });
});
