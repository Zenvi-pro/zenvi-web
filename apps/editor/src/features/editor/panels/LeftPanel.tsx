import { Blend, Clapperboard, Images, Sparkles, Type, WandSparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { Tooltip } from "@/ui/Tooltip";
import { useSession, useUi } from "../session/context";
import type { LeftTab } from "../session/uiStore";
import { EffectsPanel } from "./EffectsPanel";
import { GeneratePanel } from "./GeneratePanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { StockPanel } from "./StockPanel";
import { TitlesPanel } from "./TitlesPanel";
import { TransitionsPanel } from "./TransitionsPanel";

const TABS: { id: LeftTab; label: string; short: string; icon: ReactNode }[] = [
  { id: "files", label: "Project files", short: "Media", icon: <Clapperboard size={18} /> },
  { id: "effects", label: "Effects", short: "Effects", icon: <Sparkles size={18} /> },
  { id: "transitions", label: "Transitions", short: "Transitions", icon: <Blend size={18} /> },
  { id: "titles", label: "Titles", short: "Text", icon: <Type size={18} /> },
  { id: "stock", label: "Stock media", short: "Stock", icon: <Images size={18} /> },
  { id: "generate", label: "Generate with AI", short: "AI", icon: <WandSparkles size={18} /> },
];

/**
 * `tabs` limits the sections (the chat embed has no Zenvi sign-in, so no
 * stock or AI generation); `labeled` puts a short name under each icon (the
 * embed's rail, where people meet the editor for the first time).
 */
export function LeftPanel({ width, tabs, labeled = false }: { width: number; tabs?: readonly LeftTab[]; labeled?: boolean }) {
  const session = useSession();
  const shown = tabs ? TABS.filter((t) => tabs.includes(t.id)) : TABS;
  const chosen = useUi((s) => s.leftTab);
  const tab = shown.some((t) => t.id === chosen) ? chosen : (shown[0]?.id ?? chosen);
  const collapsed = useUi((s) => s.panels.leftCollapsed);
  const choose = (id: LeftTab) => {
    const panels = session.ui.getState().panels;
    if (id === tab && !collapsed) session.ui.setState({ panels: { ...panels, leftCollapsed: true } });
    else session.ui.setState({ leftTab: id, panels: { ...panels, leftCollapsed: false } });
  };
  return (
    <aside className="flex shrink-0 border-r border-line bg-base" aria-label="Library">
      <nav aria-label="Library sections" className={cn("flex shrink-0 flex-col items-center gap-1 border-r border-line py-2", labeled ? "w-16" : "w-12")}>
        {shown.map((t) => {
          const active = t.id === tab && !collapsed;
          return (
            <Tooltip key={t.id} label={t.label} side="right">
              <button
                type="button"
                aria-label={t.label}
                aria-pressed={active}
                onClick={() => choose(t.id)}
                className={cn(
                  "relative inline-flex items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  labeled ? "h-12 w-14 flex-col gap-0.5" : "h-9 w-9",
                  active ? "bg-white/[0.08] text-fg" : "text-fg-subtle hover:bg-white/[0.05] hover:text-fg-muted",
                )}
              >
                {active ? <span aria-hidden className={cn("absolute top-2 bottom-2 w-[2px] rounded-full bg-accent", labeled ? "-left-[3px]" : "-left-[7px]")} /> : null}
                {t.icon}
                {labeled ? <span className="text-[10px] leading-none">{t.short}</span> : null}
              </button>
            </Tooltip>
          );
        })}
      </nav>
      {width > 0 ? (
        <div className="flex min-w-0 flex-col" style={{ width }}>
          {tab === "files" ? <ProjectFilesPanel /> : null}
          {tab === "effects" ? <EffectsPanel /> : null}
          {tab === "transitions" ? <TransitionsPanel /> : null}
          {tab === "titles" ? <TitlesPanel /> : null}
          {tab === "stock" ? <StockPanel /> : null}
          {tab === "generate" ? <GeneratePanel /> : null}
        </div>
      ) : null}
    </aside>
  );
}
