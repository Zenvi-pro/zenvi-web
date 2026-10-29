/** Every tool truth case, for the coverage gate and the report. */

import type { TruthCase } from "../harness.js";
import { clipPropertyCases } from "./clip-props.js";
import { commonParamCases, effectCases } from "./effects.js";
import { FX_TOOL_CASES, fxCases } from "./fx.js";
import { EDIT_TOOL_CASES } from "./tools-edit.js";
import { FINISH_TOOL_CASES } from "./tools-finish.js";
import { MORE_TOOL_CASES } from "./tools-more.js";
import { PICTURE_TOOL_CASES } from "./tools-picture.js";
import { SOUND_TOOL_CASES } from "./tools-sound.js";

export function allCases(): TruthCase[] {
  return [...effectCases("video"), ...commonParamCases(), ...effectCases("audio"), ...clipPropertyCases(), ...PICTURE_TOOL_CASES, ...SOUND_TOOL_CASES, ...EDIT_TOOL_CASES, ...MORE_TOOL_CASES, ...FINISH_TOOL_CASES, ...fxCases(), ...FX_TOOL_CASES];
}
