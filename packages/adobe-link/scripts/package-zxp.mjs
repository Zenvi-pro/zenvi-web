#!/usr/bin/env node
/**
 * Package a signed ZXP: dist/pro.zenvi.link-<version>.zxp (release build, no .debug).
 *
 * Needs Adobe's ZXPSignCmd (github.com/Adobe-CEP/CEP-Resources, ZXPSignCMD/)
 * on PATH or in ZXP_SIGN_CMD. Signs with ZXP_CERT + ZXP_CERT_PASSWORD when
 * set; otherwise creates a self-signed certificate in dist/zxp/ (fine for
 * testing; installers show an unknown publisher). ZXP_TSA adds a timestamp
 * server. Without ZXPSignCmd it explains what to do and exits 0.
 *
 *   npm run package:zxp -w @zenvi/adobe-link
 *   npm run package:zxp -w @zenvi/adobe-link -- --out DIR   # ZXP (and self-signed cert) elsewhere
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINK_VERSION } from "../src/version.ts";
import { BUNDLE_ID, DEFAULT_OUT, buildExtension } from "./build-extension.mjs";

const NAMES = ["ZXPSignCmd", "ZXPSignCmd-64bit", "ZXPSignCmd.exe", "ZXPSignCmd-64bit.exe"];

/** ZXPSignCmd from ZXP_SIGN_CMD or PATH, or undefined. */
export function findZxpSignCmd(env = process.env) {
  const candidates = env.ZXP_SIGN_CMD ? [env.ZXP_SIGN_CMD] : (env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap((dir) => NAMES.map((name) => path.join(dir, name)));
  return candidates.find((file) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export const MISSING_HELP = [
  "ZXPSignCmd was not found, so no ZXP was made.",
  "Get it from https://github.com/Adobe-CEP/CEP-Resources (ZXPSignCMD/<version>/<platform>), put it on PATH",
  "or set ZXP_SIGN_CMD=/path/to/ZXPSignCmd, then run `npm run package:zxp -w @zenvi/adobe-link` again.",
  "For development you do not need a ZXP: `npm run install:dev -w @zenvi/adobe-link` installs the unsigned build.",
].join("\n");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args[0]} failed: ${(result.stdout + result.stderr).trim()}`);
  return result.stdout;
}

/** Build a release, sign it into `<outDir>/pro.zenvi.link-<version>.zxp`, verify it. Returns the ZXP path, or undefined without ZXPSignCmd. */
export function packageZxp({ env = process.env, outDir = DEFAULT_OUT, log = console.log } = {}) {
  const signer = findZxpSignCmd(env);
  if (!signer) {
    log(MISSING_HELP);
    return undefined;
  }
  const staging = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-zxp-"));
  try {
    const { dir } = buildExtension({ outDir: staging, release: true });
    let cert = env.ZXP_CERT;
    let password = env.ZXP_CERT_PASSWORD;
    if (!cert) {
      const certDir = path.join(outDir, "zxp");
      mkdirSync(certDir, { recursive: true });
      cert = path.join(certDir, "zenvi-link-selfsigned.p12");
      const passwordFile = path.join(certDir, "zenvi-link-selfsigned.password");
      if (!existsSync(cert)) {
        password = password ?? randomBytes(18).toString("base64url");
        run(signer, ["-selfSignedCert", "US", "CA", "Zenvi", "Zenvi Link (self-signed)", password, cert]);
        writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
        log(`Created a self-signed certificate: ${cert}`);
      } else {
        password = password ?? readFileSync(passwordFile, "utf8").trim();
      }
    }
    if (!password) throw new Error("set ZXP_CERT_PASSWORD for ZXP_CERT");
    const out = path.join(outDir, `${BUNDLE_ID}-${LINK_VERSION}.zxp`);
    rmSync(out, { force: true });
    run(signer, ["-sign", dir, out, cert, password, ...(env.ZXP_TSA ? ["-tsa", env.ZXP_TSA] : [])]);
    run(signer, ["-verify", out]);
    log(`Signed ${out}`);
    return out;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const out = argv.indexOf("--out");
    packageZxp({ outDir: out >= 0 ? path.resolve(argv[out + 1]) : DEFAULT_OUT });
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
