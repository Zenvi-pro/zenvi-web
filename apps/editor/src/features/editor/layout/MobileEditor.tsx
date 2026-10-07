import { ChevronLeft, Monitor } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { ZenviMark } from "@/ui/Logo";
import { PreviewPanel } from "../preview/PreviewPanel";
import { useSession } from "../session/context";

/** Phones get a view-only editor: preview and playback, no timeline editing. */
export function MobileEditor() {
  const session = useSession();
  const navigate = useNavigate();
  const name = useStore(session.meta, (m) => m.name);
  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
        <button
          type="button"
          aria-label="All projects"
          onClick={() => navigate("/")}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronLeft size={18} />
        </button>
        <ZenviMark size={16} className="text-fg" />
        <h1 className="min-w-0 flex-1 truncate text-md font-medium text-fg">{name}</h1>
      </header>
      <PreviewPanel />
      <div className="flex shrink-0 items-center gap-3 border-t border-line bg-base px-4 py-3 text-sm text-fg-subtle">
        <Monitor size={16} className="shrink-0" />
        Editing needs a bigger screen. Open this project on a laptop or desktop to cut and arrange it.
      </div>
    </div>
  );
}
