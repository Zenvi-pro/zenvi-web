/**
 * Runs extension/panel/panel.js the way CEP does (DOM + Node require in one
 * context) against a minimal fake DOM and FakeCep, with a temp HOME.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { PACKAGE_ROOT } from "./host-bundle.js";
import { createAeMock } from "./testing/ae-mock.js";
import { FakeCep, evalInHostScript } from "./testing/fake-cep.js";
import { loadHostScript } from "./testing/host-script.js";

const EXTENSION_DIR = path.join(PACKAGE_ROOT, "extension");
const PANEL_JS = readFileSync(path.join(EXTENSION_DIR, "panel", "panel.js"), "utf8");

class FakeElement {
  textContent = "";
  hidden = false;
  disabled = false;
  title = "";
  className = "";
  value = "";
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  appendChild(child: FakeElement): void {
    this.children.push(child);
  }

  removeChild(child: FakeElement): void {
    this.children.splice(this.children.indexOf(child), 1);
  }

  select(): void {}

  click(): void {
    this.listeners.get("click")?.();
  }

}

function fakeDocument() {
  const ids = ["app", "server-state", "server-url", "server-mode", "desktop-state", "notice", "copy-config", "send-to-zenvi", "action-result", "calls"];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const copied: string[] = [];
  const styles: Record<string, string> = {};
  const body = new FakeElement();
  const document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => new FakeElement(),
    documentElement: { style: { setProperty: (name: string, value: string) => (styles[name] = value) } },
    body,
    execCommand: (command: string) => {
      const area = body.children[body.children.length - 1];
      if (command === "copy" && area) copied.push(area.value);
      return true;
    },
  };
  // FakeElement's textContent setter should clear children for the calls list.
  const calls = elements.get("calls") as FakeElement;
  Object.defineProperty(calls, "textContent", {
    get: () => "",
    set: () => calls.children.splice(0),
  });
  return { document, elements, copied, styles };
}

let home: string;
let savedHome: string | undefined;
const unloads: (() => void)[] = [];

beforeEach(() => {
  savedHome = process.env.HOME;
  home = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-panel-ui-"));
  process.env.HOME = home;
});

afterEach(() => {
  for (const unload of unloads.splice(0)) unload();
  process.env.HOME = savedHome;
});

function runPanel() {
  const dom = fakeDocument();
  const mock = createAeMock({ tempDir: home });
  const cep = new FakeCep({
    appName: "AEFT",
    appVersion: "26.3.0",
    extensionDir: EXTENSION_DIR,
    evalScript: evalInHostScript(loadHostScript("aeft", mock.globals)),
    extensionId: "pro.zenvi.link.panel",
  });
  const timers: { ms: number; run: () => void }[] = [];
  const window = {
    __adobe_cep__: cep,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "unload") unloads.push(listener);
    },
  };
  const context = vm.createContext({
    window,
    document: dom.document,
    navigator: {},
    require: createRequire(path.join(EXTENSION_DIR, "panel", "panel.js")),
    console,
    process,
    Buffer,
    // Timers are collected so the test decides when "3 s later" happens.
    setTimeout: (run: () => void, ms: number) => timers.push({ ms, run }),
    setInterval: () => 0,
  });
  vm.runInContext(PANEL_JS, context, { filename: "panel.js" });
  return { ...dom, cep, timers };
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

test("starts looking for the service and follows the host skin", () => {
  const { elements, cep, styles } = runPanel();
  expect(elements.get("app")?.textContent).toBe("Adobe After Effects 2026");
  expect(elements.get("server-state")?.textContent).toBe("Looking for the Zenvi Link service\u2026");
  expect(elements.get("copy-config")?.disabled).toBe(true);
  expect(elements.get("send-to-zenvi")?.disabled).toBe(true);
  expect(elements.get("desktop-state")?.textContent).toBe("Not running");
  expect(cep.dispatched.map((event) => event.type)).toEqual(["pro.zenvi.link.status-request"]);
  expect(styles["--bg"]).toBe("#232323");
});

test("adopts the background service's status, lists calls, copies the MCP config", () => {
  const { elements, cep, copied } = runPanel();
  const tokenFile = path.join(home, "aftereffects.token");
  writeFileSync(tokenFile, "tok123");
  cep.fire("pro.zenvi.link.status", {
    mode: "service",
    host: "aftereffects",
    url: "http://127.0.0.1:53012/mcp",
    token_file: tokenFile,
    host_script: { ok: true, problem: null },
    recent: [],
  });
  expect(elements.get("server-state")?.textContent).toBe("Running");
  expect(elements.get("server-url")?.textContent).toBe("http://127.0.0.1:53012/mcp");
  expect(elements.get("server-mode")?.textContent).toBe("Background service");
  expect(elements.get("copy-config")?.disabled).toBe(false);

  cep.fire("pro.zenvi.link.call", { tool: "ae_get_state", status: "ok", summary: "x", ms: 5, at: new Date().toISOString() });
  const rows = elements.get("calls")?.children ?? [];
  expect(rows).toHaveLength(1);
  expect(rows[0]?.children.map((cell) => cell.textContent).slice(0, 2)).toEqual(["ae_get_state", "ok"]);

  elements.get("copy-config")?.click();
  expect(copied[0]).toContain('claude mcp add --transport http zenvi-aftereffects http://127.0.0.1:53012/mcp --header "Authorization: Bearer tok123"');
  expect(elements.get("action-result")?.hidden).toBe(false);
});

test("with no service after 3 s the panel runs the server itself", async () => {
  const { elements, timers } = runPanel();
  const fallback = timers.find((timer) => timer.ms === 3000);
  expect(fallback).toBeDefined();
  await tick();
  fallback?.run();
  for (let i = 0; i < 50 && elements.get("server-mode")?.textContent !== "This panel (closing it stops the server)"; i += 1) await tick(20);
  expect(elements.get("server-mode")?.textContent).toBe("This panel (closing it stops the server)");
  expect(elements.get("notice")?.textContent).toContain("this panel runs the server");
  const discovery = JSON.parse(readFileSync(path.join(home, ".openshot_qt", "link", "aftereffects.json"), "utf8"));
  expect(discovery.url).toBe(elements.get("server-url")?.textContent);
});

test("shows a running Zenvi desktop", () => {
  mkdirSync(path.join(home, ".openshot_qt"), { recursive: true });
  writeFileSync(path.join(home, ".openshot_qt", "gui_mcp.json"), JSON.stringify({ url: "http://127.0.0.1:7434/mcp", pid: process.pid, project: "/x/trip.zvn" }));
  const { elements } = runPanel();
  expect(elements.get("desktop-state")?.textContent).toBe(`Running (pid ${process.pid}), trip.zvn`);
});
