import { Eye, EyeOff, MailCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { safeNext, signInWithOAuth, signInWithPassword, signUp, useAuth } from "@/lib/auth";
import { GitHubIcon, GoogleIcon } from "@/ui/BrandIcons";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Input";
import { Spinner } from "@/ui/Spinner";
import { AuthLayout } from "./AuthLayout";

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid login credentials/i.test(message)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first. We sent you a link.";
  return message || "Something went wrong. Try again.";
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"signin" | "signup">(params.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"password" | "github" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  // Signed in (also right after an OAuth redirect lands here): go on.
  useEffect(() => {
    if (status === "signed-in") navigate(next, { replace: true });
  }, [status, next, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setBusy("password");
    try {
      if (mode === "signin") {
        await signInWithPassword(email, password);
      } else if (await signUp(email, password)) {
        setVerifyEmail(email.trim());
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const oauth = async (provider: "github" | "google") => {
    setError(null);
    setBusy(provider);
    try {
      await signInWithOAuth(provider, next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  if (status === "disabled") {
    return (
      <AuthLayout>
        <h1 className="text-xl font-semibold tracking-tight">Sign-in is off in this build</h1>
        <p className="mt-2 text-md text-fg-subtle">
          You can keep editing: projects and media are saved in this browser. Cloud sync and the Assistant need an account.
        </p>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="white" size="lg">
            Back to projects
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  if (status === "loading" || status === "signed-in") {
    return (
      <AuthLayout>
        <div className="flex items-center gap-3 text-fg-subtle">
          <Spinner /> Signing you in…
        </div>
      </AuthLayout>
    );
  }

  if (verifyEmail) {
    return (
      <AuthLayout>
        <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
          <MailCheck size={22} className="text-accent-hover" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-md text-fg-subtle">
          We sent a confirmation link to <span className="text-fg">{verifyEmail}</span>. Open it, then sign in here.
        </p>
        <Button
          variant="secondary"
          size="lg"
          className="mt-6 w-full"
          onClick={() => {
            setVerifyEmail(null);
            setMode("signin");
          }}
        >
          Back to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold tracking-tight">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-1 text-sm text-fg-subtle">
        {mode === "signin" ? "Sign in to sync projects and use the Zenvi Assistant." : "One account for zenvi.pro, the desktop app and the web editor."}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-2.5" noValidate>
        <label className="block">
          <span className="sr-only">Email</span>
          <TextInput
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-10 text-md"
          />
        </label>
        <label className="relative block">
          <span className="sr-only">Password</span>
          <TextInput
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder={mode === "signin" ? "Password" : "Password (8+ characters)"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-10 pr-10 text-md"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:text-fg"
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </label>
        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="white" size="lg" className="w-full" loading={busy === "password"} disabled={!email || !password || busy !== null}>
          {mode === "signin" ? "Continue" : "Create account"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line-strong" />
        <span className="text-2xs uppercase tracking-wider text-fg-faint">or</span>
        <span className="h-px flex-1 bg-line-strong" />
      </div>

      <div className="space-y-2">
        <Button variant="accent-outline" size="lg" className="w-full font-normal" onClick={() => oauth("github")} loading={busy === "github"} disabled={busy !== null} icon={<GitHubIcon />}>
          Continue with GitHub
        </Button>
        <Button variant="accent-outline" size="lg" className="w-full font-normal" onClick={() => oauth("google")} loading={busy === "google"} disabled={busy !== null} icon={<GoogleIcon />}>
          Continue with Google
        </Button>
      </div>

      <p className="mt-6 text-center text-sm text-fg-subtle">
        {mode === "signin" ? "New to Zenvi?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="font-medium text-fg hover:text-accent-hover"
          onClick={() => {
            setError(null);
            setMode((m) => (m === "signin" ? "signup" : "signin"));
          }}
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
      <p className="mt-2 text-center text-sm">
        <Link to="/" className="text-fg-subtle hover:text-fg">
          Continue without an account
        </Link>
      </p>
    </AuthLayout>
  );
}
