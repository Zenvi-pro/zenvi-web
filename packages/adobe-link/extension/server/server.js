"use strict";

/**
 * Zenvi Link host server (SPEC 3.2): a loopback MCP server, Streamable HTTP
 * with JSON responses, stateless, bearer token. Plain CommonJS for CEP's
 * embedded Node (ES2017, no dependencies).
 *
 *   POST /mcp  JSON-RPC: initialize, notifications/*, ping, tools/list, tools/call
 *   GET/DELETE 405; Origin header or foreign Host 403; bad token 401
 *
 * tools/call validates the arguments against the catalog schema (filling
 * defaults), then runs `ZenviLink.dispatch(name, argsJson)` through the
 * bridge's evalScript, one call at a time (queue.js). Receipts come back as
 * text + structuredContent; a frame capture's `data.image_path` becomes an
 * image content block.
 */

const nodeCrypto = require("crypto");
const EventEmitter = require("events");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const util = require("util");
const { makeDir } = require("./discovery");
const { CallQueue } = require("./queue");
const { validateArguments } = require("./schema");

const readFile = util.promisify(fs.readFile);
const unlink = util.promisify(fs.unlink);
const openFile = util.promisify(fs.open);
const readBytes = util.promisify(fs.read);
const fstat = util.promisify(fs.fstat);
const closeFile = util.promisify(fs.close);
// realpath.native resolves Windows 8.3 short names; Node 8 lacks it.
const realpath = util.promisify(fs.realpath.native || fs.realpath);

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const BODY_LIMIT = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const RECENT_CALLS = 30;
/** Frame captures larger than this are not sent (a 4K PNG is ~10-25 MB). */
const IMAGE_LIMIT = 32 * 1024 * 1024;
/** Zenvi Link's own folder in the system temp folder: frame captures go here and are deleted once sent. */
const TEMP_FOLDER = "zenvi-link";
const APP_LABEL = { aftereffects: "After Effects", premiere: "Premiere Pro" };
const STATE_TOOL = { aftereffects: "ae_get_state", premiere: "premiere_get_state" };

/** A string literal for evalScript source: JSON with every non-ASCII character escaped. */
function scriptLiteral(text) {
  return JSON.stringify(String(text)).replace(/[\u007f-\uffff]/g, (c) => "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4));
}

/** The ExtendScript a tool call evaluates. */
function dispatchScript(name, args) {
  return "ZenviLink.dispatch(" + scriptLiteral(name) + ", " + scriptLiteral(JSON.stringify(args)) + ")";
}

/** A refused/error receipt made by the server itself (same shape as the host's). */
function failureReceipt(host, tool, status, code, message) {
  const text = String(message).replace(/^Error: /, "");
  return {
    contract: 3,
    status: status,
    tool: tool,
    host: host,
    summary: "Error: " + text,
    data: {},
    warnings: [],
    undoSteps: 0,
    error: { code: code, message: text },
  };
}

function seconds(ms) {
  return Math.round(ms / 100) / 10 + " s";
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code: code, message: message } };
}

function sendJson(res, status, body, headers) {
  const text = JSON.stringify(body);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" }, headers || {}));
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (declared > limit) {
      reject(Object.assign(new Error("Request body is larger than " + limit + " bytes"), { status: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(Object.assign(new Error("Request body is larger than " + limit + " bytes"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!failed) reject(error);
    });
  });
}

function sameToken(header, token) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header || "");
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && nodeCrypto.timingSafeEqual(given, expected);
}

function imageMimeType(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** True when `file` is in `dir` (or below), comparing real paths; case-insensitive where the file system usually is. */
async function insideDir(file, dir) {
  try {
    let parent = await realpath(path.dirname(file));
    let root = await realpath(dir);
    if (process.platform === "win32" || process.platform === "darwin") {
      parent = parent.toLowerCase();
      root = root.toLowerCase();
    }
    return parent === root || parent.indexOf(root + path.sep) === 0;
  } catch (_error) {
    return false;
  }
}

/** The first `length` bytes and the size of a file. */
async function readHead(file, length) {
  const fd = await openFile(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await readBytes(fd, buffer, 0, length, 0);
    const stats = await fstat(fd);
    return { bytes: buffer.slice(0, typeof result === "number" ? result : result.bytesRead), size: stats.size };
  } finally {
    await closeFile(fd).catch(() => undefined);
  }
}

/**
 * options: {
 *   host: "aftereffects" | "premiere", catalog: {version, tools}, bridge: {evalScript(script) -> Promise<string>},
 *   appName?, appVersion?, token?, busyAfterMs?, tempDir? (system temp), imageLimit?, bodyLimit?,
 *   log?(line), onActivity?()
 * }
 */
function createLinkServer(options) {
  const host = options.host;
  const label = APP_LABEL[host];
  if (!label) throw new Error("Zenvi Link: unknown host " + host);
  const catalog = options.catalog;
  const bridge = options.bridge;
  const version = catalog.version;
  const token = options.token || nodeCrypto.randomBytes(32).toString("hex");
  const tempDir = path.join(options.tempDir || os.tmpdir(), TEMP_FOLDER);
  const imageLimit = options.imageLimit || IMAGE_LIMIT;
  const bodyLimit = options.bodyLimit || BODY_LIMIT;
  const log = options.log || (() => undefined);
  const onActivity = options.onActivity || (() => undefined);
  const tools = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  const queue = new CallQueue({ busyAfterMs: options.busyAfterMs });
  const events = new EventEmitter();
  const recent = [];
  const sockets = new Set();
  let server = null;
  let port = 0;

  const url = () => "http://127.0.0.1:" + port + "/mcp";

  function instructions() {
    return (
      "Zenvi Link for " + label + ": these tools act on the " + label + " instance on this computer, one call at a time. " +
      "Call " + STATE_TOOL[host] + " first and again after the user edits by hand. Each mutating call is one undo step " +
      (host === "aftereffects" ? "(one undo group)" : "where Premiere allows it (each DOM change is its own step)") +
      ". Times are seconds, snapped to the frame grid (warnings say when). Receipts are JSON: status applied | unchanged | ok | refused | error; " +
      "refused means nothing changed, read error.message and fix the arguments. Omitted arguments take tasteful defaults " +
      "(entrances 0.6 s, exits 0.4 s, smooth easing, text inside title-safe). Look before you say done: capture frames and check them."
    );
  }

  function listedTools() {
    return catalog.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: Object.assign({ title: tool.title }, tool.annotations),
    }));
  }

  function receiptFromOutcome(tool, outcome) {
    const name = tool.name;
    switch (outcome.kind) {
      case "done": {
        let receipt = null;
        try {
          receipt = JSON.parse(outcome.value);
        } catch (_error) {
          receipt = null;
        }
        if (!receipt || receipt.contract !== 3 || typeof receipt.status !== "string") {
          const got = String(outcome.value).slice(0, 200);
          return failureReceipt(host, name, "error", "HOST_ERROR",
            "the Zenvi Link host script did not answer (got: " + JSON.stringify(got) + "). Reload Zenvi Link (Window > Extensions > Zenvi Link) or restart " + label + ".");
        }
        if (!Array.isArray(receipt.warnings)) receipt.warnings = [];
        if (!receipt.data || typeof receipt.data !== "object") receipt.data = {};
        return receipt;
      }
      case "error":
        return failureReceipt(host, name, "error", "HOST_ERROR", "evalScript failed: " + (outcome.error && outcome.error.message ? outcome.error.message : String(outcome.error)));
      case "timeout":
        return failureReceipt(host, name, "error", "TIMEOUT",
          name + " did not finish within " + seconds(tool.timeoutMs || DEFAULT_TIMEOUT_MS) + ". It may still be running in " + label +
          " and may still change the project; Zenvi Link runs nothing else until it returns. Check with " + STATE_TOOL[host] + " in a moment.");
      case "busy":
        return failureReceipt(host, name, "refused", "BUSY",
          label + " has been busy with " + outcome.running.label + " for " + seconds(outcome.running.ms) + "; nothing ran. " +
          "Try again when it finishes, or check whether " + label + " shows a dialog.");
      default:
        return failureReceipt(host, name, "refused", "BUSY",
          "waited " + seconds(outcome.ms) + (outcome.running ? " behind " + outcome.running.label : "") + " without starting; nothing ran. Try again shortly.");
    }
  }

  /**
   * A frame capture as an image block. `image_path` is always dropped from the
   * receipt. The file is checked (PNG/JPEG magic bytes, size cap) before it is
   * read, and deleted only when it is in Zenvi Link's temp folder.
   */
  async function takeImage(tool, receipt) {
    const data = receipt.data;
    if (!tool.returnsImage || typeof data.image_path !== "string") return [];
    const file = data.image_path;
    delete data.image_path;
    const ours = await insideDir(file, tempDir);
    try {
      const head = await readHead(file, 16);
      const mimeType = imageMimeType(head.bytes);
      if (!mimeType) {
        receipt.warnings.push("The captured frame is not a PNG or JPEG image: " + file);
        return [];
      }
      if (head.size > imageLimit) {
        receipt.warnings.push("The captured frame is " + Math.round(head.size / 1048576) + " MB, over the " + Math.round(imageLimit / 1048576) + " MB limit; capture a smaller size");
        return [];
      }
      const bytes = await readFile(file);
      return [{ type: "image", data: bytes.toString("base64"), mimeType: mimeType }];
    } catch (error) {
      receipt.warnings.push("Could not read the captured frame " + file + ": " + error.message);
      return [];
    } finally {
      if (ours) await unlink(file).catch(() => undefined);
    }
  }

  /** Validate, queue, dispatch; returns {receipt, images}. Never throws. */
  async function callTool(name, rawArgs) {
    const started = Date.now();
    const tool = tools.get(name);
    let receipt;
    let images = [];
    try {
      onActivity();
    } catch (error) {
      // Discovery refreshes are best effort; they never fail a call.
      log("activity hook failed: " + (error && error.message ? error.message : error));
    }
    if (!tool) {
      receipt = failureReceipt(host, name, "refused", "NOT_FOUND", "Unknown tool " + name);
    } else {
      const checked = validateArguments(tool.inputSchema, rawArgs);
      if (!checked.ok) {
        receipt = failureReceipt(host, name, "refused", "INVALID_ARGUMENT", "Invalid arguments for " + name + ": " + checked.message);
      } else {
        const outcome = await queue.run(name, tool.timeoutMs || DEFAULT_TIMEOUT_MS, () => bridge.evalScript(dispatchScript(name, checked.args)));
        receipt = receiptFromOutcome(tool, outcome);
        images = await takeImage(tool, receipt);
      }
    }
    const call = { tool: name, status: receipt.status, summary: receipt.summary, ms: Date.now() - started, at: new Date().toISOString() };
    recent.unshift(call);
    recent.length = Math.min(recent.length, RECENT_CALLS);
    log(name + " -> " + receipt.status + " (" + call.ms + " ms)");
    events.emit("call", call);
    return { receipt: receipt, images: images };
  }

  /** Evaluate a host-script expression through the queue (status probes); null when busy or failing. */
  async function evalWhenIdle(script, timeoutMs) {
    if (!queue.idle) return null;
    const outcome = await queue.run("(status)", timeoutMs || 5000, () => bridge.evalScript(script));
    return outcome.kind === "done" ? outcome.value : null;
  }

  async function respond(message) {
    const params = message.params || {};
    switch (message.method) {
      case "initialize":
        return {
          result: {
            protocolVersion: PROTOCOL_VERSIONS.indexOf(params.protocolVersion) >= 0 ? params.protocolVersion : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "zenvi-link-" + host, title: "Zenvi Link for " + label, version: version },
            instructions: instructions(),
          },
        };
      case "ping":
        return { result: {} };
      case "tools/list":
        return { result: { tools: listedTools() } };
      case "tools/call": {
        if (typeof params.name !== "string") return { error: { code: -32602, message: "tools/call needs params.name" } };
        if (!tools.has(params.name)) return { error: { code: -32602, message: "Unknown tool: " + params.name } };
        const outcome = await callTool(params.name, params.arguments);
        const receipt = outcome.receipt;
        return {
          result: {
            content: [{ type: "text", text: JSON.stringify(receipt) }].concat(outcome.images),
            structuredContent: receipt,
            isError: receipt.status === "error" || receipt.status === "refused",
          },
        };
      }
      default:
        return { error: { code: -32601, message: "Method not found: " + message.method } };
    }
  }

  async function handle(req, res) {
    // DNS rebinding / CSRF: only loopback Host headers, never browser (Origin) requests.
    const hostHeader = String(req.headers.host || "").toLowerCase();
    if (hostHeader !== "127.0.0.1:" + port && hostHeader !== "localhost:" + port) {
      sendJson(res, 403, rpcError(null, -32600, "Forbidden: Host must be 127.0.0.1:" + port + " or localhost:" + port));
      return;
    }
    if (req.headers.origin !== undefined) {
      sendJson(res, 403, rpcError(null, -32600, "Forbidden: requests with an Origin header are not accepted"));
      return;
    }
    if (!sameToken(req.headers.authorization, token)) {
      sendJson(res, 401, rpcError(null, -32001, "Unauthorized: send Authorization: Bearer <token from the token_file>"), { "WWW-Authenticate": 'Bearer realm="zenvi-link"' });
      return;
    }
    if (String(req.url || "").split("?")[0] !== "/mcp") {
      sendJson(res, 404, rpcError(null, -32600, "Not found: the endpoint is /mcp"));
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, rpcError(null, -32600, "Method not allowed: POST JSON-RPC to /mcp"), { Allow: "POST" });
      return;
    }
    let body;
    try {
      body = await readBody(req, bodyLimit);
    } catch (error) {
      sendJson(res, error.status || 400, rpcError(null, -32600, error.message), { Connection: "close" });
      return;
    }
    let message;
    try {
      message = JSON.parse(body);
    } catch (_error) {
      sendJson(res, 400, rpcError(null, -32700, "Parse error: the body is not JSON"));
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
      sendJson(res, 400, rpcError(null, -32600, "Invalid Request: send one JSON-RPC 2.0 message"));
      return;
    }
    if (typeof message.method !== "string") {
      // A response to a server request (this server sends none): accept it.
      res.writeHead(202);
      res.end();
      return;
    }
    if (message.id === undefined || message.id === null) {
      // Notification (notifications/initialized, cancelled, ...): nothing to answer.
      res.writeHead(202);
      res.end();
      return;
    }
    const reply = await respond(message);
    sendJson(res, 200, Object.assign({ jsonrpc: "2.0", id: message.id }, reply));
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
          log("request failed: " + (error && error.stack ? error.stack : error));
          if (!res.headersSent) sendJson(res, 500, rpcError(null, -32603, "Internal error"));
          else res.end();
        });
      });
      // Node 12 (CEP 10: After Effects 18.0-18.3, Premiere Pro 15.0-15.3) closes
      // sockets idle for 120 s by default, which drops the response of a long
      // call. Calls are bounded by the queue's own timeouts instead.
      server.timeout = 0;
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      server.once("error", reject);
      try {
        makeDir(tempDir, 0o700);
      } catch (error) {
        log("could not create " + tempDir + ": " + error.message);
      }
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        log("Zenvi Link for " + label + " listening on " + url());
        resolve({ url: url(), port: port, token: token });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      const closing = server;
      server = null;
      closing.close(() => resolve());
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    });
  }

  return {
    start: start,
    stop: stop,
    callTool: callTool,
    evalWhenIdle: evalWhenIdle,
    on: (event, listener) => events.on(event, listener),
    off: (event, listener) => events.removeListener(event, listener),
    get url() {
      return url();
    },
    get port() {
      return port;
    },
    token: token,
    host: host,
    version: version,
    /** Zenvi Link's temp folder; the boot passes it to the host script (ZenviLink.tempDir()). */
    tempDir: tempDir,
    queue: queue,
    recentCalls: () => recent.slice(),
  };
}

module.exports = { createLinkServer, dispatchScript, scriptLiteral, insideDir, PROTOCOL_VERSIONS, DEFAULT_TIMEOUT_MS, TEMP_FOLDER };
