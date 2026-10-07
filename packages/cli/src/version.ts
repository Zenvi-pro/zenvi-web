/** CLI version (package.json), injected by the bundle build; "dev" when run from source. */
declare const __ZENVI_VERSION__: string | undefined;

export const VERSION: string = typeof __ZENVI_VERSION__ !== "undefined" && __ZENVI_VERSION__ ? __ZENVI_VERSION__ : "0.1.0-dev";
