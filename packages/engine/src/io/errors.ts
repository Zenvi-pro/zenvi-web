/** Errors raised while reading project JSON. */

export interface ProjectIssue {
  /** Where the problem is, e.g. `clips[2].position` (empty for the root). */
  path: string;
  message: string;
}

/** The input is not a project the engine can load. Carries every problem found. */
export class ProjectParseError extends Error {
  override readonly name = "ProjectParseError";
  readonly issues: readonly ProjectIssue[];

  constructor(issues: readonly ProjectIssue[]) {
    super(describeIssues(issues));
    this.issues = issues;
  }
}

function describeIssues(issues: readonly ProjectIssue[]): string {
  const first = issues[0];
  if (!first) return "Invalid project.";
  const where = first.path ? `${first.path}: ` : "";
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : "";
  return `Invalid project: ${where}${first.message}${more}`;
}

/** `["clips", 2, "position"]` → `clips[2].position`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out;
}
