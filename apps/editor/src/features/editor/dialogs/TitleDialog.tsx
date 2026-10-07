import { addTitleClip, buildTitleSvg, titleLines, type TitleFields } from "@zenvi/engine";
import { Bold, Italic, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ColorField } from "@/ui/ColorField";
import { IconButton } from "@/ui/Controls";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Input";
import { Select } from "@/ui/Select";
import { toast } from "@/ui/Toast";
import { overlayTrack } from "../actions/placement";
import { titleTemplates } from "../catalog";
import { useSession, useUi } from "../session/context";
import { EMPTY_SELECTION } from "../session/uiStore";

const FONTS = ["Sans", "Geist", "Serif", "Monospace", "Arial", "Helvetica", "Georgia", "Impact"];
const TITLE_SECONDS = 5;

/**
 * The editable texts of a template: the engine's "Line N" fields
 * (`titleLines`), with repeated placeholders merged into one field —
 * reflection templates (Bar 1) draw the same line twice, mirrored, and both
 * copies must change together.
 */
function templateTexts(svg: string): { originals: string[]; fields: string[] } {
  try {
    const originals = titleLines(svg);
    return { originals, fields: [...new Set(originals.map((t) => t.trim()))] };
  } catch {
    return { originals: [], fields: [] };
  }
}

export function TitleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const initialTemplate = useUi((s) => s.titleTemplate);
  const templates = titleTemplates();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  /** `lines` holds one value per distinct placeholder (`texts.fields`). */
  const [fields, setFields] = useState<TitleFields & { lines: string[] }>({ lines: [], textColor: "#ffffff", fontFamily: "Sans" });
  const [texts, setTexts] = useState<{ originals: string[]; fields: string[] }>({ originals: [], fields: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTemplateId(initialTemplate ?? (templates.find((t) => t.default) ?? templates[0])?.id ?? null);
  }, [open, initialTemplate, templates]);

  const template = templates.find((t) => t.id === templateId);
  useEffect(() => {
    if (!template?.url) {
      setSvg(null);
      return;
    }
    let cancelled = false;
    fetch(template.url)
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;
        const found = templateTexts(text);
        setSvg(text);
        setTexts(found);
        setFields((f) => ({ ...f, lines: found.fields }));
      })
      .catch(() => !cancelled && setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [template?.url]);

  const built = useMemo(() => {
    if (!svg) return { svg: null as string | null, error: null as string | null };
    try {
      // Every copy of a placeholder gets its field's text.
      const lines = texts.originals.map((original) => fields.lines[texts.fields.indexOf(original.trim())] ?? original);
      return { svg: buildTitleSvg(svg, { ...fields, lines }), error: null };
    } catch (error) {
      return { svg: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [svg, fields, texts]);

  const add = async () => {
    if (!built.svg) return;
    setBusy(true);
    try {
      const name = `${(fields.lines[0] || template?.name || "Title").slice(0, 40).trim() || "Title"}.svg`;
      const file = new File([built.svg], name, { type: "image/svg+xml" });
      const [item] = await session.media.importFiles([file]);
      if (!item) throw new Error("Could not store the title.");
      const position = session.playback.getState().time;
      // Over whatever plays then, never stacked on another clip (one undo step, track included).
      const result = session.edit("Add title", (tx) => {
        const added = addTitleClip(tx, { file: item.media, position, duration: TITLE_SECONDS, layer: overlayTrack(tx, position, position + TITLE_SECONDS), title: fields.lines[0] || "Title" });
        // Bytes before the change lands, so the first preview frame has the title.
        session.media.attach(added.file.id, item.spec);
        return added;
      });
      if (result) {
        session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: [result.clip.id] } });
        onClose();
      }
    } catch (error) {
      toast.error("Could not add the title", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const preview = built.svg ?? svg;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Title"
      description="Pick a template, type your text, and add it at the playhead."
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!built.svg} icon={<Type size={14} />} onClick={() => void add()}>
            Add to timeline
          </Button>
        </>
      }
    >
      {templates.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-subtle">Title templates ship with the next engine update.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[1fr_240px]">
          <div className="space-y-3">
            <div className="checker relative aspect-video overflow-hidden rounded-lg border border-line">
              {preview ? <img alt="Title preview" className="absolute inset-0 h-full w-full object-contain" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`} /> : null}
            </div>
            {built.error ? <p className="text-xs text-warning">{built.error.replace(/^not implemented: /, "Not available yet: ")}</p> : null}
            <div className="grid max-h-[180px] grid-cols-4 gap-1.5 overflow-y-auto pr-1">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={t.id === templateId}
                  onClick={() => setTemplateId(t.id)}
                  className={cn("checker relative aspect-video overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-accent", t.id === templateId ? "border-accent" : "border-line hover:border-line-bright")}
                  title={t.name}
                >
                  {t.url ? <img src={t.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain" /> : null}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {fields.lines.map((line, i) => (
              <label key={i} className="block space-y-1">
                <span className="text-xs text-fg-subtle">{fields.lines.length === 1 ? "Text" : `Line ${i + 1}`}</span>
                <TextInput value={line} onChange={(e) => setFields((f) => ({ ...f, lines: f.lines.map((l, n) => (n === i ? e.target.value : l)) }))} />
              </label>
            ))}
            <label className="block space-y-1">
              <span className="text-xs text-fg-subtle">Font</span>
              <div className="flex gap-1">
                <Select<string> ariaLabel="Font" value={fields.fontFamily ?? "Sans"} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(v) => setFields((f) => ({ ...f, fontFamily: v }))} className="min-w-0 flex-1" />
                <IconButton label="Bold" active={fields.bold} onClick={() => setFields((f) => ({ ...f, bold: !f.bold }))}>
                  <Bold size={14} />
                </IconButton>
                <IconButton label="Italic" active={fields.italic} onClick={() => setFields((f) => ({ ...f, italic: !f.italic }))}>
                  <Italic size={14} />
                </IconButton>
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-fg-subtle">Text color</span>
              <ColorField ariaLabel="Text color" value={fields.textColor ?? "#ffffff"} onCommit={(v) => setFields((f) => ({ ...f, textColor: v }))} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-fg-subtle">Background</span>
              <ColorField ariaLabel="Background color" value={fields.backgroundColor ?? "#000000"} onCommit={(v) => setFields((f) => ({ ...f, backgroundColor: v }))} />
            </label>
          </div>
        </div>
      )}
    </Dialog>
  );
}
