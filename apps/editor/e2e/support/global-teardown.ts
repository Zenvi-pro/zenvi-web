import { rmSync } from "node:fs";

export default function globalTeardown(): void {
  const dir = process.env.ZENVI_E2E_FIXTURES;
  if (dir && dir.includes("zenvi-editor-e2e-")) rmSync(dir, { recursive: true, force: true });
}
