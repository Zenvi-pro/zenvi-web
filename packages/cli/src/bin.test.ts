import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const bin = fileURLToPath(new URL("./bin.ts", import.meta.url));

it("stops quietly when the reader closes stdout early (zenvi … | head)", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", bin, "--json", "tools"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  // Close the pipe before the catalog is written, so its first write fails (EPIPE) every time.
  child.stdout.destroy();
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  expect(stderr).not.toMatch(/EPIPE/);
  expect(code).toBe(0);
}, 30_000);
