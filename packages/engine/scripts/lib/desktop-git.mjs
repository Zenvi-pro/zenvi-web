// Read files from the zenvi-core desktop repo at origin/develop without
// touching its working tree (another session works there). One `git cat-file
// --batch` process serves every blob, so reading hundreds of files is fast.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const DESKTOP_REPO = process.env.ZENVI_DESKTOP_REPO ?? join(process.env.HOME ?? "", "Projects/zenvi");
export const DESKTOP_REF = process.env.ZENVI_DESKTOP_REF ?? "origin/develop";

function git(args, input) {
  return execFileSync("git", ["-C", DESKTOP_REPO, ...args], {
    input,
    maxBuffer: 1 << 30,
  });
}

export function desktopCommit() {
  return git(["rev-parse", "--short", DESKTOP_REF]).toString("utf8").trim();
}

/** Every blob under `prefix` (a directory path like "src/profiles/"): Map<path, Buffer>. */
export function readTree(prefix) {
  const listing = git(["ls-tree", "-r", DESKTOP_REF, "--", prefix]).toString("utf8");
  const entries = listing
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      const [, type, sha] = meta.split(" ");
      return { type, sha, path };
    })
    .filter((e) => e.type === "blob");
  if (entries.length === 0) return new Map();
  const out = git(["cat-file", "--batch"], entries.map((e) => e.sha).join("\n") + "\n");
  const files = new Map();
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = out.indexOf(10, offset);
    const header = out.subarray(offset, headerEnd).toString("utf8");
    const size = Number.parseInt(header.split(" ")[2], 10);
    const start = headerEnd + 1;
    files.set(entry.path, out.subarray(start, start + size));
    offset = start + size + 1;
  }
  return files;
}

/** One file as UTF-8 text. */
export function readText(path) {
  return git(["show", `${DESKTOP_REF}:${path}`]).toString("utf8");
}
