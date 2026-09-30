/**
 * Device authorization grant (RFC 8628) for the `zenvi` CLI and the desktop
 * app: the device shows a short code, the person approves it on
 * `${editor}/device` while signed in to zenvi.pro, the device polls and
 * receives a personal access token (`zvn_pat_…`).
 *
 * One `devicecodes` row per request, keyed by the user code. The device code
 * is `<user code>.<32 random bytes>`; only its SHA-256 is stored, so the row
 * can be found from either code with a point read.
 */

import { AlreadyExistsError, ApiError, badRequest, conflict, notFound, PreconditionFailedError } from "../http/errors.js";
import type { TableEntity, TableStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomSecret, randomUserCode, safeEqual, sha256Hex, USER_CODE_ALPHABET } from "../util/crypto.js";
import { RESOURCE_SCOPES } from "../auth/scopes.js";
import type { TokenRepo } from "../repos/tokens.js";

const TABLE = "devicecodes" as const;
const PK = "d";
export const DEVICE_CODE_TTL_SECONDS = 900;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

type DeviceStatus = "pending" | "approved" | "denied" | "consumed";

interface DeviceRow extends TableEntity {
  deviceHash: string;
  clientName: string;
  status: DeviceStatus;
  userId?: string;
  email?: string;
  createdAt: string;
  expiresAt: string;
  interval: number;
  lastPolledAt?: string;
  decidedAt?: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

/** RFC 8628 §3.5 poll outcomes. */
export type PollResult =
  | { ok: true; accessToken: string; tokenId: string; userId: string; email?: string; scopes: string[] }
  | { ok: false; error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | "invalid_grant"; description: string };

const USER_CODE = new RegExp(`^[${USER_CODE_ALPHABET}]{8}$`);

/** Accept `bcdf-ghjk`, `BCDF GHJK`, `BCDFGHJK`. Returns the 8 bare characters or null. */
export function normalizeUserCode(input: string): string | null {
  const bare = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return USER_CODE.test(bare) ? bare : null;
}

export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function cleanClientName(name: unknown): string {
  if (typeof name !== "string") return "Zenvi device";
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned === "" ? "Zenvi device" : cleaned.slice(0, 100);
}

export class DeviceService {
  constructor(
    private readonly tables: TableStore,
    private readonly tokens: TokenRepo,
    private readonly clock: Clock,
    private readonly editorUrl: string,
    private readonly patDays: number,
  ) {}

  async start(clientName: unknown): Promise<DeviceCodeResponse> {
    const now = this.clock.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const userCode = randomUserCode();
      const deviceCode = `${userCode}.${randomSecret(32)}`;
      const row: DeviceRow = {
        partitionKey: PK,
        rowKey: userCode,
        deviceHash: sha256Hex(deviceCode),
        clientName: cleanClientName(clientName),
        status: "pending",
        createdAt: isoAt(now),
        expiresAt: isoAt(now + DEVICE_CODE_TTL_SECONDS * 1000),
        interval: DEVICE_POLL_INTERVAL_SECONDS,
      };
      try {
        await this.tables.create(TABLE, row);
      } catch (error) {
        if (!(error instanceof AlreadyExistsError)) throw error;
        // Collision with a live or stale code: replace only a stale one.
        const existing = await this.tables.get<DeviceRow>(TABLE, PK, userCode);
        if (!existing || Date.parse(existing.expiresAt) > now) continue;
        try {
          await this.tables.update(TABLE, row, { etag: existing.etag, mode: "replace" });
        } catch (replaceError) {
          if (replaceError instanceof PreconditionFailedError) continue;
          throw replaceError;
        }
      }
      const display = formatUserCode(userCode);
      return {
        device_code: deviceCode,
        user_code: display,
        verification_uri: `${this.editorUrl}/device`,
        verification_uri_complete: `${this.editorUrl}/device?code=${encodeURIComponent(display)}`,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
        expires_in: DEVICE_CODE_TTL_SECONDS,
      };
    }
    throw new ApiError(503, "busy", "Could not allocate a device code; try again.");
  }

  /** What the approval page shows before the person confirms. */
  async info(userCodeInput: string): Promise<{ userCode: string; clientName: string; status: DeviceStatus; expiresAt: string }> {
    const row = await this.find(userCodeInput);
    return { userCode: formatUserCode(row.rowKey), clientName: row.clientName, status: row.status, expiresAt: row.expiresAt };
  }

  async decide(
    userCodeInput: string,
    user: { userId: string; email?: string },
    approve: boolean,
  ): Promise<{ status: "approved" | "denied"; clientName: string }> {
    const row = await this.find(userCodeInput);
    if (row.status !== "pending") throw conflict("This code was already used. Start the sign-in again on your device.", "code_used");
    const status = approve ? "approved" : "denied";
    try {
      await this.tables.update<DeviceRow>(
        TABLE,
        { ...row, status, userId: user.userId, email: user.email, decidedAt: isoAt(this.clock.now()) },
        { etag: row.etag, mode: "replace" },
      );
    } catch (error) {
      if (error instanceof PreconditionFailedError) throw conflict("This code was already used.", "code_used");
      throw error;
    }
    return { status, clientName: row.clientName };
  }

  /** Token-endpoint poll. Never throws for protocol errors; returns the RFC 8628 error instead. */
  async poll(deviceCode: string): Promise<PollResult> {
    const invalid: PollResult = { ok: false, error: "invalid_grant", description: "Unknown or already used device code." };
    const dot = deviceCode.indexOf(".");
    const userCode = dot === 8 ? deviceCode.slice(0, 8) : "";
    if (!USER_CODE.test(userCode)) return invalid;
    const row = await this.tables.get<DeviceRow>(TABLE, PK, userCode);
    if (!row || !safeEqual(row.deviceHash, sha256Hex(deviceCode))) return invalid;
    const now = this.clock.now();
    if (Date.parse(row.expiresAt) <= now) {
      return { ok: false, error: "expired_token", description: "The code expired. Start the sign-in again." };
    }
    switch (row.status) {
      case "denied":
        return { ok: false, error: "access_denied", description: "The sign-in was declined." };
      case "consumed":
        return invalid;
      case "pending": {
        const tooSoon = row.lastPolledAt !== undefined && now - Date.parse(row.lastPolledAt) < row.interval * 1000;
        const interval = tooSoon ? row.interval + 5 : row.interval;
        await this.tables
          .update<DeviceRow>(TABLE, { partitionKey: PK, rowKey: userCode, lastPolledAt: isoAt(now), interval } as DeviceRow)
          .catch(() => undefined);
        return tooSoon
          ? { ok: false, error: "slow_down", description: `Poll at most every ${interval} seconds.` }
          : { ok: false, error: "authorization_pending", description: "Waiting for approval." };
      }
      case "approved": {
        if (!row.userId) return invalid;
        try {
          await this.tables.update<DeviceRow>(TABLE, { ...row, status: "consumed" }, { etag: row.etag, mode: "replace" });
        } catch (error) {
          if (error instanceof PreconditionFailedError) return invalid;
          throw error;
        }
        const { token, info } = await this.tokens.createPat({
          userId: row.userId,
          email: row.email,
          name: row.clientName,
          scopes: [...RESOURCE_SCOPES],
          ttlDays: this.patDays,
        });
        return { ok: true, accessToken: token, tokenId: info.id, userId: row.userId, email: row.email, scopes: info.scopes };
      }
    }
  }

  private async find(userCodeInput: string): Promise<DeviceRow & { etag: string }> {
    const userCode = normalizeUserCode(userCodeInput);
    if (!userCode) throw badRequest("Enter the 8-letter code shown on your device.", "invalid_code");
    const row = await this.tables.get<DeviceRow>(TABLE, PK, userCode);
    if (!row || Date.parse(row.expiresAt) <= this.clock.now()) throw notFound("Code");
    return row;
  }

  /** Housekeeping: remove codes that expired an hour ago or more. */
  async sweepExpired(): Promise<number> {
    const cutoff = isoAt(this.clock.now() - 3_600_000);
    let removed = 0;
    for await (const row of this.tables.query<DeviceRow>(TABLE, { partitionKey: PK, where: [["expiresAt", "lt", cutoff]] })) {
      if (await this.tables.delete(TABLE, row.partitionKey, row.rowKey)) removed += 1;
    }
    return removed;
  }
}
