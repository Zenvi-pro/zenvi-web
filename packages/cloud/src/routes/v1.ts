/**
 * REST API /v1 (docs/CLOUD_API.md): account, projects, media, renders and
 * personal tokens. Every route authenticates (Supabase session or personal
 * token) and only ever touches the caller's own `u/{userId}/…` data.
 */

import { Hono } from "hono";
import { z } from "zod";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import type { Services } from "../container.js";
import { requireAuth } from "../http/auth.js";
import { parseJson, parseWith, readJson } from "../http/body.js";
import type { AppEnv } from "../http/context.js";
import { ApiError, badRequest, notFound } from "../http/errors.js";
import { parseUntrustedProject, projectMedia } from "../projects/model.js";
import { PRESET_NAMES, renderOptionsSchema } from "../render/options.js";
import type { RenderJob, RenderJobView } from "../render/service.js";
import { isProjectId, isRenderId } from "../services/paths.js";
import type { ProjectMeta, ProjectSummary } from "../services/projects.js";

const sha256 = z.string().regex(/^[0-9a-fA-F]{64}$/, "must be a hex SHA-256").transform((s) => s.toLowerCase());

function projectId(value: string): string {
  if (!isProjectId(value)) throw notFound("Project");
  return value;
}

function renderJson(job: RenderJob | RenderJobView): Record<string, unknown> {
  const view = job as RenderJobView;
  return {
    renderId: job.renderId,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    format: job.format,
    options: job.options,
    revision: job.revision,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    bytes: job.bytes ?? null,
    error: job.error ?? null,
    ...(view.url ? { url: view.url, urlExpiresAt: view.urlExpiresAt } : {}),
  };
}

export function v1Routes(services: Services): Hono<AppEnv> {
  const { projects, media, renders, tokens, config, sessions } = services;
  const app = new Hono<AppEnv>();
  const editorUrl = (id: string): string => `${config.editorUrl}/p/${id}`;
  const summary = (p: ProjectSummary | (ProjectMeta & { revision?: string })): Record<string, unknown> => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...(p.revision ? { revision: p.revision } : {}),
    stats: p.stats,
    editorUrl: editorUrl(p.id),
  });

  app.use("*", requireAuth(services.auth, { allow: ["supabase", "pat"] }));

  // Scope gate: personal tokens carry both scopes today; a narrower one is refused writes.
  app.use("*", async (c, next) => {
    const principal = c.get("principal");
    const needs = c.req.method === "GET" || c.req.method === "HEAD" ? SCOPE_READ : SCOPE_WRITE;
    if (!principal.scopes.includes(needs)) throw new ApiError(403, "insufficient_scope", `This token lacks ${needs}.`);
    await next();
  });

  app.get("/me", async (c) => {
    const principal = c.get("principal");
    const bytes = await media.usage(principal.userId);
    return c.json({
      user: { id: principal.userId, email: principal.email ?? null },
      auth: principal.kind,
      usage: { bytes, quotaBytes: config.limits.maxUserBytes, maxFileBytes: config.limits.maxFileBytes },
    });
  });

  // ---------------------------------------------------------------- projects

  app.get("/projects", async (c) => {
    const list = await projects.list(c.get("principal").userId);
    return c.json({ projects: list.map(summary) });
  });

  app.post("/projects", async (c) => {
    const body = parseWith(
      z.object({ name: z.string().max(500).optional(), project: z.unknown().optional() }),
      await readJson(c, config.limits.maxProjectBytes + 64 * 1024),
    );
    const project = body.project === undefined || body.project === null ? undefined : parseUntrustedProject(body.project);
    const created = await projects.create(c.get("principal").userId, { name: body.name, project });
    c.header("ETag", `"${created.revision}"`);
    return c.json(summary(created), 201);
  });

  app.get("/projects/:id", async (c) => {
    const userId = c.get("principal").userId;
    const id = projectId(c.req.param("id"));
    const loaded = await projects.get(userId, id);
    const { refs, unhashed } = projectMedia(loaded.project);
    const inventory = refs.length > 0 ? await media.inventory(userId) : new Map();
    const mediaList: Record<string, unknown>[] = [];
    const missing: Record<string, unknown>[] = unhashed.map((u) => ({ ...u, reason: "not_in_cloud" }));
    for (const ref of refs) {
      const info = inventory.get(ref.sha256);
      if (!info) {
        missing.push({ fileId: ref.fileId, name: ref.name, sha256: ref.sha256, reason: "not_uploaded" });
        continue;
      }
      const signed = await media.readUrl(userId, ref.sha256, info);
      mediaList.push({ fileId: ref.fileId, sha256: ref.sha256, name: info.name, contentType: info.contentType, size: info.size, url: signed.url, expiresAt: signed.expiresAt });
    }
    c.header("ETag", `"${loaded.revision}"`);
    return c.json({ ...summary({ ...loaded.meta, revision: loaded.revision }), project: loaded.project, media: mediaList, missingMedia: missing });
  });

  app.put("/projects/:id", async (c) => {
    const id = projectId(c.req.param("id"));
    const ifMatch = c.req.header("if-match");
    if (!ifMatch) {
      throw new ApiError(428, "precondition_required", "Send If-Match with the revision you loaded (or * to overwrite).");
    }
    const project = parseUntrustedProject(await readJson(c, config.limits.maxProjectBytes));
    const saved = await projects.save(c.get("principal").userId, id, project, ifMatch);
    c.header("ETag", `"${saved.revision}"`);
    return c.json({ id, revision: saved.revision, updatedAt: saved.updatedAt, stats: saved.stats });
  });

  app.patch("/projects/:id", async (c) => {
    const id = projectId(c.req.param("id"));
    const body = await parseJson(c, z.object({ name: z.string().min(1).max(500) }));
    const meta = await projects.rename(c.get("principal").userId, id, body.name);
    return c.json(summary(meta));
  });

  app.delete("/projects/:id", async (c) => {
    const userId = c.get("principal").userId;
    const id = projectId(c.req.param("id"));
    await projects.delete(userId, id);
    sessions.forget(userId, id);
    media.invalidateUsage(userId);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- renders

  app.post("/projects/:id/renders", async (c) => {
    const id = projectId(c.req.param("id"));
    const body = await parseJson(
      c,
      z.object({ preset: z.enum(PRESET_NAMES as [string, ...string[]]).optional(), options: renderOptionsSchema.optional() }).strict(),
    );
    const job = await renders.start(c.get("principal").userId, id, {
      preset: body.preset as (typeof PRESET_NAMES)[number] | undefined,
      options: body.options,
    });
    return c.json(renderJson(job), 202);
  });

  app.get("/projects/:id/renders", async (c) => {
    const id = projectId(c.req.param("id"));
    const userId = c.get("principal").userId;
    await projects.revision(userId, id);
    const jobs = await renders.list(userId, id);
    return c.json({ renders: jobs.map(renderJson) });
  });

  app.get("/projects/:id/renders/:renderId", async (c) => {
    const id = projectId(c.req.param("id"));
    const renderId = c.req.param("renderId");
    if (!isRenderId(renderId)) throw notFound("Render");
    const job = await renders.get(c.get("principal").userId, id, renderId);
    return c.json(renderJson(job));
  });

  // ---------------------------------------------------------------- media

  app.post("/media/check", async (c) => {
    const body = await parseJson(c, z.object({ sha256: z.array(z.string()).max(1000) }));
    return c.json(await media.check(c.get("principal").userId, body.sha256));
  });

  app.post("/media", async (c) => {
    const body = await parseJson(
      c,
      z.object({
        sha256,
        size: z.number().int().min(0),
        name: z.string().max(1000),
        contentType: z.string().max(200),
      }),
    );
    const ticket = await media.declare(c.get("principal").userId, body);
    return c.json(ticket, ticket.exists ? 200 : 201);
  });

  app.post("/media/:sha256/complete", async (c) => {
    const hash = parseWith(sha256, c.req.param("sha256"));
    return c.json(await media.complete(c.get("principal").userId, hash));
  });

  app.get("/media/:sha256/url", async (c) => {
    const hash = parseWith(sha256, c.req.param("sha256"));
    return c.json(await media.readUrl(c.get("principal").userId, hash));
  });

  // ---------------------------------------------------------------- tokens (account page)

  const tokenRoutes = new Hono<AppEnv>();
  tokenRoutes.use("*", async (c, next) => {
    if (c.get("principal").kind !== "supabase") {
      throw new ApiError(403, "forbidden", "Manage tokens while signed in to zenvi.pro (not with a personal token).");
    }
    await next();
  });
  tokenRoutes.get("/", async (c) => c.json(await tokens.listForUser(c.get("principal").userId)));
  tokenRoutes.post("/", async (c) => {
    const body = await parseJson(
      c,
      z.object({ name: z.string().min(1).max(100), expiresInDays: z.number().int().min(1).max(365).nullable().optional() }),
    );
    const principal = c.get("principal");
    const { token, info } = await tokens.createPat({
      userId: principal.userId,
      email: principal.email,
      name: body.name.trim(),
      scopes: [SCOPE_READ, SCOPE_WRITE],
      ttlDays: body.expiresInDays === null ? null : (body.expiresInDays ?? config.tokens.patDefaultDays),
    });
    return c.json({ ...info, token }, 201);
  });
  tokenRoutes.delete("/:id", async (c) => {
    const userId = c.get("principal").userId;
    const id = c.req.param("id");
    let removed = false;
    if (/^tok_[a-z0-9]{12}$/.test(id)) removed = await tokens.revokePat(userId, id);
    else if (/^grant_[a-z0-9]{16}$/.test(id)) removed = await tokens.revokeGrant(userId, id);
    else throw badRequest("Unknown token id.");
    if (!removed) throw notFound("Token");
    return c.body(null, 204);
  });
  app.route("/tokens", tokenRoutes);

  return app;
}
