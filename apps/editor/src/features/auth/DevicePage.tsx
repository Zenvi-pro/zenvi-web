import { CheckCircle2, Terminal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { cloudClient } from "@/lib/cloud";
import { Button } from "@/ui/Button";
import { Spinner } from "@/ui/Spinner";
import { AuthLayout } from "./AuthLayout";

/** Device codes are XXXX-XXXX from an unambiguous alphabet (W7 device flow). */
export function normalizeUserCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export function DevicePage() {
  const [params] = useSearchParams();
  const status = useAuth((s) => s.status);
  const email = useAuth((s) => s.user?.email);
  const [code, setCode] = useState(normalizeUserCode(params.get("code") ?? params.get("user_code") ?? ""));
  const [state, setState] = useState<"idle" | "busy" | "done" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);

  const next = `/device${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  const complete = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);

  // Show which app is asking before the person approves.
  useEffect(() => {
    if (!complete || status !== "signed-in") {
      setClientName(null);
      return;
    }
    let cancelled = false;
    cloudClient()
      .deviceInfo(code)
      .then((info) => !cancelled && setClientName(info.clientName))
      .catch(() => !cancelled && setClientName(null));
    return () => {
      cancelled = true;
    };
  }, [code, complete, status]);

  const decide = async (approve: boolean) => {
    if (!complete) return;
    setError(null);
    setState("busy");
    try {
      await cloudClient().approveDevice(code, approve);
      setState(approve ? "done" : "denied");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };

  const approve = (e: FormEvent) => {
    e.preventDefault();
    void decide(true);
  };

  const aside = (
    <>
      <p className="font-serif text-4xl leading-[1.05] text-fg">Connect a device.</p>
      <p className="mt-2 max-w-sm text-md text-fg-subtle">
        Approving signs the <span className="font-mono text-fg-muted">zenvi</span> CLI or the desktop app into your account.
      </p>
    </>
  );

  if (state === "denied") {
    return (
      <AuthLayout aside={aside}>
        <h1 className="text-xl font-semibold tracking-tight">Sign-in denied</h1>
        <p className="mt-2 text-md text-fg-subtle">Nothing was connected. You can close this tab.</p>
      </AuthLayout>
    );
  }

  if (state === "done") {
    return (
      <AuthLayout aside={aside}>
        <CheckCircle2 size={32} className="mb-4 text-success" />
        <h1 className="text-xl font-semibold tracking-tight">Device connected</h1>
        <p className="mt-2 text-md text-fg-subtle">You can close this tab and return to your terminal.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout aside={aside}>
      <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-elevated">
        <Terminal size={19} className="text-fg-muted" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Approve sign-in</h1>
      <p className="mt-1 text-sm text-fg-subtle">Check that this code matches the one shown on your device.</p>

      {status === "loading" ? (
        <div className="mt-6 flex items-center gap-2 text-fg-subtle">
          <Spinner /> Checking your session…
        </div>
      ) : status !== "signed-in" ? (
        <div className="mt-6 space-y-3">
          <p className="rounded-md border border-line-strong bg-elevated px-3 py-2.5 font-mono text-lg tracking-[0.2em] text-fg">
            {code || "—"}
          </p>
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="block">
            <Button variant="white" size="lg" className="w-full">
              Sign in to approve
            </Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={approve} className="mt-6 space-y-3">
          <input
            aria-label="Device code"
            value={code}
            onChange={(e) => setCode(normalizeUserCode(e.target.value))}
            placeholder="XXXX-XXXX"
            autoFocus={!code}
            spellCheck={false}
            autoCapitalize="characters"
            className="h-12 w-full rounded-md border border-line-strong bg-white/[0.03] px-3 text-center font-mono text-xl tracking-[0.3em] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
          {clientName ? (
            <p className="text-center text-sm text-fg-muted">
              <span className="font-medium text-fg">{clientName}</span> wants to sign in to your account.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" className="flex-1" disabled={!complete || state === "busy"} onClick={() => void decide(false)}>
              Deny
            </Button>
            <Button type="submit" variant="white" size="lg" className="flex-1" disabled={!complete} loading={state === "busy"}>
              Approve
            </Button>
          </div>
          <p className="text-center text-xs text-fg-subtle">
            Signed in as <span className="text-fg-muted">{email}</span>. Didn&apos;t start this? Close this tab.
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
