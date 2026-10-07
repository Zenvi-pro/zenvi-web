/**
 * The After Effects (`ae_*`) and Premiere Pro (`premiere_*`) tool families:
 * listed from the @zenvi/adobe-link catalogs (never copied), called on the
 * live app through Zenvi Link. Shared by `zenvi mcp` and `zenvi ae` /
 * `zenvi premiere` / `zenvi call`.
 *
 * Before a call: unknown argument names are refused, text values (from a
 * command line, or a client that sends strings) are converted to what the
 * tool's schema takes (coerceHostArgs), and an app that is not connected
 * gives a `refused` receipt saying how to connect it. Zenvi Link itself
 * validates types, enums and ranges, handles nulls and fills the TASTE
 * defaults.
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { HOST_IDS, HOST_TOOL_PREFIX, catalogFor, toCatalogJson, type CatalogToolJson, type HostId, type HostImage, type HostReceipt } from "@zenvi/adobe-link";
import { unknownArgumentsMessage } from "../util/unknown-args.js";
import { APP_LABEL } from "./policy.js";
import { howToConnect, type HostRegistry } from "./registry.js";

/** The app instance that answered a call. */
export interface HostInstance {
  pid: number;
  app_name: string | null;
  app_version: string | null;
  project: string | null;
}

/** A host receipt as the CLI reports it: Zenvi Link's, or one the CLI made (NOT_CONNECTED…). */
export type CliHostReceipt = Omit<HostReceipt, "error"> & { error?: { code: string; message: string; line?: number }; host_instance?: HostInstance };

export interface HostCallResult {
  receipt: CliHostReceipt;
  images: HostImage[];
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  annotations: Record<string, unknown>;
}

export const STATE_TOOL: { readonly [H in HostId]: string } = { aftereffects: "ae_get_state", premiere: "premiere_get_state" };

/** The Adobe app a tool name belongs to (by prefix), if any. */
export function hostOfTool(name: string): HostId | undefined {
  return HOST_IDS.find((host) => name.startsWith(HOST_TOOL_PREFIX[host]));
}

const catalogs = new Map<HostId, Map<string, CatalogToolJson>>();

/** The family's catalog as JSON (schemas generated once per process). */
export function catalogTools(host: HostId): Map<string, CatalogToolJson> {
  let tools = catalogs.get(host);
  if (!tools) {
    tools = new Map(toCatalogJson(host, catalogFor(host)).tools.map((tool) => [tool.name, tool]));
    catalogs.set(host, tools);
  }
  return tools;
}

/** MCP tool definitions for one family: catalog schemas and annotations, description prefixed with the app. */
export function adobeToolDefinitions(host: HostId): McpToolDefinition[] {
  return [...catalogTools(host).values()].map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: `${APP_LABEL[host]}: ${tool.description}`,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, ...tool.annotations },
  }));
}

function receipt(host: HostId, tool: string, status: "refused" | "error", code: string, message: string, data: Record<string, unknown> = {}): CliHostReceipt {
  const text = message.replace(/^Error:\s*/, "");
  return { contract: 3, status, tool, host, summary: `Error: ${text}`, data, warnings: [], undoSteps: 0, error: { code, message: text } };
}

/** A `refused` host receipt (nothing ran in the app). */
export function hostRefusal(host: HostId, tool: string, code: string, message: string, data: Record<string, unknown> = {}): CliHostReceipt {
  return receipt(host, tool, "refused", code, message, data);
}

function hostFailure(host: HostId, tool: string, code: string, message: string): CliHostReceipt {
  return receipt(host, tool, "error", code, message);
}

/** The JSON Schema subset the host catalogs use (zod's output). */
interface SchemaNode {
  type?: string | string[];
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  enum?: unknown[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
}

/** A property's alternatives, through nested anyOf / oneOf (`layerRef.nullable()` nests one union in another). */
function leaves(schema: SchemaNode | undefined, out: SchemaNode[] = []): SchemaNode[] {
  if (!schema || typeof schema !== "object") return out;
  const branches = schema.anyOf ?? schema.oneOf;
  if (!branches) {
    out.push(schema);
    return out;
  }
  for (const branch of branches) leaves(branch, out);
  return out;
}

function typesOf(leaf: SchemaNode): string[] {
  if (typeof leaf.type === "string") return [leaf.type];
  if (Array.isArray(leaf.type)) return leaf.type;
  return (leaf.enum ?? []).map((v) => (v === null ? "null" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v));
}

const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * One argument against its schema. Text becomes what the schema takes:
 * digits are an id wherever an integer is accepted (also next to a name:
 * `layer=12`, `parent=5`, `{"before": "7"}`), numbers, booleans, JSON for
 * arrays and objects, `null` where null is allowed. Typed values, `null` and
 * `""` pass unchanged: Zenvi Link reads `null` as "remove" (`parent: null`,
 * `stroke: null`) and `""` as "clear" (`expression: ""`).
 */
export function coerceHostValue(value: unknown, schema: SchemaNode | undefined): unknown {
  if (value === null || value === undefined || !schema) return value;
  const options = leaves(schema);
  const types = new Set(options.flatMap(typesOf));
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return value;
    if (text === "null" && types.has("null")) return null;
    if (types.has("integer") && /^\d+$/.test(text)) return Number.parseInt(text, 10);
    if (types.has("string")) return value;
    if (types.has("integer") && /^-\d+$/.test(text)) return Number.parseInt(text, 10);
    if (types.has("number") && NUMBER_TEXT.test(text)) return Number(text);
    if (types.has("boolean")) {
      const low = text.toLowerCase();
      if (["true", "1", "yes", "on"].includes(low)) return true;
      if (["false", "0", "no", "off"].includes(low)) return false;
    }
    if ((types.has("array") || types.has("object")) && /^[[{]/.test(text)) {
      try {
        return coerceHostValue(JSON.parse(text), schema);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    const lists = options.filter((leaf) => typesOf(leaf).includes("array") && leaf.items);
    return lists.length === 1 ? value.map((item) => coerceHostValue(item, lists[0]!.items)) : value;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    // The object branch whose properties name every key (`{before}` vs `{after}` vs `{index}`).
    const shape = options.find((leaf) => typesOf(leaf).includes("object") && leaf.properties && keys.every((key) => key in leaf.properties!));
    if (!shape?.properties) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, coerceHostValue(item, shape.properties![key])]));
  }
  return value;
}

/** Every argument against the tool's input schema (unknown names were refused before). */
export function coerceHostArgs(schema: { properties?: Record<string, unknown> } | undefined, args: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema?.properties ?? {}) as Record<string, SchemaNode>;
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, coerceHostValue(value, properties[key])]));
}

export function isOkHostStatus(status: string): boolean {
  return status === "applied" || status === "unchanged" || status === "ok";
}

export interface AdobeCallOptions {
  /** Client-side wait; default the catalog timeout plus a margin. */
  timeoutMs?: number;
}

/** Run one `ae_*` / `premiere_*` tool in its app. Never throws for user errors. */
export async function callAdobeTool(registry: HostRegistry, name: string, rawArgs: Record<string, unknown>, options: AdobeCallOptions = {}): Promise<HostCallResult> {
  const host = hostOfTool(name);
  if (!host) throw new Error(`${name} is not an After Effects or Premiere Pro tool`);
  const app = APP_LABEL[host];
  const def = catalogTools(host).get(name);
  if (def) {
    const unknown = unknownArgumentsMessage(name, rawArgs, def.inputSchema);
    if (unknown) return { receipt: hostRefusal(host, name, "INVALID_ARGUMENT", unknown), images: [] };
  }
  const connection = await registry.connect(host);
  if (!connection.ok) {
    const { discovery } = connection;
    return {
      receipt: hostRefusal(host, name, "NOT_CONNECTED", `${app} is not connected: ${discovery.detail}. ${howToConnect(host, discovery)}`, { status: discovery.status }),
      images: [],
    };
  }
  // A tool this zenvi's catalog lacks may still exist in a newer Zenvi Link: ask the app.
  let schema: { properties?: Record<string, unknown> } | undefined = def?.inputSchema;
  if (!def) {
    let live: Awaited<ReturnType<HostRegistry["liveTools"]>>;
    try {
      live = await registry.liveTools(host);
    } catch (error) {
      await registry.dropClient(host);
      return { receipt: hostFailure(host, name, "HOST_ERROR", `could not list ${app}'s tools (${error instanceof Error ? error.message : String(error)}); check list_hosts and try again`), images: [] };
    }
    const found = live?.find((t) => t.name === name);
    if (!found) {
      const known = [...new Set([...catalogTools(host).keys(), ...(live ?? []).map((t) => t.name)])];
      return { receipt: hostRefusal(host, name, "NOT_FOUND", `${app} has no tool named ${name}. Its tools: ${known.join(", ") || `none (${HOST_TOOL_PREFIX[host]}*)`}.`), images: [] };
    }
    schema = (found.inputSchema ?? {}) as { properties?: Record<string, unknown> };
    const unknown = unknownArgumentsMessage(name, rawArgs, schema);
    if (unknown) return { receipt: hostRefusal(host, name, "INVALID_ARGUMENT", unknown), images: [] };
  }
  const args = coerceHostArgs(schema, rawArgs);
  try {
    const result = await connection.client.callTool(name, args, options.timeoutMs ? { timeoutMs: options.timeoutMs } : {});
    const got =
      result.receipt ??
      ({
        contract: 3,
        status: result.isError ? "error" : "ok",
        tool: name,
        host,
        summary: result.isError && !result.text.startsWith("Error") ? `Error: ${result.text}` : result.text || `${name} finished`,
        data: {},
        warnings: [],
        undoSteps: null,
      } satisfies CliHostReceipt);
    const endpoint = connection.endpoint;
    const instance: HostInstance = { pid: endpoint.pid, app_name: endpoint.appName || null, app_version: endpoint.appVersion || null, project: endpoint.project };
    const warnings =
      connection.switchedFrom !== undefined
        ? [
            ...(got.warnings ?? []),
            `${app} answered from another instance than the last call (pid ${connection.switchedFrom} -> ${endpoint.pid}${endpoint.project ? `, ${endpoint.project}` : ""}): the newest Zenvi Link took over. Re-read ${STATE_TOOL[host]} before continuing.`,
          ]
        : got.warnings;
    return { receipt: { ...got, warnings, host_instance: instance }, images: result.images };
  } catch (error) {
    if (error instanceof McpError && error.code === ErrorCode.InvalidParams) {
      // The running Zenvi Link does not know this tool: an older extension than this zenvi.
      const version = connection.endpoint.version ? ` ${connection.endpoint.version}` : "";
      return {
        receipt: hostRefusal(host, name, "UNSUPPORTED", `Zenvi Link${version} in ${app} has no ${name} (${error.message}). Update it with \`zenvi adobe install\` and restart ${app}.`),
        images: [],
      };
    }
    await registry.dropClient(host);
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
      return { receipt: hostFailure(host, name, "TIMEOUT", `${app} did not answer ${name} in time (${message}). It may still be working; check ${STATE_TOOL[host]} before retrying.`), images: [] };
    }
    return {
      receipt: hostFailure(host, name, "HOST_ERROR", `lost the connection to ${app} during ${name} (${message}). If it ran, it may have changed the project: check ${STATE_TOOL[host]} and list_hosts before retrying.`),
      images: [],
    };
  }
}

/** A tool's input schema as the connected app lists it (orchestrations map their arguments onto it). */
export async function liveToolSchema(registry: HostRegistry, host: HostId, tool: string): Promise<{ properties: Record<string, unknown> } | undefined> {
  const found = (await registry.liveTools(host))?.find((t) => t.name === tool);
  if (!found) return undefined;
  const schema = (found.inputSchema ?? {}) as { properties?: Record<string, unknown> };
  return { properties: schema.properties ?? {} };
}
