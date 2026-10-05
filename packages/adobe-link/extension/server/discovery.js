"use strict";

/**
 * Discovery and token files (SPEC 3.1): `<home>/.openshot_qt/link/<app>.json`
 * and `<app>.token`. The token (0600) is written before the discovery file
 * appears; both are written atomically (temp file + rename). The newest
 * instance of an app wins; on shutdown an instance removes the files only
 * while they still name its pid.
 */

const nodeCrypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

/** Keys of the discovery file, in order (exactly these; SPEC 3.1). */
const DISCOVERY_KEYS = ["url", "token_file", "pid", "project", "version", "app", "app_name", "app_version", "protocol", "started_at", "last_active_at"];

const PROTOCOL = 1;

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

/** Write via a temp file in the same folder, then rename over the target. */
function writeAtomic(file, text, mode) {
  const temp = file + "." + process.pid + "." + nodeCrypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(temp, text, { mode: mode });
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(temp, file);
      return;
    } catch (error) {
      // Windows refuses to replace a file another process has open for a moment.
      if (attempt >= 5 || (error.code !== "EPERM" && error.code !== "EBUSY" && error.code !== "EACCES")) {
        try {
          fs.unlinkSync(temp);
        } catch (_cleanupError) {
          // The temp file may already be gone.
        }
        throw error;
      }
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
  /** options: {host, dir?, pid?, now?, minIntervalMs?} */
  constructor(options) {
    this.host = options.host;
    this.dir = options.dir || linkDir();
    this.file = path.join(this.dir, this.host + ".json");
    this.tokenFile = path.join(this.dir, this.host + ".token");
    this.pid = options.pid || process.pid;
    this.now = options.now || (() => new Date());
    this.minIntervalMs = options.minIntervalMs !== undefined ? options.minIntervalMs : 1000;
    this.info = null;
    this.lastWrite = 0;
    this.pending = null;
  }

  /** Token file first (0600), then the discovery file. */
  publish(details) {
    makeDir(this.dir, 0o700);
    writeAtomic(this.tokenFile, details.token, 0o600);
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
    this.write();
  }

  write() {
    if (!this.info) return;
    const ordered = {};
    for (const key of DISCOVERY_KEYS) ordered[key] = this.info[key];
    writeAtomic(this.file, JSON.stringify(ordered, null, 2) + "\n", 0o644);
    this.lastWrite = Date.now();
  }

  /** Record a new open project (null when untitled); writes only on change. */
  setProject(project) {
    if (!this.info || this.info.project === (project || null)) return false;
    this.info.project = project || null;
    this.write();
    return true;
  }

  /** Refresh last_active_at (activation, tool calls); at most one write per minIntervalMs. */
  touch() {
    if (!this.info) return;
    this.info.last_active_at = this.now().toISOString();
    const wait = this.lastWrite + this.minIntervalMs - Date.now();
    if (wait <= 0) {
      this.write();
    } else if (!this.pending) {
      this.pending = setTimeout(() => {
        this.pending = null;
        this.write();
      }, wait);
      if (this.pending.unref) this.pending.unref();
    }
  }

  /** Delete both files if the discovery file still names this pid. */
  remove() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    this.info = null;
    const onDisk = readJson(this.file);
    if (!onDisk || onDisk.pid !== this.pid) return false;
    for (const file of [this.file, this.tokenFile]) {
      try {
        fs.unlinkSync(file);
      } catch (_error) {
        // Already gone.
      }
    }
    return true;
  }
}

module.exports = { DiscoveryFile, DISCOVERY_KEYS, PROTOCOL, linkDir, makeDir, writeAtomic, readJson };
