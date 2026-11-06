import { useEffect, useState } from "react";
import { buyCredits, stripeCheckoutUrl, type TopUp } from "@/lib/credits";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";

type View = { busy?: boolean; done?: string; error?: string; url?: string };

// One charge in flight across cards: a card that mounts while it runs shows it instead of Pay.
// A retry after a lost reply is safe: buy-credits never charges the same pack twice in minutes.
const pending: { run: Promise<TopUp> | null; pack: number } = { run: null, pack: 10 };

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
  const [pack, setPack] = useState(10);
  const [quote, setQuote] = useState<TopUp | null>(null);
  const [state, setState] = useState<View>(pending.run ? { busy: true } : {});

  useEffect(() => {
    let live = true;
    const run = pending.run;
    if (run) void run.then((r) => live && setState(view(r, pending.pack, null)));
    void buyCredits(10).then((q) => live && (q.error ? setState((s) => ({ ...s, error: s.busy ? undefined : q.error })) : setQuote(q)));
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
    pending.pack = pack;
    pending.run = buyCredits(pack, true);
    try {
      setState(view(await pending.run, pack, tab));
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
      ) : state.busy ? (
        <p className="text-fg-subtle">Paying…</p>
      ) : quote ? (
        <Button className="w-full" onClick={() => void pay()}>
          {quote.mode === "card" && quote.card ? `Pay ${price} with ${quote.card}` : `Pay ${price} on Stripe`}
        </Button>
      ) : (
        <a href={`https://zenvi.pro/topup?pack=${pack}`} target="_blank" rel="noopener noreferrer" className="block text-center underline">
          Buy on zenvi.pro
        </a>
      )}
      {state.error ? <p className="text-danger">{state.error}</p> : null}
      {!state.done && !state.busy && quote ? (
        <p className="text-fg-subtle">{quote.mode === "card" ? "Charged now to the card on your Zenvi subscription." : "Opens Stripe Checkout; your card is saved for next time."}</p>
      ) : null}
    </div>
  );
}
