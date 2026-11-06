// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./auth", () => ({ getSupabase: () => ({ functions: { invoke } }) }));

import { buyCredits, OUT_OF_CREDITS, stripeCheckoutUrl } from "./credits";

afterEach(() => invoke.mockReset());

describe("credit top-ups (zenvi-core#272)", () => {
  it("recognises Zenvi's own out-of-credits refusals", () => {
    expect(OUT_OF_CREDITS.test("Out of credits for image generation. Need 3, have 0. Top up at https://zenvi.pro/topup")).toBe(true);
    expect(OUT_OF_CREDITS.test("Insufficient credits (20 remaining, need 300 for video).")).toBe(true);
    expect(OUT_OF_CREDITS.test("Error: clip not found")).toBe(false);
  });

  it("quotes without confirm and charges only with it", async () => {
    invoke.mockResolvedValue({ data: { mode: "card", card: "Visa •4242", pack: 10, credits: 1000, amount: 10, currency: "usd" }, error: null });
    expect(await buyCredits(10)).toMatchObject({ mode: "card" });
    await buyCredits(15, true);
    expect(invoke.mock.calls[0]).toEqual(["buy-credits", { body: { pack: 10 } }]);
    expect(invoke.mock.calls[1]).toEqual(["buy-credits", { body: { pack: 15, confirm: true } }]);
  });

  it("returns the error instead of throwing", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Edge Function returned a non-2xx status code") });
    expect((await buyCredits(5)).error).toBeTruthy();
  });

  it("reads the function's own words from a non-2xx reply", async () => {
    const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response(JSON.stringify({ error: "Your card was declined." }), { status: 500 }) });
    invoke.mockResolvedValue({ data: null, error });
    expect((await buyCredits(5, true)).error).toBe("Your card was declined.");
  });

  it("opens only a Stripe Checkout URL", () => {
    expect(stripeCheckoutUrl({ url: "https://checkout.stripe.com/c/pay/x" })).toBe("https://checkout.stripe.com/c/pay/x");
    expect(stripeCheckoutUrl({ url: "https://evil.example/pay" })).toBeNull();
    expect(stripeCheckoutUrl({})).toBeNull();
  });
});

describe("local testing", () => {
  it("asks for Stripe test keys when VITE_STRIPE_TEST=1", async () => {
    invoke.mockResolvedValue({ data: { mode: "checkout" }, error: null });
    vi.stubEnv("VITE_STRIPE_TEST", "1");
    await buyCredits(5);
    vi.unstubAllEnvs();
    expect(invoke.mock.calls[0]).toEqual(["buy-credits", { body: { pack: 5 }, headers: { "x-stripe-test-mode": "true" } }]);
  });
});
