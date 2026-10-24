import { BadgeCheck, Check, Link2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { cloudClient, type ConsentInfo } from "@/lib/cloud";
import { Button } from "@/ui/Button";
import { ZenviMark } from "@/ui/Logo";
import { Spinner } from "@/ui/Spinner";
import { AuthLayout } from "./AuthLayout";

export function ConnectPage() {
  const [params] = useSearchParams();
  const requestId = params.get("request") ?? "";
  const status = useAuth((s) => s.status);
  const email = useAuth((s) => s.user?.email);
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) {
      setLoadError("This link is missing its request. Start the connection again from the app.");
      return;
    }
    let cancelled = false;
    cloudClient()
      .consentInfo(requestId)
      .then((i) => !cancelled && setInfo(i))
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const decide = async (approve: boolean) => {
    setError(null);
    setBusy(approve ? "approve" : "deny");
    try {
      const { redirect } = await cloudClient().consent(requestId, approve);
      window.location.assign(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const aside = (
    <>
      <p className="font-serif text-4xl leading-[1.05] text-fg">Bring Zenvi into your chat.</p>
      <p className="mt-2 max-w-sm text-md text-fg-subtle">
        Connectors let ChatGPT or Claude edit your cloud projects and render videos for you. You can disconnect any time.
      </p>
    </>
  );

  const next = `/connect?request=${encodeURIComponent(requestId)}`;

  return (
    <AuthLayout aside={aside}>
      {loadError ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight">This connection link doesn&apos;t work</h1>
          <p className="mt-2 text-md text-fg-subtle">{loadError}</p>
          <Link to="/" className="mt-6 inline-block">
            <Button variant="secondary" size="lg">
              Go to projects
            </Button>
          </Link>
        </>
      ) : !info ? (
        <div className="flex items-center gap-2 text-fg-subtle">
          <Spinner /> Loading…
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-elevated text-fg">
              <ZenviMark size={20} />
            </div>
            <Link2 size={16} className="text-fg-faint" />
            {info.logoUri ? (
              <img src={info.logoUri} alt="" className="h-11 w-11 rounded-lg border border-line-strong bg-elevated object-contain p-1.5" referrerPolicy="no-referrer" />
            ) : (
              <div className="inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-elevated px-3 text-md font-semibold text-fg">
                {info.clientName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Connect <span className="text-accent-hover">{info.clientName}</span> to Zenvi
          </h1>
          {info.verifiedHost ? (
            <p className="mt-1 inline-flex items-center gap-1 text-sm text-success">
              <BadgeCheck size={14} /> Verified by {info.verifiedHost}
            </p>
          ) : null}
          {info.redirectHost ? (
            <p className="mt-1 text-sm text-fg-subtle">
              You&apos;ll return to <span className="font-mono text-fg-muted">{info.redirectHost}</span>
            </p>
          ) : null}

          <p className="mt-6 text-sm text-fg-subtle">It will be able to:</p>
          <ul className="mt-2 space-y-2.5">
            {(info.scopes.length ? info.scopes : [{ name: "zenvi", description: "Edit your Zenvi Cloud projects and render videos" }]).map((scope) => (
              <li key={scope.name} className="flex items-start gap-2.5 text-md text-fg-muted">
                <Check size={16} className="mt-0.5 shrink-0 text-success" />
                {scope.description || scope.name}
              </li>
            ))}
          </ul>

          {status === "loading" ? (
            <div className="mt-8 flex items-center gap-2 text-fg-subtle">
              <Spinner /> Checking your session…
            </div>
          ) : status !== "signed-in" ? (
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="mt-8 block">
              <Button variant="white" size="lg" className="w-full">
                Sign in to continue
              </Button>
            </Link>
          ) : (
            <div className="mt-8 space-y-3">
              {error ? (
                <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" onClick={() => decide(false)} loading={busy === "deny"} disabled={busy !== null}>
                  Deny
                </Button>
                <Button variant="white" size="lg" className="flex-1" onClick={() => decide(true)} loading={busy === "approve"} disabled={busy !== null}>
                  Allow
                </Button>
              </div>
              <p className="flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
                <ShieldCheck size={13} /> Signed in as <span className="text-fg-muted">{email}</span>
              </p>
            </div>
          )}
        </>
      )}
    </AuthLayout>
  );
}
