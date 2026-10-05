/**
 * The hosts `zenvi mcp` can drive (SPEC §3.8): the Zenvi desktop app, the
 * portable Zenvi engine (this process), After Effects and Premiere Pro
 * (Zenvi Link). `list()` merges desktop discovery (gui_mcp.json /
 * headless_mcp.json), the portable session and the Zenvi Link discovery
 * files, and marks the active host: the connected one used most recently.
 *
 * Discovery only reads the files the apps write and sends one `initialize`
 * to the exact URL each names (never a port scan); a snapshot is reused for
 * up to 2 s. Adobe calls go through one HostClient per app, kept while the
 * app's discovery file names the same server and its process lives.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HOST_IDS, HostClient, catalogFor, inspectHost, inspectHosts, linkDirOf, pidAlive, LINK_VERSION, type HostDiscovery, type HostEndpoint, type HostId, type HostToolInfo } from "@zenvi/adobe-link";
import type { ZenviConfig } from "../config.js";
import { discoverDesktop, hasProjectOpen, type DesktopEndpoint } from "../desktop/discovery.js";
import { defaultDetectDeps, type DetectDeps } from "./extension.js";
import { APP_LABEL, decideFamilies, type FamilyDecisions } from "./policy.js";

export type HostKey = "zenvi-desktop" | "zenvi-portable" | "after-effects" | "premiere-pro";

/** SPEC §3.8 ids of the Adobe hosts. */
export const ADOBE_HOST_KEY: { readonly [H in HostId]: HostKey } = { aftereffects: "after-effects", premiere: "premiere-pro" };

export interface HostEntry {
  id: HostKey;
  kind: "zenvi" | HostId;
  label: string;
  connected: boolean;
  active: boolean;
  [key: string]: unknown;
}

export interface HostsReport {
  hosts: HostEntry[];
  /** The connected host used most recently (the portable engine when nothing else runs). */
  active: HostKey;
}

/** What the MCP session knows about its own (portable) project. */
export interface PortableView {
  project: string | null;
  /** When the portable engine last ran a tool (ms since epoch). */
  lastCallAt?: number;
}

export interface HostRegistryOptions {
  config: ZenviConfig;
  env: NodeJS.ProcessEnv;
  clientVersion: string;
  /** The MCP session's project; the CLI's `zenvi hosts` passes the selected project. */
  portable?: () => PortableView;
  detect?: DetectDeps;
  cacheMs?: number;
}

interface Snapshot {
  desktop: DesktopEndpoint[];
  /** Discovery file mtime per desktop endpoint (`source`). */
  desktopTouched: Map<string, number>;
  adobe: HostDiscovery[];
}

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

export type AdobeConnection = { ok: true; client: HostClient; endpoint: HostEndpoint } | { ok: false; discovery: HostDiscovery };

const PORTABLE_HOW =
  "This server edits the project file itself whenever the Zenvi desktop app does not have it open.";
const DESKTOP_HOW =
  "Not running. launch_editor (or `zenvi open`) starts it on this session's project; handoff tools open it themselves. Get Zenvi at https://zenvi.pro/download.";

function toolCount(host: HostId): number {
  return catalogFor(host).length;
}

function iso(ms: number | undefined): string | undefined {
  return ms === undefined || !Number.isFinite(ms) ? undefined : new Date(ms).toISOString();
}

/** How a person connects an Adobe app, for refusals and list_hosts. */
export function howToConnect(host: HostId, discovery?: Pick<HostDiscovery, "status" | "detail">): string {
  const app = APP_LABEL[host];
  const open = `Open ${app}: Zenvi Link starts with it (its panel is Window > Extensions > Zenvi Link).`;
  const install = `If Zenvi Link is not installed, run \`zenvi adobe install\` and restart ${app}; \`zenvi adobe doctor\` shows what is missing.`;
  switch (discovery?.status) {
    case "dead":
      return `${app} quit or crashed (its Zenvi Link file was left behind). ${open}`;
    case "unreachable":
      return `${app} is running but Zenvi Link did not answer. Open Window > Extensions > Zenvi Link to restart it, or restart ${app}. ${install}`;
    case "invalid":
      return `${discovery.detail}. ${open} ${install}`;
    default:
      return `${open} ${install}`;
  }
}

export class HostRegistry {
  private snapshotCache: Cached<Snapshot> | undefined;
  private familiesCache: Cached<FamilyDecisions> | undefined;
  private readonly clients = new Map<HostId, { key: string; client: HostClient; endpoint: HostEndpoint; tools?: Promise<HostToolInfo[]> }>();
  private readonly desktopCalls = new Map<string, number>();
  private readonly detect: DetectDeps;
  private readonly cacheMs: number;

  constructor(private readonly options: HostRegistryOptions) {
    this.detect = options.detect ?? defaultDetectDeps(options.config.home, options.env);
    this.cacheMs = options.cacheMs ?? 2000;
  }

  get desktopDir(): string {
    return this.options.config.desktopDir;
  }

  /** Forget the cached discovery (after launching an app, for example). */
  invalidate(): void {
    this.snapshotCache = undefined;
    this.familiesCache = undefined;
  }

  private cached<T>(slot: "snapshotCache" | "familiesCache", make: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this[slot] as Cached<T> | undefined;
    if (hit && now - hit.at <= this.cacheMs) return hit.value;
    const value = make();
    (this[slot] as Cached<T> | undefined) = { at: now, value };
    value.catch(() => {
      if ((this[slot] as Cached<T> | undefined)?.value === value) this[slot] = undefined;
    });
    return value;
  }

  private snapshot(): Promise<Snapshot> {
    return this.cached("snapshotCache", async () => {
      const [desktop, adobe] = await Promise.all([
        discoverDesktop(this.options.config, { clientVersion: this.options.clientVersion }),
        inspectHosts(this.desktopDir, { removeStale: true, clientVersion: this.options.clientVersion }),
      ]);
      const desktopTouched = new Map<string, number>();
      for (const endpoint of desktop) {
        const info = await stat(endpoint.source).catch(() => undefined);
        if (info) desktopTouched.set(endpoint.source, info.mtimeMs);
      }
      return { desktop, desktopTouched, adobe };
    });
  }

  /** Which Adobe tool families the MCP server lists right now (file checks only, no network). */
  families(): Promise<FamilyDecisions> {
    return this.cached("familiesCache", () => decideFamilies(this.desktopDir, this.detect));
  }

  /** Record a call the MCP server sent to a desktop endpoint (it counts as activity). */
  noteDesktopCall(endpoint: Pick<DesktopEndpoint, "source">): void {
    this.desktopCalls.set(endpoint.source, Date.now());
  }

  async list(): Promise<HostsReport> {
    const [snap, families] = await Promise.all([this.snapshot(), this.families()]);
    const portable = this.options.portable?.() ?? { project: null };
    const hosts: HostEntry[] = [];
    const stamps = new Map<HostKey, number>();

    const gui = snap.desktop.find((e) => e.kind !== "headless") ?? snap.desktop[0];
    if (gui) {
      const touched = Math.max(snap.desktopTouched.get(gui.source) ?? 0, this.desktopCalls.get(gui.source) ?? 0);
      if (touched > 0) stamps.set("zenvi-desktop", touched);
      hosts.push({
        id: "zenvi-desktop",
        kind: "zenvi",
        label: "Zenvi desktop app",
        connected: true,
        active: false,
        project: gui.project ?? null,
        version: gui.version ?? null,
        pid: gui.pid ?? null,
        ...(gui.kind === "headless" ? { headless: true } : {}),
        ...(touched > 0 ? { last_active_at: iso(touched) } : {}),
      });
    } else {
      hosts.push({ id: "zenvi-desktop", kind: "zenvi", label: "Zenvi desktop app", connected: false, active: false, how_to_connect: DESKTOP_HOW });
    }

    let routesToDesktop = false;
    // ZENVI_MCP_ENGINE=portable: the server never forwards to the desktop app.
    if (portable.project && this.options.env.ZENVI_MCP_ENGINE !== "portable") {
      for (const endpoint of snap.desktop) {
        if (await hasProjectOpen(endpoint, portable.project)) {
          routesToDesktop = true;
          break;
        }
      }
    }
    // While the desktop has the project open the portable engine only forwards; it is never the active host then.
    if (portable.lastCallAt !== undefined && !routesToDesktop) stamps.set("zenvi-portable", portable.lastCallAt);
    hosts.push({
      id: "zenvi-portable",
      kind: "zenvi",
      label: "Portable Zenvi engine",
      connected: true,
      active: false,
      project: portable.project,
      ...(portable.lastCallAt !== undefined ? { last_active_at: iso(portable.lastCallAt) } : {}),
      ...(routesToDesktop ? { routes_to: "zenvi-desktop", note: "The desktop app has this project open: Zenvi tools run there." } : { note: PORTABLE_HOW }),
    });

    for (const host of HOST_IDS) {
      const id = ADOBE_HOST_KEY[host];
      const found = snap.adobe.find((d) => d.host === host);
      const family = families[host];
      const listing = { tools: toolCount(host), tools_listed: family.listed, ...(family.enable ? { enable_hint: family.enable } : {}) };
      const endpoint = found?.endpoint;
      if (endpoint) {
        const last = Date.parse(endpoint.lastActiveAt || endpoint.startedAt);
        if (Number.isFinite(last)) stamps.set(id, last);
        hosts.push({
          id,
          kind: host,
          label: APP_LABEL[host],
          connected: true,
          active: false,
          app_name: endpoint.appName || null,
          app_version: endpoint.appVersion || null,
          project: endpoint.project,
          pid: endpoint.pid,
          version: endpoint.version || null,
          ...(endpoint.lastActiveAt ? { last_active_at: endpoint.lastActiveAt } : {}),
          ...listing,
          ...(endpoint.version && endpoint.version !== LINK_VERSION
            ? { update_hint: `Zenvi Link ${endpoint.version} is running; this zenvi ships ${LINK_VERSION}. Run \`zenvi adobe install\` and restart ${APP_LABEL[host]} to match.` }
            : {}),
        });
      } else {
        hosts.push({
          id,
          kind: host,
          label: APP_LABEL[host],
          connected: false,
          active: false,
          status: found?.status ?? "absent",
          reason: found?.detail ?? "no discovery file",
          install_hint: "zenvi adobe install",
          how_to_connect: howToConnect(host, found),
          ...listing,
        });
      }
    }

    let active: HostKey = "zenvi-portable";
    let best = -Infinity;
    for (const entry of hosts) {
      const stamp = stamps.get(entry.id);
      if (entry.connected && stamp !== undefined && stamp > best) {
        best = stamp;
        active = entry.id;
      }
    }
    for (const entry of hosts) entry.active = entry.id === active;
    return { hosts, active };
  }

  /**
   * A client for a connected Adobe app. The cached client is reused while the
   * discovery file names the same server (url, pid, start time) and its
   * process lives; otherwise the file is checked again (one initialize).
   */
  async connect(host: HostId): Promise<AdobeConnection> {
    const file = path.join(linkDirOf(this.desktopDir), `${host}.json`);
    const cached = this.clients.get(host);
    if (cached) {
      const raw = await readFile(file, "utf8").catch(() => "");
      let key = "";
      try {
        const data = JSON.parse(raw) as { url?: unknown; pid?: unknown; started_at?: unknown };
        key = `${String(data.url)}|${String(data.pid)}|${String(data.started_at)}`;
      } catch {
        key = "";
      }
      if (key === cached.key && pidAlive(cached.endpoint.pid)) return { ok: true, client: cached.client, endpoint: cached.endpoint };
      await this.dropClient(host);
    }
    const discovery = await inspectHost(this.desktopDir, host, { removeStale: true, clientVersion: this.options.clientVersion });
    if (!discovery.endpoint) return { ok: false, discovery };
    const endpoint = discovery.endpoint;
    const client = new HostClient(endpoint, this.options.clientVersion);
    this.clients.set(host, { key: `${endpoint.url}|${endpoint.pid}|${endpoint.startedAt}`, client, endpoint });
    return { ok: true, client, endpoint };
  }

  /** The connected app's own tools/list (read once per server instance). */
  async liveTools(host: HostId): Promise<HostToolInfo[] | undefined> {
    const connection = await this.connect(host);
    if (!connection.ok) return undefined;
    const entry = this.clients.get(host);
    if (!entry) return undefined;
    entry.tools ??= connection.client.listTools();
    try {
      return await entry.tools;
    } catch (error) {
      entry.tools = undefined;
      throw error;
    }
  }

  /** Forget an app's client (after a transport failure). */
  async dropClient(host: HostId): Promise<void> {
    const cached = this.clients.get(host);
    this.clients.delete(host);
    this.invalidate();
    await cached?.client.close();
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((host) => this.dropClient(host)));
  }
}

/** One line per host, for receipts and `zenvi hosts`. */
export function describeHosts(report: HostsReport): string {
  const name = (entry: HostEntry): string => {
    const project = typeof entry.project === "string" && entry.project ? ` (${path.basename(entry.project)})` : "";
    const version = typeof entry.app_version === "string" && entry.app_version ? ` ${entry.app_version}` : "";
    return `${entry.label}${version}${project}`;
  };
  const connected = report.hosts.filter((h) => h.connected);
  const missing = report.hosts.filter((h) => !h.connected);
  const active = report.hosts.find((h) => h.active);
  const parts = [`Active: ${active ? name(active) : report.active}.`, `Connected: ${connected.map(name).join(", ")}.`];
  if (missing.length) {
    parts.push(
      `Not connected: ${missing
        .map((h) => (h.kind === "zenvi" ? `${h.label} (launch_editor starts it)` : `${h.label} (${h.status === "absent" ? "not running with Zenvi Link" : String(h.status)})`))
        .join(", ")}.`,
    );
  }
  const hidden = report.hosts.filter((h) => h.kind !== "zenvi" && h.tools_listed === false);
  if (hidden.length) parts.push(`Not listed: ${hidden.map((h) => `${h.label} tools (${String(h.enable_hint ?? "")})`).join(" ")}`);
  return parts.join(" ");
}
