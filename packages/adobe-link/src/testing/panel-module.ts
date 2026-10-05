/** Typed access to the panel's CommonJS logic (extension/panel/panel-core.js) for tests. */

import { createRequire } from "node:module";
import type { HostReceipt } from "../receipt.js";

const require = createRequire(import.meta.url);

export const panelCore = require("../../extension/panel/panel-core.js") as {
  rpc(url: string, token: string, method: string, params?: unknown, timeoutMs?: number): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
  callTool(url: string, token: string, name: string, args?: unknown, timeoutMs?: number): Promise<{ receipt: HostReceipt | null; text: string; images: unknown[]; isError: boolean }>;
  parseRpcBody(text: string): unknown;
  findLiveEndpoint(options: { host: string; dir?: string; home?: string; appVersion?: string; timeoutMs?: number }): Promise<(Record<string, unknown> & { url: string; token: string }) | null>;
  desktopStatus(home?: string): { running: boolean; pid?: number; project?: string | null; url?: string | null; token?: string | null };
  mcpConfig(host: string, url: string, token: string): { name: string; claude: string; json: string };
  skinVariables(skin: unknown): Record<string, string>;
  clock(iso: string): string;
};
