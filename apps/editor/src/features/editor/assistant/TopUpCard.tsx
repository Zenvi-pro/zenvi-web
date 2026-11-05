import { useEffect, useRef, useState } from "react";
import { buyCredits, stripeCheckoutUrl, type TopUp } from "@/lib/credits";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";

type View = { busy?: boolean; done?: string; error?: string; url?: string };

// Kept outside the card so a card that unmounts mid-charge hands its charge to the next one:
// the attempt id (the charge's idempotency key) and its pack survive until the charge settles,
// and a result nobody saw is shown by the next card instead of offering Pay again.
const pending: { attempt: string; pack: number | null; run: Promise<TopUp> | null; unseen: View | null } = {
  attempt: crypto.randomUUID(),
  pack: null,
  run: null,
  unseen: null,
};

function view(result: TopUp, pack: number, tab: Window | null): View {
  const url = stripeCheckoutUrl(result);
  if (result.error) {
    tab?.close();
    return { error: result.error };
  }
  if (result.status === "paid") {
    tab?.close();
    return { done: result.already ? "Already added a moment ago; you were not charged again." : `${(result.credits ?? pack * 100).toLocaleString("en-US")} credits added.` };
  }
  if (url) {
    if (tab && !tab.closed) {
      try {
        tab.location.href = url;
        return { done: "Finish paying in the Stripe tab; your credits appear once it confirms.", url };
      } catch {
        /* the tab went away: fall through to the link */
      }
    }
    return { done: "Open Stripe to finish paying.", url };
  }
  tab?.close();
  return { done: "Your bank is processing the payment; the credits arrive when it clears." };
}

/** Top-up card (zenvi-core#272) under an out-of-credits refusal. Pay is the only thing that charges. */
export function TopUpCard() {
  const [pack, setPack] = useState(pending.pack ?? 10);
  const [quote, setQuote] = useState<TopUp | null>(null);
  const [state, setState] = useState<View>(pending.unseen ?? {});
  const live = useRef(true);

  function show(result: TopUp, chargedPack: number, tab: Window | null) {
    const next = view(result, chargedPack, tab);
    if (!next.error) {
      pending.attempt = crypto.randomUUID(); // settled: the next Pay is a new purchase
      pending.pack = null;
    }
    if (live.current) setState(next);
    else pending.unseen = next;
  }

  useEffect(() => {
    live.current = true;
    pending.unseen = null;
    if (pending.run) {
      setState({ busy: true });
      const run = pending.run;
      void run.then((r) => show(r, pending.pack ?? 10, null));
    }
    void buyCredits(10).then((q) => live.current && (q.error ? setState((s) => ({ ...s, error: q.error })) : setQuote(q)));
    return () => {
      live.current = false;
    };
  }, []);

  async function pay() {
    if (pending.run) return;
    // Opened inside the click, before any await: a tab opened after the network round trip is blocked as a popup.
    const tab = quote?.mode === "card" ? null : window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    const charged = (pending.pack ??= pack); // a retry pays for the same pack
    setState({ busy: true });
    pending.run = buyCredits(charged, true, pending.attempt);
    try {
      show(await pending.run, charged, tab);
    } finally {
      pending.run = null;
    }
  }

  const locked = pending.pack !== null;
  const shown = pending.pack ?? pack;
  const price = `${quote?.currency === "cad" ? "CA$" : "$"}${shown}`;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-white/[0.02] p-3 text-xs">
      <p className="font-medium text-fg">Add credits</p>
      <div className="flex gap-1.5">
        {[5, 10, 15].map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === shown}
            disabled={Boolean(state.done || state.busy || locked)}
            onClick={() => setPack(p)}
            className={cn("flex-1 rounded-md border px-2 py-1.5", p === shown ? "border-accent text-fg" : "border-line text-fg-muted")}
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
        <a href={`https://zenvi.pro/topup?pack=${shown}`} target="_blank" rel="noopener noreferrer" className="block text-center underline">
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
