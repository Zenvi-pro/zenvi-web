/** Sign-in and Zenvi Cloud commands: login, logout, whoami, push, pull, cloud ls. */

import path from "node:path";
import type { Command } from "commander";
import { deviceLogin } from "../auth/device.js";
import { browserLogin } from "../auth/supabase.js";
import { CloudClient } from "../cloud/client.js";
import { markSynced, pullProject, pushProject } from "../cloud/sync.js";
import { CliError } from "../output.js";
import { requireProject } from "../project/select.js";
import type { CloudMediaRef } from "@zenvi/engine";
import { discoverDesktop, hasProjectOpen } from "../desktop/discovery.js";
import type { ProjectSession } from "../project/session.js";
import { openUrl } from "../util/open-url.js";
import { VERSION } from "../version.js";
import { openSession, type CommandContext } from "./context.js";

export function cloudClient(ctx: CommandContext): CloudClient {
  return new CloudClient(ctx.config.cloudUrl, () => ctx.auth.cloudToken(), fetch, `zenvi-cli/${VERSION}`);
}

export function registerAccountCommands(program: Command, ctx: CommandContext): void {
  program
    .command("login")
    .description("sign in to Zenvi (opens zenvi.pro in your browser, like the desktop app)")
    .option("--device", "sign in with a code on another device (for SSH/headless machines)")
    .option("--no-browser", "print the sign-in link instead of opening it")
    .action(async (opts: { device?: boolean; browser?: boolean }) => {
      const open = (url: string) => (opts.browser === false ? false : openUrl(url, ctx.env));
      if (opts.device) {
        const auth = await deviceLogin(ctx.config, {
          openUrl: open,
          onCode: (code) => {
            ctx.out.info(`To sign in, open ${code.verification_uri_complete ?? code.verification_uri}`);
            ctx.out.info(`and confirm the code ${ctx.out.style(code.user_code, "bold")} (expires in ${Math.round((code.expires_in ?? 600) / 60)} min).`);
          },
        });
        await ctx.auth.save(auth);
        report(ctx, `Signed in${auth.user_email ? ` as ${auth.user_email}` : ""} (personal token, Zenvi Cloud only).`, { kind: "pat", email: auth.user_email ?? null });
        return;
      }
      const auth = await browserLogin(ctx.config, {
        openUrl: open,
        onUrl: (url) => ctx.out.info(`Opening ${url}\nIf no browser opens, paste that link into one. Waiting for you to sign in…`),
      });
      await ctx.auth.save(auth);
      report(ctx, `Signed in${auth.user_email ? ` as ${auth.user_email}` : ""}.`, { kind: "supabase", email: auth.user_email ?? null });
    });

  program
    .command("logout")
    .description("forget this machine's Zenvi sign-in")
    .action(async () => {
      const removed = await ctx.auth.logout();
      report(ctx, removed ? "Signed out." : "You were not signed in.", { removed });
    });

  program
    .command("whoami")
    .description("show who you are signed in as")
    .action(async () => {
      const who = await ctx.auth.whoami();
      const features = await ctx.auth.features();
      if (ctx.out.json) {
        ctx.out.data({ status: "applied", ...who, features });
        return;
      }
      if (!who.loggedIn) {
        ctx.out.line(who.expired ? "Your sign-in expired. Run `zenvi login`." : "Not signed in. Run `zenvi login`.");
        ctx.exitCode = who.expired ? 1 : 0;
        return;
      }
      ctx.out.line(`${who.email ?? who.userId ?? "Signed in"} ${ctx.out.style(`(${who.kind === "pat" ? "personal token: Zenvi Cloud" : "Zenvi account"})`, "dim")}`);
      // A personal token cannot use the backend's AI features: say so now, not on the first failed call.
      const off = features.filter((f) => !f.enabled);
      if (off.length > 0) ctx.out.line(ctx.out.style(`Off with this sign-in: ${off.map((f) => f.name).join("; ")}. ${off[0]!.fix}`, "dim"));
    });

  program
    .command("push")
    .description("upload the project and its media to Zenvi Cloud and open it in the web editor")
    .option("--name <name>", "cloud project name (default: the file name)")
    .option("--force", "overwrite cloud edits made since your last push")
    .option("--no-open", "do not open the web editor")
    .action(async (opts: { name?: string; force?: boolean; open?: boolean }) => {
      const file = await requireProject({ flag: ctx.flags().project, cwd: ctx.cwd, env: ctx.env });
      const session = await openSession(ctx, file);
      const result = await pushProject({
        config: ctx.config,
        client: cloudClient(ctx),
        projectFile: file,
        project: session.doc.toJSON(),
        name: opts.name,
        force: opts.force,
        warn: (m) => ctx.out.warn(m),
        onProgress: (p) => ctx.out.progress(p.phase === "saving" ? "Saving project…" : `${p.phase === "hashing" ? "Hashing" : "Uploading"} ${p.file ?? ""} (${p.done + 1}/${p.total})`),
      });
      ctx.out.endProgress();
      await keepCloudRefs(ctx, session, result.cloudRefs);
      if (opts.open !== false) await openUrl(result.editorUrl, ctx.env);
      if (ctx.out.json) ctx.out.data({ status: "applied", summary: `Pushed ${path.basename(file)} to Zenvi Cloud`, engine: "portable", project: file, ...result });
      else {
        ctx.out.line(`${ctx.out.style("✓", "green")} Pushed to Zenvi Cloud: ${result.editorUrl}`);
        ctx.out.line(ctx.out.style(`  ${result.uploaded} media uploaded, ${result.reused} already there${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`, "dim"));
      }
    });

  program
    .command("pull")
    .description("download a Zenvi Cloud project (and its media) into a folder")
    .argument("<project>", "cloud project id or web editor URL")
    .argument("[dir]", "folder to pull into (default: ./<project name>, or ./<project name> (2)… when that holds another project)")
    .option("--force", "replace a project file there that belongs to another project or has unpushed edits")
    .action(async (id: string, dir: string | undefined, opts: { force?: boolean }) => {
      const result = await pullProject({
        config: ctx.config,
        client: cloudClient(ctx),
        id,
        dir,
        force: opts.force,
        cwd: ctx.cwd,
        warn: (m) => ctx.out.warn(m),
        onProgress: (p) => ctx.out.progress(`Downloading ${p.file} (${p.done + 1}/${p.total})`),
      });
      ctx.out.endProgress();
      if (ctx.out.json) ctx.out.data({ status: "applied", summary: `Pulled ${result.projectFile}`, engine: "portable", project: result.projectFile, ...result });
      else {
        ctx.out.line(`${ctx.out.style("✓", "green")} Pulled into ${result.projectFile}`);
        ctx.out.line(ctx.out.style(`  ${result.downloaded} media downloaded, ${result.reused} already here${result.missing.length ? `, ${result.missing.length} missing in the cloud` : ""}`, "dim"));
      }
    });

  const cloud = program.command("cloud").description("Zenvi Cloud");
  cloud
    .command("ls")
    .description("list your cloud projects")
    .action(async () => {
      const projects = await cloudClient(ctx).listProjects();
      if (ctx.out.json) {
        ctx.out.data({ status: "applied", projects });
        return;
      }
      if (projects.length === 0) {
        ctx.out.line("No cloud projects yet. Push one with `zenvi push`.");
        return;
      }
      ctx.out.table(
        ["id", "name", "updated", "editor"],
        projects.map((p) => [p.id, p.name, p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "", p.editorUrl ?? ""]),
      );
    });
}

/**
 * Store each file's `cloud` ref in the local project (not an undo step), like
 * the desktop, so later pushes skip re-hashing. Skipped while the desktop app
 * has the project open: it owns the file then.
 */
export async function keepCloudRefs(ctx: CommandContext, session: ProjectSession, refs: Record<string, CloudMediaRef>): Promise<void> {
  const file = session.file;
  if (!file) return;
  let desktopOwns = false;
  if (Object.keys(refs).length > 0) {
    for (const endpoint of await discoverDesktop(ctx.config)) if (await hasProjectOpen(endpoint, file)) desktopOwns = true;
  }
  let changed = false;
  for (const [id, ref] of desktopOwns ? [] : Object.entries(refs)) {
    const entry = session.doc.project.files.find((f) => f.id === id);
    if (!entry || JSON.stringify(entry.cloud) === JSON.stringify(ref)) continue;
    session.doc.setUntracked(["files", { id }], { ...entry, cloud: ref });
    changed = true;
  }
  if (changed) await session.save();
  // What is on disk now is what the cloud has: a later pull may replace it.
  await markSynced(ctx.config, file);
}

function report(ctx: CommandContext, summary: string, data: Record<string, unknown>): void {
  if (ctx.out.json) ctx.out.data({ status: "applied", summary, ...data });
  else ctx.out.line(`${ctx.out.style("✓", "green")} ${summary}`);
}

export { CliError };
