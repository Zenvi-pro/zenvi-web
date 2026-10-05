export type InstallAction =
  | { kind: "build"; outDir: string }
  | { kind: "remove"; path: string }
  | { kind: "link"; from: string; to: string; type: "dir" | "junction" }
  | { kind: "copy"; from: string; to: string }
  | { kind: "run"; command: string; args: string[] };

export declare const CSXS_VERSIONS: number[];
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
