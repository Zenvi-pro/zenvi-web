/** Every tool truth case, for the coverage gate and the report. */

import type { TruthCase } from "../harness.js";
import { clipPropertyCases } from "./clip-props.js";
import { commonParamCases, effectCases } from "./effects.js";
import { EDIT_TOOL_CASES } from "./tools-edit.js";
import { PICTURE_TOOL_CASES } from "./tools-picture.js";
import { SOUND_TOOL_CASES } from "./tools-sound.js";

export function allCases(): TruthCase[] {
  return [...effectCases("video"), ...commonParamCases(), ...effectCases("audio"), ...clipPropertyCases(), ...PICTURE_TOOL_CASES, ...SOUND_TOOL_CASES, ...EDIT_TOOL_CASES];
}
