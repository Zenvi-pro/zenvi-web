"use strict";

/**
 * Discovery and token files (SPEC 3.1): `<home>/.openshot_qt/link/<app>.json`
 * plus one token file per instance, `<app>.<pid>.token` (0600).
 *
 * Several instances can serve one app at once: the background service and a
 * panel fallback, or two installed versions of the app. The newest instance
 * to publish owns the discovery file. The others leave it alone while the
 * owner's process lives, and take it back once the owner's pid is dead or the
 * file is gone. Every write puts the instance's own token file in place before
 * the JSON that points at it. An instance removes only its own token file, and
 * the discovery file only while that file still names it.
 *
 * Writes are best effort and never throw: a discovery refresh must not fail a
 * tool call. When Windows refuses a rename because a reader (the Zenvi
 * desktop, the CLI) has the file open, the rename is retried with backoff.
 * Any other failure is logged and reported through `problem`.
 */

const nodeCrypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// fs is looked up at call time (not promisified once) so tests can simulate refusals.
function call(method, args) {
  return new Promise((resolve, reject) => {
    fs[method].apply(fs, args.concat([(error) => (error ? reject(error) : resolve())]));
  });
}
const writeFile = (file, text, options) => call("writeFile", [file, text, options]);
const rename = (from, to) => call("rename", [from, to]);
const unlink = (file) => call("unlink", [file]);

/** Keys of the discovery file, in order (exactly these; SPEC 3.1). */
const DISCOVERY_KEYS = ["url", "token_file", "pid", "project", "version", "app", "app_name", "app_version", "protocol", "started_at", "last_active_at"];

const PROTOCOL = 1;

/** Waits between rename attempts Windows refused (EPERM / EACCES / EBUSY). */
const RENAME_RETRY_MS = [25, 75, 200, 500];

/** `<home>/.openshot_qt/link` (Windows: %USERPROFILE%\.openshot_qt\link). */
function linkDir(home) {
  return path.join(home || os.homedir(), ".openshot_qt", "link");
}

/** mkdir -p (CEP's Node may predate the `recursive` option). */
function makeDir(dir, mode) {
  if (fs.existsSync(dir)) return;
  makeDir(path.dirname(dir), mode);
  try {
    fs.mkdirSync(dir, mode);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Write via a temp file in the same folder, then rename over the target. */
async function writeAtomic(file, text, mode) {
  const temp = file + "." + process.pid + "." + nodeCrypto.randomBytes(4).toString("hex") + ".tmp";
  await writeFile(temp, text, { mode: mode });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      const refusedForNow = error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY";
      if (!refusedForNow || attempt >= RENAME_RETRY_MS.length) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
      await delay(RENAME_RETRY_MS[attempt]);
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_error) {
    return null;
  }
}

class DiscoveryFile {
  /** options: {host, dir?, pid?, now?, minIntervalMs?, log?, isAlive?(pid)} */
  constructor(options) {
    this.host = options.host;
    this.dir = options.dir || linkDir();
    this.pid = options.pid || process.pid;
    this.file = path.join(this.dir, this.host + ".json");
    this.tokenFile = path.join(this.dir, this.host + "." + this.pid + ".token");
    this.now = options.now || (() => new Date());
    this.minIntervalMs = options.minIntervalMs !== undefined ? options.minIntervalMs : 1000;
    this.log = options.log || (() => undefined);
    this.isAlive = options.isAlive || pidAlive;
    this.info = null;
    this.token = null;
    this.removed = false;
    this.lastWrite = 0;
    this.pending = null;
    this.queue = Promise.resolve();
    /** The last write failure, or null. */
    this.problem = null;
  }

  /** "self", "other" (another live instance owns the file) or "none" (no file, unreadable, or its pid is dead). */
  owner() {
    const onDisk = readJson(this.file);
    if (!onDisk || typeof onDisk !== "object" || Array.isArray(onDisk)) return "none";
    if (onDisk.pid === this.pid) return "self";
    return this.isAlive(Number(onDisk.pid)) ? "other" : "none";
  }

  /**
   * Publish this instance: token file, then the discovery file. The newest
   * instance wins, except with `yieldToLive` (the panel fallback): a live
   * owner then keeps the file. Resolves "written", "yielded" or "failed".
   */
  async publish(details, options) {
    if (options && options.yieldToLive && this.owner() === "other") return "yielded";
    this.token = details.token;
    const at = this.now().toISOString();
    this.info = {
      url: details.url,
      token_file: this.tokenFile,
      pid: this.pid,
      project: details.project || null,
      version: details.version,
      app: this.host,
      app_name: details.appName,
      app_version: details.appVersion,
      protocol: PROTOCOL,
      started_at: at,
      last_active_at: at,
    };
    this.removed = false;
    this.removeStaleTokens();
    return (await this.flush(true)) ? "written" : "failed";
  }

  /** Queue a write so writes never interleave; resolves true when written. `force` also overwrites a live owner. */
  flush(force) {
    const run = this.queue.then(() => this.writeNow(force));
    this.queue = run;
    return run;
  }

  async writeNow(force) {
    if (!this.info || this.removed) return false;
    if (!force && this.owner() === "other") return false;
    try {
      makeDir(this.dir, 0o700);
      await writeAtomic(this.tokenFile, this.token, 0o600);
      const ordered = {};
      for (const key of DISCOVERY_KEYS) ordered[key] = this.info[key];
      await writeAtomic(this.file, JSON.stringify(ordered, null, 2) + "\n", 0o644);
      this.lastWrite = Date.now();
      this.problem = null;
      return true;
    } catch (error) {
      this.problem = error && error.message ? error.message : String(error);
      this.log("could not write " + this.file + ": " + this.problem);
      return false;
    }
  }

  /** Record a new open project (null when untitled). Resolves true when written. */
  setProject(project) {
    if (!this.info || this.info.project === (project || null)) return Promise.resolve(false);
    this.info.project = project || null;
    return this.flush(false);
  }

  /** Refresh last_active_at (activation, tool calls): a write within minIntervalMs, off the caller's path. */
  touch() {
    if (!this.info || this.removed) return;
    this.info.last_active_at = this.now().toISOString();
    if (this.pending) return;
    const wait = Math.max(0, this.lastWrite + this.minIntervalMs - Date.now());
    this.pending = setTimeout(() => {
      this.pending = null;
      this.flush(false);
    }, wait);
    if (this.pending.unref) this.pending.unref();
  }

  /** Resolves once queued and scheduled writes are done (tests, shutdown). */
  async settled() {
    while (this.pending) await delay(5);
    await this.queue;
  }

  /**
   * Remove this instance's token file, and the discovery file while it still
   * names this pid. Synchronous: it runs on unload, where async work may never
   * finish. Returns true when the discovery file was removed.
   */
  remove() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    this.removed = true;
    this.info = null;
    let removedFile = false;
    const onDisk = readJson(this.file);
    if (onDisk && onDisk.pid === this.pid) {
      try {
        fs.unlinkSync(this.file);
        removedFile = true;
      } catch (_error) {
        // Already gone.
      }
    }
    try {
      fs.unlinkSync(this.tokenFile);
    } catch (_error) {
      // Already gone.
    }
    return removedFile;
  }

  /** Token files of this app's instances whose process is gone (a crash leaves them). */
  removeStaleTokens() {
    const pattern = new RegExp("^" + this.host + "\\.(\\d+)\\.token$");
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch (_error) {
      return;
    }
    for (const name of names) {
      const match = pattern.exec(name);
      if (!match || Number(match[1]) === this.pid || this.isAlive(Number(match[1]))) continue;
      try {
        fs.unlinkSync(path.join(this.dir, name));
      } catch (_error) {
        // Someone else removed it.
      }
    }
  }
}

module.exports = { DiscoveryFile, DISCOVERY_KEYS, PROTOCOL, linkDir, makeDir, writeAtomic, readJson, pidAlive };
