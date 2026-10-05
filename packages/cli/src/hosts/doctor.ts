/**
 * `zenvi adobe doctor`: everything between "I have After Effects" and "the
 * agent can use ae_* tools" — the extension this zenvi ships, the installed
 * copies and their versions, PlayerDebugMode (unsigned extensions need it),
 * the apps, the live Zenvi Link servers, and which families `zenvi mcp` lists.
 */

import { spawnSync } from "node:child_process";
import { CSXS_VERSIONS, HOST_IDS, HostClient, inspectHost, LINK_VERSION, type HostId } from "@zenvi/adobe-link";
import type { DoctorCheck } from "../commands/integrations.js";
import { catalogTools } from "./adobe-tools.js";
import { bundledExtension, findAdobeApps, findInstalledExtensions, type DetectDeps } from "./extension.js";
import { APP_LABEL, decideFamilies } from "./policy.js";

export type RunCommand = (command: string, args: string[]) => { code: number; stdout: string };

/** The oldest release Zenvi Link loads in (CSXS/manifest.xml HostList: AEFT 18.0, PPRO 15.0). */
export const OLDEST_RELEASE: { readonly [H in HostId]: { year: number; version: string } } = {
  aftereffects: { year: 2021, version: "18.0" },
  premiere: { year: 2021, version: "15.0" },
};

/** App folders ("Adobe After Effects 2020", "… CC 2019") older than Zenvi Link supports. */
export function tooOldApps(host: HostId, folders: readonly string[]): string[] {
  return folders.filter((name) => {
    const year = Number(/\b(20\d\d)\b/.exec(name)?.[1]);
    return Number.isFinite(year) && year < OLDEST_RELEASE[host].year;
  });
}

export const runCommand: RunCommand = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5000, windowsHide: true });
  return { code: result.status ?? 1, stdout: result.stdout ?? "" };
};

/** CSXS versions whose PlayerDebugMode is 1. */
export function debugModeVersions(platform: string, run: RunCommand): number[] {
  return CSXS_VERSIONS.filter((n) => {
    if (platform === "darwin") {
      const r = run("defaults", ["read", `com.adobe.CSXS.${n}`, "PlayerDebugMode"]);
      return r.code === 0 && r.stdout.trim() === "1";
    }
    const r = run("reg", ["query", `HKCU\\Software\\Adobe\\CSXS.${n}`, "/v", "PlayerDebugMode"]);
    return r.code === 0 && /PlayerDebugMode\s+REG_SZ\s+1\b/.test(r.stdout);
  });
}

export interface AdobeDoctorOptions {
  desktopDir: string;
  detect: DetectDeps;
  run?: RunCommand;
  clientVersion?: string;
}

export async function adobeDoctor(options: AdobeDoctorOptions): Promise<DoctorCheck[]> {
  const { detect } = options;
  const run = options.run ?? runCommand;
  const checks: DoctorCheck[] = [];
  const supported = detect.platform === "darwin" || detect.platform === "win32";
  if (!supported) {
    checks.push({ name: "platform", level: "warn", detail: `Zenvi Link runs in After Effects and Premiere Pro on macOS and Windows; this is ${detect.platform}` });
  }

  const bundled = await bundledExtension(detect);
  checks.push(
    bundled
      ? { name: "zenvi link", level: "ok", detail: `${bundled.version ?? "?"} ships with this zenvi (${bundled.dir})` }
      : {
          name: "zenvi link",
          level: "fail",
          detail: "this zenvi build has no Zenvi Link extension to install",
          hint: "From a checkout: npm run build -w @zenvi/adobe-link (or npm run install:dev -w @zenvi/adobe-link for a linked dev install), or set ZENVI_ADOBE_EXTENSION.",
        },
  );

  if (supported) {
    const installed = await findInstalledExtensions(detect);
    if (installed.length === 0) {
      checks.push({ name: "installed", level: "warn", detail: "Zenvi Link is not installed", hint: "Run `zenvi adobe install`, then restart After Effects / Premiere Pro." });
    }
    for (const copy of installed) {
      const want = bundled?.version ?? LINK_VERSION;
      const stale = copy.version !== want && !copy.linked;
      checks.push({
        name: "installed",
        level: stale ? "warn" : "ok",
        detail: `${copy.version ?? "?"} (${copy.scope}${copy.linked ? ", development link" : ""}) ${copy.dir}`,
        ...(stale ? { hint: `This zenvi ships ${want}: run \`zenvi adobe install\` and restart the apps.` } : {}),
      });
    }
    const debug = debugModeVersions(detect.platform, run);
    const missing = CSXS_VERSIONS.filter((n) => !debug.includes(n));
    checks.push({
      name: "debug mode",
      level: missing.length === 0 ? "ok" : "warn",
      detail: missing.length === 0 ? `PlayerDebugMode on for CSXS ${CSXS_VERSIONS.join(", ")}` : `PlayerDebugMode off for CSXS ${missing.join(", ")}`,
      hint: "Unsigned extensions (zenvi adobe install, install:dev) load only with PlayerDebugMode=1; `zenvi adobe install` sets it. A signed ZXP does not need it.",
    });
  }

  const { apps, looked } = await findAdobeApps(detect);
  for (const host of HOST_IDS) {
    const name = APP_LABEL[host].toLowerCase();
    const found = await inspectHost(options.desktopDir, host, { clientVersion: options.clientVersion });
    const installedApp = apps[host].length ? apps[host].join(", ") : looked ? "not found in the standard folders" : "unknown";
    if (found.endpoint) {
      const endpoint = found.endpoint;
      const live = await liveToolNames(endpoint);
      const expected = [...catalogTools(host).keys()];
      const lacking = live ? expected.filter((tool) => !live.includes(tool)) : [];
      checks.push({
        name,
        level: lacking.length ? "warn" : "ok",
        detail: `connected: ${endpoint.appName || APP_LABEL[host]} ${endpoint.appVersion}, Zenvi Link ${endpoint.version}, ${live ? `${live.length} tools` : "tools/list failed"}${endpoint.project ? `, ${endpoint.project}` : ", no saved project"}`,
        ...(lacking.length ? { hint: `Zenvi Link there lacks ${lacking.length} tool(s) this zenvi knows (${lacking.slice(0, 4).join(", ")}…): run \`zenvi adobe install\` and restart ${APP_LABEL[host]}.` } : {}),
      });
    } else {
      const old = tooOldApps(host, apps[host]);
      const supported = apps[host].length > old.length;
      checks.push({
        name,
        level: "warn",
        detail: `not connected: ${found.detail}; app: ${installedApp}`,
        hint:
          old.length && !supported
            ? `${old.join(", ")} is older than Zenvi Link supports: it loads in ${APP_LABEL[host]} ${OLDEST_RELEASE[host].year} (${OLDEST_RELEASE[host].version}) or newer.`
            : `Open ${APP_LABEL[host]}; Zenvi Link starts with it (Window > Extensions > Zenvi Link shows its panel).`,
      });
    }
  }

  const families = await decideFamilies(options.desktopDir, detect);
  const listed = HOST_IDS.filter((host) => families[host].listed);
  checks.push({
    name: "zenvi mcp",
    level: "ok",
    detail: `lists ${listed.length ? listed.map((h) => `${h === "aftereffects" ? "ae_*" : "premiere_*"} (${families[h].reason})`).join(", ") : "no Adobe tools"}${listed.length < HOST_IDS.length ? `; not ${HOST_IDS.filter((h) => !families[h].listed).map((h) => `${h === "aftereffects" ? "ae_*" : "premiere_*"} (${families[h].reason})`).join(", ")}` : ""}`,
    hint: "ZENVI_MCP_ADOBE=on lists both families, off hides them.",
  });
  return checks;
}

async function liveToolNames(endpoint: { host: HostId; url: string; token: string }): Promise<string[] | undefined> {
  const client = new HostClient(endpoint);
  try {
    return (await client.listTools()).map((t) => t.name);
  } catch {
    return undefined;
  } finally {
    await client.close();
  }
}
