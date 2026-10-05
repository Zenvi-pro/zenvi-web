/**
 * Host tool receipts (SPEC §3.3, contract 3, host flavour): what every
 * `ae_*` / `premiere_*` call returns, from the ExtendScript dispatcher or,
 * for validation/queue failures, from the host server itself.
 */

import type { HostId } from "./catalog/types.js";
import { HOST_RECEIPT_CONTRACT } from "./version.js";

export type HostReceiptStatus = "applied" | "unchanged" | "refused" | "error" | "ok";

export type HostErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "NO_PROJECT"
  | "NO_ACTIVE_COMP"
  | "NO_ACTIVE_SEQUENCE"
  | "UNSUPPORTED"
  | "HOST_ERROR"
  | "TIMEOUT"
  | "BUSY";

export interface HostReceipt {
  contract: typeof HOST_RECEIPT_CONTRACT;
  status: HostReceiptStatus;
  tool: string;
  host: HostId;
  /** Starts with "Error: " for refused / error. */
  summary: string;
  data: Record<string, unknown>;
  warnings: string[];
  /** Undo steps the call added; null when the host cannot tell (Premiere Pro). */
  undoSteps: number | null;
  error?: { code: HostErrorCode; message: string; line?: number };
}

const STATUSES: readonly string[] = ["applied", "unchanged", "refused", "error", "ok"];

/** A receipt from structuredContent or the JSON text block, or undefined. */
export function parseHostReceipt(value: unknown): HostReceipt | undefined {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== "object") return undefined;
  const receipt = candidate as Partial<HostReceipt>;
  if (receipt.contract !== HOST_RECEIPT_CONTRACT || typeof receipt.status !== "string" || !STATUSES.includes(receipt.status)) return undefined;
  if (typeof receipt.tool !== "string" || typeof receipt.summary !== "string") return undefined;
  return receipt as HostReceipt;
}

/** refused or error. */
export function isFailedReceipt(receipt: Pick<HostReceipt, "status">): boolean {
  return receipt.status === "refused" || receipt.status === "error";
}
