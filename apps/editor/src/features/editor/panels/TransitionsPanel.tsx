import { applyTransitionToClip } from "@zenvi/engine";
import { Blend } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/ui/cn";
import { SearchInput } from "@/ui/Input";
import { toast } from "@/ui/Toast";
import { defaultTransitionSeconds, transitions, type TransitionEntry } from "../catalog";
import { beginDrag, endDrag } from "../dnd";
import { useSession, useUi } from "../session/context";
import { EMPTY_SELECTION } from "../session/uiStore";
import { PanelEmpty, PanelHeader, Segmented } from "./PanelChrome";

type Category = "common" | "extra";

function TransitionTile({ entry, onApply }: { entry: TransitionEntry; onApply: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => beginDrag(e, { kind: "transition", maskId: entry.id, name: entry.name })}
      onDragEnd={endDrag}
      onDoubleClick={onApply}
      onKeyDown={(e) => e.key === "Enter" && onApply()}
      title="Drag between two clips, or double-click to fade in the selected clip"
      className="group min-w-0 cursor-grab rounded-lg p-1 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-elevated">
        {entry.url ? (
          <img src={entry.url} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-fg-faint">
            <Blend size={18} />
          </div>
        )}
      </div>
      <p className="mt-1 truncate px-0.5 text-xs text-fg-muted" title={entry.name}>
        {entry.name}
      </p>
    </div>
  );
}

export function TransitionsPanel() {
  const session = useSession();
  const selectedClips = useUi((s) => s.selection.clips);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("common");
  const all = transitions();
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((t) => (q ? t.name.toLowerCase().includes(q) : t.category === category));
  }, [all, query, category]);

  const apply = (entry: TransitionEntry) => {
    const clipId = selectedClips[0];
    if (!clipId) {
      toast.info("Select a clip first", { description: "Or drag the transition between two clips on the timeline." });
      return;
    }
    const t = session.edit(`Add ${entry.name}`, (tx) => applyTransitionToClip(tx, clipId, entry.id, "start", defaultTransitionSeconds()));
    if (t) session.ui.setState({ selection: { ...EMPTY_SELECTION, transitions: [t.id] } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Transitions" />
      {all.length === 0 ? (
        <PanelEmpty icon={<Blend size={22} />} title="Transitions are on their way" body="The transition library ships with the next engine update." />
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-2.5">
            <SearchInput value={query} onValueChange={setQuery} placeholder={`Search ${all.length} transitions`} aria-label="Search transitions" />
            {!query ? (
              <Segmented<Category>
                label="Transition set"
                value={category}
                onChange={setCategory}
                options={[
                  { value: "common", label: "Common" },
                  { value: "extra", label: "All masks" },
                ]}
              />
            ) : null}
          </div>
          <div className={cn("grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1 overflow-y-auto px-2 pb-4")}>
            {list.map((entry) => (
              <TransitionTile key={entry.id} entry={entry} onApply={() => apply(entry)} />
            ))}
            {list.length === 0 ? <p className="col-span-full py-8 text-center text-xs text-fg-subtle">No transitions match.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
