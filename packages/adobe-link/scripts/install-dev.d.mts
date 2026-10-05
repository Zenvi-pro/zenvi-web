import type { InstallAction } from "../src/install.js";

export type { InstallAction };
export declare const CSXS_VERSIONS: readonly number[];
export declare function extensionsDir(options: { platform: string; home: string; appData?: string }): string;
export declare function planInstall(options: {
  platform: string;
  home: string;
  appData?: string;
  outDir?: string;
  uninstall?: boolean;
  copy?: boolean;
}): { target: string; actions: InstallAction[]; notes: string[] };
export declare function describeAction(action: InstallAction): string;
