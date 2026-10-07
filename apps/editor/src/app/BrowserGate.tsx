import { MonitorSmartphone } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { browserSupport } from "@/lib/capabilities";
import { Button } from "@/ui/Button";
import { ZenviMark } from "@/ui/Logo";

/** Friendly full-page notice instead of a broken editor on unsupported browsers. */
export function BrowserGate({ children }: { children: ReactNode }) {
  const support = browserSupport();
  if (support.missingEssentials.length === 0) return <>{children}</>;
  return (
    <main className="grid h-full place-items-center bg-canvas px-4">
      <div className="flex max-w-lg flex-col items-center text-center">
        <ZenviMark size={26} className="mb-6 text-fg" />
        <MonitorSmartphone size={28} className="mb-4 text-fg-subtle" />
        <h1 className="font-serif text-3xl text-fg">This browser can&apos;t run the editor</h1>
        <p className="mt-3 text-md text-fg-subtle">
          Zenvi needs a current Chrome, Edge, Firefox or Safari on a desktop or laptop. This browser is missing:
        </p>
        <ul className="mt-3 space-y-1 text-sm text-fg-muted">
          {support.missingEssentials.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-fg-subtle">Your projects are safe: they stay in this browser&apos;s storage and in Zenvi Cloud if you synced them.</p>
        <div className="mt-8 flex gap-2">
          <Link to="/">
            <Button variant="white" size="lg">
              Back to projects
            </Button>
          </Link>
          <a href="https://zenvi.pro/download">
            <Button variant="secondary" size="lg">
              Get the desktop app
            </Button>
          </a>
        </div>
      </div>
    </main>
  );
}
