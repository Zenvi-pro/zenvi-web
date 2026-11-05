import { useEffect, useState } from "react";
import { buyCredits, stripeCheckoutUrl, type TopUp } from "@/lib/credits";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";

/** Top-up card (zenvi-core#272) under an out-of-credits refusal. Pay is the only thing that charges. */
export function TopUpCard() {
  const [pack, setPack] = useState(10);
  const [quote, setQuote] = useState<TopUp | null>(null);
  const [state, setState] = useState<{ busy?: boolean; done?: string; error?: string }>({});

  useEffect(() => {
    let live = true;
    void buyCredits(10).then((q) => live && (q.error ? setState({ error: q.error }) : setQuote(q)));
    return () => {
      live = false;
    };
  }, []);

  async function pay() {
    setState({ busy: true });
    const result = await buyCredits(pack, true);
    const url = stripeCheckoutUrl(result);
    if (result.error) setState({ error: result.error });
    else if (result.status === "paid") setState({ done: `${(result.credits ?? pack * 100).toLocaleString("en-US")} credits added.` });
    else if (url) {
      window.open(url, "_blank", "noopener");
      setState({ done: "Finish paying in the Stripe tab; your credits appear once it confirms." });
    } else setState({ error: "Could not open Stripe Checkout. Buy at https://zenvi.pro/topup." });
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
        <p className="text-success">{state.done}</p>
      ) : (
        <Button className="w-full" disabled={!quote || state.busy} onClick={() => void pay()}>
          {quote?.mode === "card" && quote.card ? `Pay ${price} with ${quote.card}` : `Pay ${price} on Stripe`}
        </Button>
      )}
      {state.error ? <p className="text-danger">{state.error}</p> : null}
      {!state.done && quote ? (
        <p className="text-fg-subtle">{quote.mode === "card" ? "Charged now to the card on your Zenvi subscription." : "Opens Stripe Checkout; your card is saved for next time."}</p>
      ) : null}
    </div>
  );
}
