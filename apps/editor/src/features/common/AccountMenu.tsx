import { LogIn, LogOut, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { avatarUrl, displayName, signOut, useAuth } from "@/lib/auth";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { DropdownMenu } from "@/ui/Menu";
import { toast } from "@/ui/Toast";

export function Avatar({ size = 26, className }: { size?: number; className?: string }) {
  const user = useAuth((s) => s.user);
  const url = avatarUrl(user);
  const name = displayName(user);
  return url ? (
    <img src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" className={cn("shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-accent text-2xs font-semibold uppercase text-white",
        className,
      )}
    >
      {name.slice(0, 1) || <User size={13} />}
    </span>
  );
}

export function AccountMenu({ compact }: { compact?: boolean }) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  if (status === "disabled") return null;
  if (status !== "signed-in") {
    return (
      <Button
        variant="secondary"
        size={compact ? "sm" : "md"}
        icon={<LogIn size={14} />}
        onClick={() => navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)}
        disabled={status === "loading"}
      >
        Sign in
      </Button>
    );
  }

  return (
    <DropdownMenu
      align="end"
      trigger={
        <button
          type="button"
          aria-label="Account"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full outline-none ring-offset-1 ring-offset-canvas hover:ring-2 hover:ring-white/15 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar />
        </button>
      }
      items={[
        { type: "label", label: user?.email ?? displayName(user) },
        {
          type: "item",
          label: "Sign out",
          icon: <LogOut size={14} />,
          onSelect: () => {
            signOut()
              .then(() => toast.info("Signed out. Your local projects stay in this browser."))
              .catch((e: unknown) => toast.error("Could not sign out", { description: String(e) }));
          },
        },
      ]}
    />
  );
}
