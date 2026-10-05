"use strict";

/**
 * Boots Zenvi Link inside CEP: detects the host app, starts the loopback MCP
 * server, publishes the token + discovery files, keeps `project` and
 * `last_active_at` fresh, and cleans up on quit or unload.
 *
 *   service extension (pro.zenvi.link.service, invisible): boot({cep, window, mode: "service"})
 *   panel fallback when no service answers:                 boot({cep, window, mode: "panel"})
 *
 * The other Zenvi Link extension in the same app talks to this one through
 * CSXS events: "pro.zenvi.link.status-request" -> "pro.zenvi.link.status",
 * and every finished call is broadcast as "pro.zenvi.link.call".
 */

const fs = require("fs");
const path = require("path");
const { createCepBridge } = require("./bridge");
const { DiscoveryFile, linkDir } = require("./discovery");
const { createLinkServer, scriptLiteral } = require("./server");

const HOSTS = { AEFT: "aftereffects", PPRO: "premiere" };
const PRODUCT = { aftereffects: "Adobe After Effects", premiere: "Adobe Premiere Pro" };
/** Release years before Adobe switched to year-numbered majors (22 = 2022). */
const OLD_YEARS = { aftereffects: { 16: 2019, 17: 2020, 18: 2021 }, premiere: { 13: 2019, 14: 2020, 15: 2021 } };

const EVENTS = {
  activate: "com.adobe.csxs.events.ApplicationActivate",
  beforeQuit: "com.adobe.csxs.events.ApplicationBeforeQuit",
  statusRequest: "pro.zenvi.link.status-request",
  status: "pro.zenvi.link.status",
  call: "pro.zenvi.link.call",
};

/** "Adobe After Effects 2026" for appVersion "26.3.0". */
function marketingName(host, appVersion) {
  const major = parseInt(appVersion, 10);
  const year = major >= 22 ? 2000 + major : OLD_YEARS[host][major];
  return PRODUCT[host] + (year ? " " + year : "");
}

/** The host app of a CEP host environment, or null. */
function hostOf(environment) {
  return HOSTS[environment && environment.appName] || null;
}

/**
 * options: {cep | bridge, window?, mode?: "service" | "panel", extensionDir?, home?, linkDir?, pollMs?,
 *   touchIntervalMs?, busyAfterMs?, log?}
 * Resolves with {host, server, discovery, status(), stop()}.
 */
async function boot(options) {
  const bridge = options.bridge || createCepBridge(options.cep);
  const mode = options.mode || "service";
  const log = options.log || ((line) => console.log("[Zenvi Link] " + line));
  const environment = bridge.hostEnvironment();
  const host = hostOf(environment);
  if (!host) throw new Error("Zenvi Link supports After Effects and Premiere Pro, not " + environment.appName);
  const extensionDir = options.extensionDir || bridge.systemPath("extension");
  const catalog = JSON.parse(fs.readFileSync(path.join(extensionDir, "catalog", host + ".json"), "utf8"));
  const appVersion = String(environment.appVersion || "");
  const appName = marketingName(host, appVersion);
  const discovery = new DiscoveryFile({ host: host, dir: options.linkDir || linkDir(options.home), minIntervalMs: options.touchIntervalMs });
  const server = createLinkServer({
    host: host,
    catalog: catalog,
    bridge: bridge,
    log: log,
    busyAfterMs: options.busyAfterMs,
    onActivity: () => discovery.touch(),
  });
  const startedAt = new Date().toISOString();
  let hostScript = { ok: false, problem: "not checked yet" };
  let loadedHostScript = false;
  let stopped = false;

  await server.start();

  /** The host script's view of the app (open project); null when busy or not loaded (checkHostScript says why). */
  async function readHostInfo() {
    const raw = await server.evalWhenIdle("ZenviLink.hostInfo()");
    try {
      return raw === null ? null : JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  async function checkHostScript() {
    const raw = await server.evalWhenIdle("ZenviLink.listTools()");
    if (raw === null) return;
    try {
      const registered = JSON.parse(raw).map((tool) => tool.name);
      const missing = catalog.tools.map((tool) => tool.name).filter((name) => registered.indexOf(name) < 0);
      hostScript = missing.length ? { ok: false, problem: "missing tools: " + missing.join(", ") } : { ok: true, problem: null };
    } catch (_error) {
      hostScript = { ok: false, problem: "the host script is not loaded (" + String(raw).slice(0, 80) + ")" };
    }
  }

  /**
   * CEP loads the manifest's ScriptPath when the extension starts, but that
   * can fail or race the page; then load the bundled host script directly
   * (once: later checks only look again).
   */
  async function ensureHostScript() {
    await checkHostScript();
    if (hostScript.ok || loadedHostScript) return;
    loadedHostScript = true;
    const file = path.join(extensionDir, "host", (host === "aftereffects" ? "aeft" : "ppro") + ".jsx").split(path.sep).join("/");
    log("host script problem: " + hostScript.problem + "; loading " + file);
    await server.evalWhenIdle("$.evalFile(new File(" + scriptLiteral(file) + "))", 30000);
    await checkHostScript();
    if (!hostScript.ok) log("host script still unavailable: " + hostScript.problem);
  }

  async function refreshProject() {
    if (stopped) return;
    if (!hostScript.ok) await ensureHostScript();
    const info = await readHostInfo();
    if (info && !stopped) discovery.setProject(typeof info.project === "string" && info.project ? info.project : null);
  }

  await ensureHostScript();
  const first = await readHostInfo();
  discovery.publish({
    url: server.url,
    token: server.token,
    project: first && typeof first.project === "string" ? first.project : null,
    version: catalog.version,
    appName: appName,
    appVersion: appVersion,
  });

  function status() {
    return {
      mode: mode,
      host: host,
      url: server.url,
      pid: process.pid,
      app_name: appName,
      app_version: appVersion,
      version: catalog.version,
      started_at: startedAt,
      tools: catalog.tools.length,
      host_script: hostScript,
      token_file: discovery.tokenFile,
      recent: server.recentCalls(),
    };
  }

  const onActivate = () => {
    discovery.touch();
    refreshProject();
  };
  const onStatusRequest = () => bridge.dispatchEvent(EVENTS.status, status());
  const onCall = (call) => {
    try {
      bridge.dispatchEvent(EVENTS.call, call);
    } catch (error) {
      log("could not broadcast a call: " + error.message);
    }
    refreshProject();
  };
  server.on("call", onCall);
  bridge.addEventListener(EVENTS.activate, onActivate);
  bridge.addEventListener(EVENTS.statusRequest, onStatusRequest);
  const poll = setInterval(refreshProject, options.pollMs || 15000);

  function stopNow() {
    if (stopped) return;
    stopped = true;
    clearInterval(poll);
    server.off("call", onCall);
    bridge.removeEventListener(EVENTS.activate, onActivate);
    bridge.removeEventListener(EVENTS.statusRequest, onStatusRequest);
    discovery.remove();
    server.stop();
  }

  const onQuit = () => stopNow();
  bridge.addEventListener(EVENTS.beforeQuit, onQuit);
  if (options.window) options.window.addEventListener("unload", onQuit);
  log("ready (" + mode + "): " + server.url + ", discovery " + discovery.file);

  return {
    host: host,
    server: server,
    discovery: discovery,
    status: status,
    async stop() {
      stopNow();
      bridge.removeEventListener(EVENTS.beforeQuit, onQuit);
      await server.stop();
    },
  };
}

module.exports = { boot, marketingName, hostOf, EVENTS };
