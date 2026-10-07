import { addEffect } from "@zenvi/engine";
import { AudioLines, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/ui/cn";
import { SearchInput } from "@/ui/Input";
import { toast } from "@/ui/Toast";
import { effectIconUrl, effects, type EffectEntry } from "../catalog";
import { beginDrag, endDrag } from "../dnd";
import { useSession, useUi } from "../session/context";
import { EMPTY_SELECTION } from "../session/uiStore";
import { PanelEmpty, PanelHeader, Segmented } from "./PanelChrome";

type Category = "video" | "audio";

function EffectRow({ effect, onApply }: { effect: EffectEntry; onApply: () => void }) {
  const icon = effectIconUrl(effect.className);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={effect.supported}
      onDragStart={(e) => beginDrag(e, { kind: "effect", className: effect.className, name: effect.name })}
      onDragEnd={endDrag}
      onDoubleClick={onApply}
      onKeyDown={(e) => e.key === "Enter" && onApply()}
      title={effect.supported ? "Drag onto a clip, or double-click to add it to the selected clip" : "Needs the desktop app (OpenCV)"}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
        effect.supported ? "cursor-grab hover:bg-white/[0.05] active:cursor-grabbing" : "opacity-45",
      )}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md bg-elevated text-fg-subtle">
        {icon ? <img src={icon} alt="" className="h-full w-full object-cover" draggable={false} /> : effect.category === "audio" ? <AudioLines size={16} /> : <Sparkles size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{effect.name}</p>
        <p className="line-clamp-2 text-xs leading-snug text-fg-subtle">{effect.supported ? effect.description : "Desktop only"}</p>
      </div>
    </div>
  );
}

export function EffectsPanel() {
  const session = useSession();
  const selectedClips = useUi((s) => s.selection.clips);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("video");
  const all = effects();
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => e.category === category && (!q || `${e.name} ${e.description}`.toLowerCase().includes(q)));
  }, [all, query, category]);

  const apply = (effect: EffectEntry) => {
    if (!effect.supported) return;
    if (selectedClips.length === 0) {
      toast.info("Select a clip first", { description: `Or drag ${effect.name} onto a clip in the timeline.` });
      return;
    }
    const added = session.edit(`Add ${effect.name}`, (tx) => selectedClips.map((id) => addEffect(tx, id, effect.className)));
    if (added?.length) session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: selectedClips, effect: added[0]!.id }, rightTab: "properties" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Effects" />
      {all.length === 0 ? (
        <PanelEmpty icon={<Sparkles size={22} />} title="Effects are on their way" body="The effects library ships with the next engine update." />
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-2.5">
            <SearchInput value={query} onValueChange={setQuery} placeholder="Search effects" aria-label="Search effects" />
            <Segmented<Category>
              label="Effect type"
              value={category}
              onChange={setCategory}
              options={[
                { value: "video", label: "Video" },
                { value: "audio", label: "Audio" },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
            {list.map((effect) => (
              <EffectRow key={effect.className} effect={effect} onApply={() => apply(effect)} />
            ))}
            {list.length === 0 ? <p className="py-8 text-center text-xs text-fg-subtle">No effects match.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
