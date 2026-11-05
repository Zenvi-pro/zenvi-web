/**
 * Read-only credit checks, the same Supabase RPCs the desktop uses
 * (zenvi-core src/classes/credits_client.py `balance`, `_check_operation_rpc`).
 * Charging happens on the backend; the editor only warns before spending.
 */
import { getSupabase } from "./auth";

function row(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) return (result[0] as Record<string, unknown> | undefined) ?? {};
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

/** Credits left, or null when signed out or unknown. */
export async function creditBalance(): Promise<number | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_credits_balance", {});
  if (error) return null;
  const total = Number(row(data).total_points);
  return Number.isFinite(total) ? total : null;
}

export interface OperationCheck {
  allowed: boolean;
  balance: number;
  required: number;
  /** Why the operation is blocked (tier caps, pay-as-you-go off…). */
  reason: string | null;
}

/** `check_operation_allowed` for an operation like "video_generation". */
export async function checkOperation(operation: string, units = 1, durationSeconds?: number): Promise<OperationCheck | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const payload: Record<string, unknown> = { p_operation: operation, p_units: units };
  if (durationSeconds !== undefined) payload.p_duration_seconds = durationSeconds;
  const { data, error } = await supabase.rpc("check_operation_allowed", payload);
  if (error) return null;
  const r = row(data);
  return {
    allowed: Boolean(r.allowed),
    balance: Number(r.balance) || 0,
    required: Number(r.required) || 0,
    reason: typeof r.block_reason === "string" && r.block_reason ? r.block_reason : null,
  };
}

/** Zenvi's own credit refusals (backend credit_gate 402, the desktop's tool refusal), not a provider's balance. */
export const OUT_OF_CREDITS = /out of credits|insufficient credits/i;

export interface TopUp {
  mode?: "card" | "checkout";
  card?: string | null;
  pack?: number;
  credits?: number;
  amount?: number;
  currency?: string;
  status?: "paid" | "checkout";
  url?: string;
  balance?: number;
  error?: string;
}

/** A $5/$10/$15 top-up (zenvi-pro buy-credits, zenvi-core#272): a quote, or with confirm the charge / Checkout URL. */
export async function buyCredits(pack: number, confirm = false): Promise<TopUp> {
  const supabase = getSupabase();
  if (!supabase) return { error: "Sign in to buy credits." };
  const { data, error } = await supabase.functions.invoke("buy-credits", { body: confirm ? { pack, confirm: true } : { pack } });
  if (error || !data || data.error) return { error: data?.error ?? "Could not start the top-up. Try again, or buy at https://zenvi.pro/topup." };
  return data as TopUp;
}

/** The Checkout URL to open, only when it is Stripe's. */
export function stripeCheckoutUrl(result: TopUp): string | null {
  return typeof result.url === "string" && result.url.startsWith("https://checkout.stripe.com/") ? result.url : null;
}
