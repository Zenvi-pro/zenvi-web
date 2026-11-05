import { useEffect, useState } from "react";
import { buyCredits, stripeCheckoutUrl, type TopUp } from "@/lib/credits";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";

// One payment at a time across remounts: a card that unmounts mid-charge must not let a new one charge again.
// The attempt id is the charge's idempotency key, so a retry after an unknown outcome replays it.
const pending: { attempt: string; run: Promise<TopUp> | null } = { attempt: crypto.randomUUID(), run: null };

/** Top-up card (zenvi-core#272) under an out-of-credits refusal. Pay is the only thing that charges. */
export function TopUpCard() {
  const [pack, setPack] = useState(10);
  const [quote, setQuote] = useState<TopUp | null>(null);
  const [state, setState] = useState<{ busy?: boolean; done?: string; error?: string; url?: string }>({});

  function settle(result: TopUp, tab: Window | null) {
    const url = stripeCheckoutUrl(result);
    if (result.error) {
      tab?.close();
      setState({ error: result.error });
      return;
    }
    pending.attempt = crypto.randomUUID();
    if (result.status === "paid") {
      tab?.close();
      setState({ done: `${(result.credits ?? pack * 100).toLocaleString("en-US")} credits added.` });
    } else if (url && tab) {
      tab.location.href = url;
      setState({ done: "Finish paying in the Stripe tab; your credits appear once it confirms." });
    } else if (url) {
      setState({ url, done: "Open Stripe to finish paying." });
    } else {
      tab?.close();
      setState({ done: "Your bank is processing the payment; the credits appear once it confirms." });
    }
  }

  useEffect(() => {
    let live = true;
    if (pending.run) {
      setState({ busy: true });
      void pending.run.then((r) => live && settle(r, null));
    }
    void buyCredits(10).then((q) => live && (q.error ? setState((s) => ({ ...s, error: q.error })) : setQuote(q)));
    return () => {
      live = false;
    };
  }, []);

  async function pay() {
    if (pending.run) return;
    // Opened inside the click, before any await: a tab opened after the network round trip is blocked as a popup.
    const tab = quote?.mode === "card" ? null : window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setState({ busy: true });
    pending.run = buyCredits(pack, true, pending.attempt);
    try {
      settle(await pending.run, tab);
    } finally {
      pending.run = null;
    }
  }

  const price = `${quote?.currency === "cad" ? "CA$" : "$"}${pack}`;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-white/[0.02] p-3 text-xs">
      <p className="font-medium text-fg">Add credits</p>
      <div className="flex gap-1.5">
        {[5, 10, 15].map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === pack}
            disabled={Boolean(state.done || state.busy)}
            onClick={() => setPack(p)}
            className={cn("flex-1 rounded-md border px-2 py-1.5", p === pack ? "border-accent text-fg" : "border-line text-fg-muted")}
          >
            ${p} · {(p * 100).toLocaleString("en-US")} credits
          </button>
        ))}
      </div>
      {state.done ? (
        <p className="text-success">
          {state.done}{" "}
          {state.url ? (
            <a href={state.url} target="_blank" rel="noopener noreferrer" className="underline">
              Open Stripe
            </a>
          ) : null}
        </p>
      ) : quote ? (
        <Button className="w-full" disabled={state.busy} onClick={() => void pay()}>
          {quote.mode === "card" && quote.card ? `Pay ${price} with ${quote.card}` : `Pay ${price} on Stripe`}
        </Button>
      ) : (
        <a href={`https://zenvi.pro/topup?pack=${pack}`} target="_blank" rel="noopener noreferrer" className="block text-center underline">
          Buy on zenvi.pro
        </a>
      )}
      {state.error ? <p className="text-danger">{state.error}</p> : null}
      {!state.done && quote ? (
        <p className="text-fg-subtle">{quote.mode === "card" ? "Charged now to the card on your Zenvi subscription." : "Opens Stripe Checkout; your card is saved for next time."}</p>
      ) : null}
    </div>
  );
}
