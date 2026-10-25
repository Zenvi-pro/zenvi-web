import { isAudioOnlyMedia, isSingleImageMedia, REEL_STYLE_IDS, REEL_STYLES, type ProjectFile, type ReelStyleId } from "@zenvi/engine";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Input";
import { Select } from "@/ui/Select";
import { toast } from "@/ui/Toast";
import { runAssistantTool } from "../assistant/bridge";
import { createToolHost } from "../assistant/host";
import { fileDisplayName } from "../session/media";
import { useSession } from "../session/context";

const LENGTHS = [10, 12, 15, 20, 30, 45, 60] as const;
const AUTO = "auto";
const NONE = "none";

function isVisual(file: ProjectFile): boolean {
  return !isAudioOnlyMedia(file) && (isSingleImageMedia(file) || Boolean(file.has_video));
}

interface Brief {
  format: string;
  story: string;
  pace: string;
  look: string;
}

/**
 * "Make a reel": the engine's build_reel_tool with a form. The clips in the
 * bin are cut to a music file's beats in a style, with a hook title, an end
 * card, camera moves, a look and the music faded out, as one undo step.
 */
export function ReelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const [style, setStyle] = useState<ReelStyleId>("hype");
  const [seconds, setSeconds] = useState<number>(15);
  const [music, setMusic] = useState<string>(AUTO);
  const [hook, setHook] = useState("");
  const [endCard, setEndCard] = useState("");
  const [endSubtitle, setEndSubtitle] = useState("");
  const [busy, setBusy] = useState(false);

  // What the bin holds when the dialog opens.
  const { visuals, songs, hasEdit } = useMemo(() => {
    const files = session.project.files;
    return {
      visuals: files.filter(isVisual),
      songs: files.filter((f) => isAudioOnlyMedia(f)).sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0)),
      hasEdit: session.project.clips.length > 0,
    };
    // Recomputed each time the dialog opens (`open` is the trigger).
  }, [session, open]);

  useEffect(() => {
    if (open) setSeconds(REEL_STYLES[style].defaultSeconds);
    // Only when the dialog opens or the style changes.
  }, [open, style]);

  const musicOptions = [
    { value: AUTO, label: songs.length > 0 ? `Longest track (${fileDisplayName(songs[0]!)})` : "No music in the bin" },
    ...songs.map((f) => ({ value: String(f.id), label: fileDisplayName(f) })),
    { value: NONE, label: "No music (cut to the style's tempo)" },
  ];

  const make = async () => {
    setBusy(true);
    try {
      const args: Record<string, unknown> = { style, duration_seconds: seconds, replace: hasEdit };
      if (hook.trim()) args.hook = hook.trim();
      if (endCard.trim()) args.end_card = endCard.trim();
      if (endSubtitle.trim()) args.end_card_subtitle = endSubtitle.trim();
      if (music !== AUTO && music !== NONE) args.music_file_id = music;
      // "No music": give no music file and build from the visuals only.
      if (music === NONE) args.file_ids = visuals.map((f) => String(f.id));
      const wire = await runAssistantTool(session, createToolHost(session, async () => []), "build_reel_tool", args, new AbortController().signal);
      let summary = wire.result;
      let brief: Brief | undefined;
      try {
        const parsed = JSON.parse(wire.result) as { summary?: string; data?: { brief?: Brief } };
        summary = parsed.summary ?? summary;
        brief = parsed.data?.brief;
      } catch {
        // plain text result
      }
      if (summary.startsWith("Error")) {
        toast.error("Could not make the reel", { description: summary.replace(/^Error:\s*/, "") });
        return;
      }
      toast.success("Reel ready", { description: brief ? `${brief.format} · ${brief.pace}` : summary });
      onClose();
      requestAnimationFrame(() => session.views.timeline?.zoomToFit());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      dismissible={!busy}
      width={640}
      title="Make a reel"
      description="Cuts the videos and photos in your project to the music's beat, with titles, camera moves and a look. One undo step."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={visuals.length === 0} onClick={() => void make()}>
            Make reel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Style" className="grid grid-cols-2 gap-2">
          {REEL_STYLE_IDS.map((id) => {
            const s = REEL_STYLES[id];
            const active = id === style;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStyle(id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  active ? "border-accent bg-accent/[0.1]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
                )}
              >
                <div className="text-sm font-medium text-fg">{s.name}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-fg-subtle">{s.summary}</div>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Length
            <Select ariaLabel="Length" value={seconds} options={LENGTHS.map((n) => ({ value: n, label: `${n} seconds` }))} onChange={setSeconds} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Music
            <Select ariaLabel="Music" value={music} options={musicOptions} onChange={setMusic} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-fg-subtle">
          Opening title
          <TextInput value={hook} maxLength={80} placeholder="2-6 words, e.g. Morning ritual" onChange={(e) => setHook(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            End card
            <TextInput value={endCard} maxLength={80} placeholder="A call to action, a name, a date" onChange={(e) => setEndCard(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Under the end card
            <TextInput value={endSubtitle} maxLength={80} placeholder="Optional" onChange={(e) => setEndSubtitle(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-fg-subtle">
          {visuals.length === 0
            ? "Import videos or photos first."
            : `Uses ${visuals.length} ${visuals.length === 1 ? "clip" : "clips"} in the order of Project files; the last one closes the reel.`}
          {hasEdit ? " It replaces the current edit (Undo brings it back)." : ""}
        </p>
      </div>
    </Dialog>
  );
}
