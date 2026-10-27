/**
 * mcp_health_tool: is this Zenvi up, and can it render Zenvi Motion blocks.
 *
 * Port of zenvi-core agent_api_proxy.py `mcp_health_tool`, which asks the
 * desktop editor whether its Qt main thread still answers. Here there is no
 * editor thread to wait for (`main_thread_timeout_seconds` is accepted and
 * unused): the call itself proves the host is up, and the receipt adds what
 * an agent cannot see otherwise, namely whether motion blocks can render.
 */

import { contractTool } from "../define.js";
import { applied } from "../receipt.js";

export const healthTools = [
  contractTool("mcp_health_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call) => {
      const motion = call.host.motion;
      const runtime = await motion?.runtime?.();
      const warnings = runtime && !runtime.ready ? [runtime.detail] : [];
      const lines = ["Zenvi is up."];
      if (!motion) lines.push("Zenvi Motion blocks: not available on this host.");
      else if (runtime) lines.push(`Zenvi Motion blocks: ${runtime.ready ? "ready." : runtime.detail}`);
      else lines.push("Zenvi Motion blocks: rendered by this host.");
      return applied("mcp_health_tool", lines.join(" "), { warnings, data: { ok: true, motion: motion ? { available: true, ...(runtime ? { runtime } : {}) } : { available: false } } }, 0);
    },
  }),
];
