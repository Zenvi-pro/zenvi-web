export declare const MISSING_HELP: string;
export declare function findZxpSignCmd(env?: Record<string, string | undefined>): string | undefined;
export declare function packageZxp(options?: { env?: Record<string, string | undefined>; outDir?: string; log?: (line: string) => void }): string | undefined;
