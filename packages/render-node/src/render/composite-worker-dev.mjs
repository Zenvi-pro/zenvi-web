// Development entry for the composite worker (CompositePool): loads the
// TypeScript sources through tsx. Bundles (the CLI, the cloud server) ship a
// compiled composite-worker.mjs next to the main bundle instead.
import { register } from "tsx/esm/api";

register();
await import("./composite-worker.ts");
