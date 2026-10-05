/**
 * After Effects tools (`ae_*`, SPEC §3.4). Each definition here has exactly
 * one ExtendScript implementation registered with `ZenviLink.register` under
 * `extension/host/aeft/` (a test enforces the 1:1 match).
 */

import { z } from "zod";
import { defineHostTool, type HostToolDef } from "./types.js";

export const aeGetState = defineHostTool({
  name: "ae_get_state",
  title: "After Effects state",
  description:
    "Where After Effects is right now: app version, the open project (path, unsaved changes, item count), the active comp " +
    "(id, size, fps, duration, work area, current time, layer count), the selected project items and layers, and the render " +
    "queue. Call it first, and again whenever the user may have changed something by hand. Read-only and cheap.",
  input: z.strictObject({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const AE_TOOLS: HostToolDef[] = [aeGetState];
