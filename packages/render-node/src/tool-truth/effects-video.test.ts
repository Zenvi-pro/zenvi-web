import { commonParamCases, effectCases } from "./cases/effects.js";
import { truthSuite } from "./suite.js";

truthSuite("tool truth: video effect parameters (add_effect_tool)", [...effectCases("video"), ...commonParamCases()]);
