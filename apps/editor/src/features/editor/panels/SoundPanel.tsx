import { SFX_RECIPES, type SfxFamily, type SfxIntensity, type SfxRecipe } from "@zenvi/engine";
import { AudioLines, Play, Plus, Square, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/Controls";
import { cn } from "@/ui/cn";
import { SearchInput } from "@/ui/Input";
import { editorToolState, runToolWithToast } from "../editorTools";
import { useSession } from "../session/context";
import { runMakeItSnappy } from "../snappy";
import { runSoundDesign } from "../soundDesign";
import { audition, stopAudition } from "./audition";
import { PanelHeader, Segmented } from "./PanelChrome";

const FAMILIES: { id: SfxFamily | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "whoosh", label: "Whooshes" },
  { id: "impact", label: "Hits" },
  { id: "riser", label: "Risers" },
  { id: "transition", label: "Transitions" },
  { id: "click", label: "Clicks" },
  { id: "ui", label: "UI" },
  { id: "texture", label: "Textures" },
];

function SfxRow({ recipe, playing, onPlay, onAdd }: { recipe: SfxRecipe; playing: boolean; onPlay: () => void; onAdd: () => void }) {
  return (
    <li className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/[0.04]" title={recipe.use}>
      <IconButton size="sm" label={playing ? `Stop ${recipe.title}` : `Play ${recipe.title}`} active={playing} onClick={onPlay}>
        {playing ? <Square size={12} /> : <Play size={13} />}
      </IconButton>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg">{recipe.title}</p>
        <p className="truncate text-2xs text-fg-faint">
          {recipe.family} · {recipe.duration.default.toFixed(1)} s
        </p>
      </div>
      <IconButton size="sm" label={`Add ${recipe.title} at the playhead`} onClick={onAdd} className="opacity-60 group-hover:opacity-100">
        <Plus size={14} />
      </IconButton>
    </li>
  );
}

/** Sound: one-step sound design and mastering, and the SFX library to audition and place by hand. */
export function SoundPanel() {
  const session = useSession();
  const [intensity, setIntensity] = useState<SfxIntensity>("normal");
  const [family, setFamily] = useState<SfxFamily | "all">("all");
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<"design" | "master" | "snappy" | null>(null);
  const master = editorToolState("master_audio_tool");

  useEffect(() => stopAudition, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SFX_RECIPES.filter((r) => (family === "all" || r.family === family) && (!q || `${r.title} ${r.id} ${r.family} ${r.use}`.toLowerCase().includes(q)));
  }, [family, query]);

  const play = (recipe: SfxRecipe) => {
    if (playing === recipe.id) {
      stopAudition();
      setPlaying(null);
      return;
    }
    setPlaying(recipe.id);
    audition(recipe.id, () => setPlaying((p) => (p === recipe.id ? null : p)));
  };

  const add = (recipe: SfxRecipe) =>
    void runToolWithToast(session, "add_sfx_tool", { recipe: recipe.id, at_seconds: session.playback.getState().time, align: "peak" }, { done: `${recipe.title} added`, failed: `Could not add ${recipe.title}` });

  const busyWhile = async (what: NonNullable<typeof busy>, run: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Sound" />
      <section aria-label="Sound design" className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2.5">
        <p className="text-xs text-fg-subtle">Whooshes on cuts and transitions, hits on strong cuts and flashes, clicks on titles, a riser into the climax.</p>
        <Segmented<SfxIntensity>
          label="Sound design intensity"
          value={intensity}
          onChange={setIntensity}
          options={[
            { value: "subtle", label: "Subtle" },
            { value: "normal", label: "Normal" },
            { value: "hype", label: "Hype" },
          ]}
        />
        <div className="flex gap-1.5">
          <Button size="sm" variant="primary" className="flex-1" icon={<AudioLines size={14} />} loading={busy === "design"} onClick={() => void busyWhile("design", () => runSoundDesign(session, intensity))}>
            Add sound design
          </Button>
          <Button size="sm" icon={<Zap size={14} />} loading={busy === "snappy"} onClick={() => void busyWhile("snappy", () => runMakeItSnappy(session, { intensity }))}>
            Make it snappy
          </Button>
        </div>
        {master.kind === "ready" ? (
          <Button
            size="sm"
            loading={busy === "master"}
            onClick={() => void busyWhile("master", () => runToolWithToast(session, "master_audio_tool", { preset: "social" }, { done: "Mastered for social", failed: "Could not master the mix" }))}
          >
            Master for social (-14 LUFS)
          </Button>
        ) : null}
      </section>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-2.5">
        <SearchInput value={query} onValueChange={setQuery} placeholder={`Search ${SFX_RECIPES.length} sounds`} aria-label="Search sounds" />
        <div role="radiogroup" aria-label="Sound family" className="flex flex-wrap gap-1">
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={family === f.id}
              onClick={() => setFamily(f.id)}
              className={cn(
                "h-6 rounded-full px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                family === f.id ? "bg-white/[0.12] text-fg" : "bg-white/[0.04] text-fg-subtle hover:text-fg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ul aria-label="Sound effects" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {list.map((r) => (
          <SfxRow key={r.id} recipe={r} playing={playing === r.id} onPlay={() => play(r)} onAdd={() => add(r)} />
        ))}
        {list.length === 0 ? <li className="py-8 text-center text-xs text-fg-subtle">No sounds match.</li> : null}
      </ul>
    </div>
  );
}
