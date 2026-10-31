import { FX_TOOL_CASES, fxCases } from "./cases/fx.js";
import { truthSuite } from "./suite.js";

truthSuite("tool truth: Zenvi FX (apply_fx_tool, update_fx_tool)", [...fxCases(), ...FX_TOOL_CASES]);
