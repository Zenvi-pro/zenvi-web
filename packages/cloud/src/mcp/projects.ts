/**
 * Which cloud project an MCP call acts on, and the edit cycle every mutating
 * call goes through: load the project blob → run the change on a
 * ProjectDocument (one transaction = one undo step, saved into the project's
 * history in desktop format) → save with If-Match. When someone else saved in
 * between, the whole change is replayed on the new revision (up to 3 times).
 */

import { ProjectDocument } from "@zenvi/engine";
import { ApiError } from "../http/errors.js";
import { isProjectId } from "../services/paths.js";
import type { LoadedProject } from "../services/projects.js";
import type { McpCallContext } from "./types.js";

export async function resolveProjectId(ctx: McpCallContext, explicit: string | undefined): Promise<string> {
  const { projects, sessions } = ctx.services;
  const userId = ctx.principal.userId;
  if (explicit !== undefined && explicit !== "") {
    if (!isProjectId(explicit)) throw new ApiError(400, "invalid_request", `"${explicit}" is not a Zenvi Cloud project id (they look like c_…). Call list_projects.`);
    try {
      await projects.revision(userId, explicit);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "not_found", `Project ${explicit} was not found in your Zenvi Cloud. Call list_projects.`);
      }
      throw error;
    }
    await sessions.set(userId, ctx.connection, explicit);
    return explicit;
  }
  const current = await sessions.current(userId, ctx.connection);
  if (current) {
    try {
      await projects.revision(userId, current);
      return current;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
      sessions.forget(userId, current);
    }
  }
  throw new ApiError(409, "no_project", "No project is open. Call list_projects and then open_project, or create_project.");
}

export interface EditOutcome<T> {
  value: T;
  loaded: LoadedProject;
  /** Revision after the call (unchanged when nothing changed). */
  revision: string;
  changed: boolean;
}

/**
 * Run `body` against the latest revision of the project. `body` may be called
 * more than once (on a concurrent save) and must be a pure function of the
 * document it gets, apart from idempotent side effects.
 */
export async function editProject<T>(
  ctx: McpCallContext,
  projectId: string,
  body: (doc: ProjectDocument, loaded: LoadedProject) => Promise<T>,
): Promise<EditOutcome<T>> {
  const { projects } = ctx.services;
  const userId = ctx.principal.userId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await projects.get(userId, projectId);
    const doc = new ProjectDocument(loaded.project);
    const before = doc.revision;
    const value = await body(doc, loaded);
    if (doc.revision === before) return { value, loaded, revision: loaded.revision, changed: false };
    try {
      const saved = await projects.save(userId, projectId, doc.toJSON(), loaded.revision);
      return { value, loaded, revision: saved.revision, changed: true };
    } catch (error) {
      if (error instanceof ApiError && error.code === "revision_conflict") continue;
      throw error;
    }
  }
  throw new ApiError(409, "busy", "The project kept changing while this edit ran (another editor is saving). Try again.");
}
