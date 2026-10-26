/**
 * Lab only: a personal access token for a Zenvi Cloud whose storage
 * connection string you hold, written straight into its `tokens` table, for
 * a lab person that has no Supabase account (scripts/azure/lab.sh token).
 * Holding the connection string already means owning every project in that
 * storage; this adds no access, it saves the device login a lab cannot do.
 *
 *   ENV_FILE=~/.config/zenvi-dev/lab-cloud.env npx tsx packages/cloud/scripts/mint-token.ts <user id> <out file> [days]
 *
 * Writes `ZENVI_TOKEN=zvn_pat_…` to <out file> (mode 600) and prints only the
 * token's id and expiry. Refuses production's storage account.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { SCOPE_READ, SCOPE_WRITE } from "../src/auth/scopes.js";
import { TokenRepo } from "../src/repos/tokens.js";
import { AzureTableStore } from "../src/storage/azure.js";
import { systemClock } from "../src/util/clock.js";

/** Production's storage account (docs/ARCHITECTURE.md §5): never mint there. */
const PRODUCTION_ACCOUNTS = new Set(["zenvicloud"]);

const [userId, outFile, days = "7"] = process.argv.slice(2);
if (!userId || !/^[A-Za-z0-9_-]{3,64}$/.test(userId) || !outFile) throw new Error("usage: mint-token.ts <user id> <out file> [days]");
const envFile = process.env.ENV_FILE;
if (!envFile) throw new Error("ENV_FILE must name the lab's env file (AZURE_STORAGE_CONNECTION_STRING=…)");
// The value contains ';': read the line verbatim.
const connection = /^AZURE_STORAGE_CONNECTION_STRING=(.+)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim();
if (!connection) throw new Error(`no AZURE_STORAGE_CONNECTION_STRING in ${envFile}`);
const account = /(?:^|;)AccountName=([^;]+)/.exec(connection)?.[1] ?? "";
if (PRODUCTION_ACCOUNTS.has(account.toLowerCase())) throw new Error(`refusing to mint a token in production storage (${account})`);

const tokens = new TokenRepo(new AzureTableStore(connection), systemClock);
const { token, info } = await tokens.createPat({ userId, name: "lab", scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: Number(days) });
writeFileSync(outFile, `ZENVI_TOKEN=${token}\n`, { mode: 0o600 });
console.log(`token ${info.id} for ${userId} in ${account}, expires ${info.expiresAt ?? "never"}: ${outFile}`);
