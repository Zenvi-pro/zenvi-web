/**
 * Premiere Pro tools (`premiere_*`, SPEC §3.4). Each definition here has
 * exactly one ExtendScript implementation registered with
 * `ZenviLink.register` under `extension/host/ppro/` (a test enforces the 1:1
 * match).
 */

import { z } from "zod";
import { defineHostTool, type HostToolDef } from "./types.js";

export const premiereGetState = defineHostTool({
  name: "premiere_get_state",
  title: "Premiere Pro state",
  description:
    "Where Premiere Pro is right now: app version, the open project (path, name), every sequence (id, name, duration, " +
    "frame size, fps), the active sequence with its playhead, in/out points and selected clips. Call it first, and again " +
    "whenever the user may have changed something by hand. Read-only and cheap.",
  input: z.strictObject({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const PREMIERE_TOOLS: HostToolDef[] = [premiereGetState];
