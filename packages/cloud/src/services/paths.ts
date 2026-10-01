/**
 * Blob layout (docs/ARCHITECTURE.md §4):
 *
 *   u/{userId}/p/{projectId}/project.json            the project (revision = ETag)
 *   u/{userId}/p/{projectId}/meta.json               name, timestamps, stats
 *   u/{userId}/p/{projectId}/renders/{renderId}.{ext}
 *   u/{userId}/p/{projectId}/renders/{renderId}.project.json   snapshot rendered
 *   u/{userId}/p/{projectId}/frames/{hash}.{png|jpg}           preview frames
 *   u/{userId}/p/{projectId}/exports/{name}                    files tools export (captions)
 *   u/{userId}/media/{sha256}                        content-addressed media
 *   u/{userId}/uploads/{sha256}.json                 pending upload declaration
 *   u/{userId}/mcp/{connection}.json                 MCP session state
 *
 * Every id that reaches a path is validated first, so a path can never escape
 * the user's prefix.
 */

import { ApiError } from "../http/errors.js";

const USER_ID = /^[A-Za-z0-9-]{1,64}$/;
export const PROJECT_ID = /^c_[a-z0-9]{16}$/;
export const RENDER_ID = /^r_[a-z0-9]{16}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONNECTION = /^[A-Za-z0-9_-]{1,80}$/;

function check(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) throw new ApiError(400, "invalid_request", `Invalid ${what}.`);
  return value;
}

export const userPrefix = (userId: string): string => `u/${check(userId, USER_ID, "user id")}/`;
export const projectPrefix = (userId: string, projectId: string): string =>
  `${userPrefix(userId)}p/${check(projectId, PROJECT_ID, "project id")}/`;
export const projectPath = (userId: string, projectId: string): string => `${projectPrefix(userId, projectId)}project.json`;
export const metaPath = (userId: string, projectId: string): string => `${projectPrefix(userId, projectId)}meta.json`;
export const renderPath = (userId: string, projectId: string, renderId: string, ext: string): string =>
  `${projectPrefix(userId, projectId)}renders/${check(renderId, RENDER_ID, "render id")}.${check(ext, /^[a-z0-9]{1,8}$/, "extension")}`;
export const renderSnapshotPath = (userId: string, projectId: string, renderId: string): string =>
  `${projectPrefix(userId, projectId)}renders/${check(renderId, RENDER_ID, "render id")}.project.json`;
export const framePath = (userId: string, projectId: string, key: string, ext: "png" | "jpg"): string =>
  `${projectPrefix(userId, projectId)}frames/${check(key, /^[0-9a-f]{16,64}$/, "frame key")}.${ext}`;
/** Files tools export for download (captions…): `exports/<name>`. */
export const exportPath = (userId: string, projectId: string, name: string): string =>
  `${projectPrefix(userId, projectId)}exports/${check(name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, "export file name")}`;
export const mediaPrefix = (userId: string): string => `${userPrefix(userId)}media/`;
export const mediaPath = (userId: string, sha256: string): string => `${mediaPrefix(userId)}${check(sha256, SHA256, "sha256")}`;
export const uploadPath = (userId: string, sha256: string): string => `${userPrefix(userId)}uploads/${check(sha256, SHA256, "sha256")}.json`;
export const sessionPath = (userId: string, connection: string): string =>
  `${userPrefix(userId)}mcp/${check(connection, CONNECTION, "connection")}.json`;

export function isProjectId(value: string): boolean {
  return PROJECT_ID.test(value);
}

export function isRenderId(value: string): boolean {
  return RENDER_ID.test(value);
}
