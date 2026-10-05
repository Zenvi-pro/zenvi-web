/**
 * Which Adobe tool families `zenvi mcp` lists (SPEC §3.8): ZENVI_MCP_ADOBE =
 * `auto` (default), `on` or `off`. The families cost ~55 tools of context, so
 * `auto` lists one only when it can be used on this machine:
 *
 * - its discovery file exists (Zenvi Link has run in that app here), or
 * - Zenvi Link is installed in a CEP extensions folder and the app is
 *   installed too. The extension serves both apps; when neither app is found
 *   in the standard places (a custom install location) both families are
 *   listed rather than guessing.
 */

import path from "node:path";
import { HOST_IDS, linkDirOf, type HostId } from "@zenvi/adobe-link";
import { findAdobeApps, findInstalledExtensions, type DetectDeps } from "./extension.js";

export type AdobeMode = "auto" | "on" | "off";

export const APP_LABEL: { readonly [H in HostId]: string } = { aftereffects: "After Effects", premiere: "Premiere Pro" };

export function adobeMode(env: NodeJS.ProcessEnv): AdobeMode {
  const value = env.ZENVI_MCP_ADOBE?.trim().toLowerCase();
  return value === "on" || value === "off" ? value : "auto";
}

export interface FamilyDecision {
  listed: boolean;
  /** Why, for list_hosts and `zenvi adobe doctor`. */
  reason: string;
  /** How to get the family listed, when it is not. */
  enable?: string;
}

export type FamilyDecisions = Record<HostId, FamilyDecision>;

function enableHint(host: HostId): string {
  return `Run \`zenvi adobe install\` and restart ${APP_LABEL[host]} (the ${host === "aftereffects" ? "ae_*" : "premiere_*"} tools then appear; some MCP clients need a restart), or set ZENVI_MCP_ADOBE=on in this server's environment.`;
}

export async function decideFamilies(desktopDir: string, deps: DetectDeps): Promise<FamilyDecisions> {
  const mode = adobeMode(deps.env);
  const decisions = {} as FamilyDecisions;
  if (mode !== "auto") {
    for (const host of HOST_IDS) {
      decisions[host] =
        mode === "on"
          ? { listed: true, reason: "ZENVI_MCP_ADOBE=on" }
          : { listed: false, reason: "ZENVI_MCP_ADOBE=off", enable: "Unset ZENVI_MCP_ADOBE (or set it to auto or on) in this server's environment." };
    }
    return decisions;
  }
  const installed = (await findInstalledExtensions(deps)).length > 0;
  const { apps } = installed ? await findAdobeApps(deps) : { apps: { aftereffects: [], premiere: [] } as Record<HostId, string[]> };
  const anyApp = HOST_IDS.some((host) => apps[host].length > 0);
  for (const host of HOST_IDS) {
    if (await deps.exists(path.join(linkDirOf(desktopDir), `${host}.json`))) {
      decisions[host] = { listed: true, reason: `Zenvi Link runs in ${APP_LABEL[host]} on this machine` };
    } else if (installed && apps[host].length > 0) {
      decisions[host] = { listed: true, reason: `Zenvi Link and ${apps[host][0]} are installed` };
    } else if (installed && !anyApp) {
      decisions[host] = { listed: true, reason: "Zenvi Link is installed (no Adobe app found in the standard folders)" };
    } else if (installed) {
      decisions[host] = { listed: false, reason: `Zenvi Link is installed but ${APP_LABEL[host]} was not found`, enable: enableHint(host) };
    } else {
      decisions[host] = { listed: false, reason: "Zenvi Link is not installed", enable: enableHint(host) };
    }
  }
  return decisions;
}
