"use strict";

/**
 * The Zenvi Link panel's logic without the DOM (tested under Node): finding
 * a live server for this app, talking JSON-RPC to it and to the Zenvi
 * desktop over Node's http (a browser fetch would carry an Origin header,
 * which the servers refuse), the copy-paste MCP config, and skin colours.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { linkDir, readJson } = require("../server/discovery");

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function isLoopback(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch (_error) {
    return false;
  }
}

function readToken(file) {
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch (_error) {
    return null;
  }
}

/** The JSON-RPC message in a response body: plain JSON, or the last SSE `data:` line. */
function parseRpcBody(text) {
  const trimmed = String(text).trim();
  if (trimmed.charAt(0) === "{") return JSON.parse(trimmed);
  const data = trimmed.split(/\r?\n/).filter((line) => line.indexOf("data:") === 0);
  if (!data.length) throw new Error("not a JSON-RPC response");
  return JSON.parse(data[data.length - 1].slice(5).trim());
}

/** One JSON-RPC request; resolves with the message ({result} or {error}); rejects on transport failure or timeout. */
function rpc(url, token, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: method, params: params || {} });
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode !== 200) {
            reject(new Error("HTTP " + response.statusCode + ": " + text.slice(0, 200)));
            return;
          }
          try {
            resolve(parseRpcBody(text));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(timeoutMs || 1500, () => request.destroy(new Error("timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

/** tools/call on a server; resolves {receipt, images, isError}. */
async function callTool(url, token, name, args, timeoutMs) {
  const message = await rpc(url, token, "tools/call", { name: name, arguments: args || {} }, timeoutMs || 130000);
  if (message.error) throw new Error(message.error.message);
  const result = message.result || {};
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.filter((block) => block.type === "text").map((block) => block.text)[0] || "";
  let receipt = result.structuredContent || null;
  if (!receipt) {
    try {
      receipt = JSON.parse(text);
    } catch (_error) {
      receipt = null;
    }
  }
  return { receipt: receipt, text: text, images: content.filter((block) => block.type === "image"), isError: Boolean(result.isError) };
}

/**
 * This app's live Zenvi Link server from its discovery file: pid alive,
 * loopback URL, token readable, same app version (another installed version
 * of the app may have written it), one initialize answered in time.
 */
async function findLiveEndpoint(options) {
  const dir = options.dir || linkDir(options.home);
  const info = readJson(path.join(dir, options.host + ".json"));
  if (!info || typeof info.url !== "string" || !isLoopback(info.url) || !pidAlive(info.pid)) return null;
  if (options.appVersion && info.app_version && info.app_version !== options.appVersion) return null;
  const token = readToken(info.token_file);
  if (!token) return null;
  try {
    const reply = await rpc(info.url, token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "zenvi-link-panel", version: "1" },
    }, options.timeoutMs || 1500);
    return reply.result ? Object.assign({}, info, { token: token }) : null;
  } catch (_error) {
    return null;
  }
}

/** The Zenvi desktop app from `~/.openshot_qt/gui_mcp.json`: {running, pid?, project?, url?, token?}. */
function desktopStatus(home) {
  const dir = path.join(home || os.homedir(), ".openshot_qt");
  const info = readJson(path.join(dir, "gui_mcp.json"));
  if (!info || !pidAlive(Number(info.pid))) return { running: false };
  const tokenFile = typeof info.token_file === "string" && info.token_file
    ? (path.isAbsolute(info.token_file) ? info.token_file : path.join(dir, info.token_file))
    : path.join(dir, "mcp_token");
  return {
    running: true,
    pid: Number(info.pid),
    project: typeof info.project === "string" ? info.project : null,
    url: typeof info.url === "string" && isLoopback(info.url) ? info.url : null,
    token: readToken(tokenFile),
  };
}

/** Copy-paste config for an MCP client: a `claude mcp add` line and a JSON snippet. */
function mcpConfig(host, url, token) {
  const name = "zenvi-" + host;
  const claude = "claude mcp add --transport http " + name + " " + url + ' --header "Authorization: Bearer ' + token + '"';
  const json = JSON.stringify({ mcpServers: { [name]: { type: "http", url: url, headers: { Authorization: "Bearer " + token } } } }, null, 2);
  return { name: name, claude: claude, json: json };
}

function hex(color) {
  const part = (value) => ("0" + Math.max(0, Math.min(255, Math.round(value))).toString(16)).slice(-2);
  return "#" + part(color.red) + part(color.green) + part(color.blue);
}

function mix(a, b, amount) {
  return { red: a.red + (b.red - a.red) * amount, green: a.green + (b.green - a.green) * amount, blue: a.blue + (b.blue - a.blue) * amount };
}

/** CSS custom properties that follow the host's panel colour (CEP appSkinInfo). */
function skinVariables(skin) {
  const background = (skin && skin.panelBackgroundColor && skin.panelBackgroundColor.color) || { red: 35, green: 35, blue: 35 };
  const luminance = (0.2126 * background.red + 0.7152 * background.green + 0.0722 * background.blue) / 255;
  const dark = luminance < 0.5;
  const ink = dark ? { red: 222, green: 222, blue: 222 } : { red: 28, green: 28, blue: 28 };
  return {
    "--bg": hex(background),
    "--fg": hex(ink),
    "--muted": hex(mix(background, ink, 0.6)),
    "--line": hex(mix(background, ink, 0.18)),
    "--field": hex(mix(background, dark ? { red: 0, green: 0, blue: 0 } : { red: 255, green: 255, blue: 255 }, 0.35)),
    "--font": (skin && skin.baseFontFamily) || "system-ui, sans-serif",
    "--font-size": ((skin && skin.baseFontSize) || 11) + "px",
  };
}

/** "21:05:12" for an ISO time. */
function clock(iso) {
  const date = new Date(iso);
  const two = (n) => ("0" + n).slice(-2);
  return two(date.getHours()) + ":" + two(date.getMinutes()) + ":" + two(date.getSeconds());
}

module.exports = { rpc, callTool, parseRpcBody, findLiveEndpoint, desktopStatus, mcpConfig, skinVariables, clock, pidAlive, isLoopback };
