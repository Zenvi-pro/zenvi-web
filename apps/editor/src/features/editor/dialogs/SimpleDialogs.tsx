import { setProfile, updateFile, type ProjectFile } from "@zenvi/engine";
import { AlertTriangle, CheckCircle2, FileSearch } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Dialog } from "@/ui/Dialog";
import { SearchInput } from "@/ui/Input";
import { Kbd } from "@/ui/Kbd";
import { toast } from "@/ui/Toast";
import { ProfileDialog } from "@/features/home/FormatPicker";
import { keymap, type EditorCommand } from "../commands";
import { useCommands } from "../layout/commandsContext";
import { useProject, useSession } from "../session/context";
import { fileDisplayName, matchRelinkCandidates } from "../session/media";
import { toolEntries } from "./ToolRunner";

const GROUP_ORDER: EditorCommand["group"][] = ["Playback", "Timeline", "Edit", "Keyframes", "File", "View", "Help"];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUP_ORDER.map((group) => ({
      group,
      items: [...commands.values()].filter((c) => c.group === group && !c.hidden && (keymap.get(c.id)?.length ?? 0) > 0 && (!q || c.label.toLowerCase().includes(q))),
    })).filter((g) => g.items.length > 0);
  }, [commands, query]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Keyboard shortcuts" description="Same defaults as Zenvi on the desktop. ⌘ on macOS, Ctrl elsewhere." width={640}>
      <SearchInput value={query} onValueChange={setQuery} placeholder="Search shortcuts" autoFocus className="mb-4" />
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {groups.map(({ group, items }) => (
          <section key={group}>
            <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">{group}</h3>
            <ul className="space-y-1">
              {items.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-fg-muted">{c.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {(keymap.get(c.id) ?? []).slice(0, 2).map((combo, n) => (
                      <span key={combo} className="flex items-center gap-1.5">
                        {n > 0 ? <span className="text-2xs text-fg-faint">or</span> : null}
                        <Kbd shortcut={combo} />
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

interface PaletteItem {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  run: () => void;
}

/** Engine tools shown once the query matches them (the Assistant's catalog, run by hand). */
const MAX_TOOL_MATCHES = 8;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const commands = useCommands();
  const tools = useMemo(() => toolEntries(), []);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useMemo<PaletteItem[]>(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) => terms.every((t) => text.toLowerCase().includes(t));
    const items: PaletteItem[] = [...commands.values()]
      .filter((c) => !c.hidden && (!c.enabled || c.enabled()) && matches(`${c.label} ${c.group}`))
      .map((c) => ({ id: c.id, label: c.label, group: c.group, shortcut: keymap.get(c.id)?.[0], run: () => c.run() }));
    if (terms.length > 0) {
      const found = tools.filter((t) => matches(`${t.title} ${t.name.replace(/_tool$/, "").replace(/_/g, " ")}`)).slice(0, MAX_TOOL_MATCHES);
      for (const t of found) items.push({ id: `tool:${t.name}`, label: t.title, group: "Tool", run: () => session.ui.setState({ dialog: "tool", toolName: t.name }) });
    }
    return items;
  }, [commands, tools, query, session]);
  const runAt = (index: number) => {
    const item = list[index];
    if (!item) return;
    onClose();
    setTimeout(() => item.run(), 0);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Command palette" width={520} bodyClassName="pb-2">
      <SearchInput
        value={query}
        onValueChange={(v) => {
          setQuery(v);
          setActive(0);
        }}
        placeholder="Type a command or a tool"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(list.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            runAt(active);
          }
        }}
      />
      <ul className="-mx-2 mt-2 max-h-[50vh] overflow-y-auto" role="listbox" aria-label="Commands">
        {list.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => runAt(i)}
              className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm outline-none", i === active ? "bg-accent text-white" : "text-fg-muted")}
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span className={cn("text-xs", i === active ? "text-white/70" : "text-fg-faint")}>{c.group}</span>
              {c.shortcut ? <Kbd shortcut={c.shortcut} /> : null}
            </button>
          </li>
        ))}
        {list.length === 0 ? <li className="px-2 py-6 text-center text-sm text-fg-subtle">No command matches.</li> : null}
      </ul>
    </Dialog>
  );
}

export function ProjectFormatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const current = useProject().profile;
  return (
    <ProfileDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Project format"
      current={current}
      onPick={(profile) => {
        onClose();
        const done = session.edit(`Change format to ${profile.description}`, (tx) => setProfile(tx, profile.key));
        if (done) toast.success(`Format: ${profile.description}`, { description: "Keyframes were rescaled so animations keep their timing." });
      }}
    />
  );
}

export function RelinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const project = useProject();
  const status = useStore(session.media.status);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, "ok" | "mismatch">>({});
  const missing = project.files.filter((f) => status[f.id]?.status === "missing" || status[f.id]?.status === "error");

  const relink = async (picked: File[]) => {
    const matches = matchRelinkCandidates(missing, picked);
    if (matches.size === 0) {
      toast.warning("No names matched", { description: "Pick files with the same names as the missing ones." });
      return;
    }
    setBusy(true);
    const patches: { file: ProjectFile; patch: Partial<ProjectFile> }[] = [];
    const next = { ...results };
    try {
      for (const [fileId, file] of matches) {
        const target = missing.find((f) => f.id === fileId)!;
        const { patch, matchesFingerprint } = await session.media.relink(target, file);
        patches.push({ file: target, patch });
        next[fileId] = matchesFingerprint === false ? "mismatch" : "ok";
      }
      session.edit(patches.length === 1 ? "Relink file" : `Relink ${patches.length} files`, (tx) => patches.map(({ file, patch }) => updateFile(tx, file.id, patch)));
      setResults(next);
      toast.success(`Relinked ${patches.length} file${patches.length > 1 ? "s" : ""}`);
    } catch (error) {
      toast.error("Relink failed", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Find missing media"
      description="This project points at files on another computer. Pick them here and Zenvi matches them by name. Files stay in this browser."
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {missing.length ? "Later" : "Done"}
          </Button>
          <Button variant="primary" loading={busy} disabled={missing.length === 0} icon={<FileSearch size={14} />} onClick={() => input.current?.click()}>
            Choose files…
          </Button>
        </>
      }
    >
      {missing.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-3 text-sm text-success">
          <CheckCircle2 size={16} /> Every file is linked.
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {missing.map((f) => (
            <li key={f.id} className="flex items-center gap-2.5 px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{fileDisplayName(f)}</p>
                <p className="truncate text-xs text-fg-subtle">{String(f.path)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {Object.values(results).includes("mismatch") ? (
        <p className="mt-3 text-xs text-warning">Some picked files differ from the originals (size or content). They are linked anyway; check the timeline.</p>
      ) : null}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void relink(files);
        }}
      />
    </Dialog>
  );
}

export function CloudConflictDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const [busy, setBusy] = useState<"mine" | "theirs" | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="This project changed somewhere else"
      description="Someone (or another device) saved a newer version to Zenvi Cloud while you were editing."
      width={460}
      dismissible={busy === null}
      footer={
        <>
          <Button
            variant="secondary"
            loading={busy === "theirs"}
            disabled={busy !== null}
            onClick={() => {
              setBusy("theirs");
              window.location.reload();
            }}
          >
            Load their version
          </Button>
          <Button
            variant="primary"
            loading={busy === "mine"}
            disabled={busy !== null}
            onClick={() => {
              setBusy("mine");
              void session.saveCloud(true).finally(() => {
                setBusy(null);
                onClose();
              });
            }}
          >
            Keep mine
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-subtle">
        <span className="text-fg-muted">Keep mine</span> replaces the cloud copy with what you see now. <span className="text-fg-muted">Load their version</span> reloads the cloud copy; your local changes since the last sync are discarded.
      </p>
    </Dialog>
  );
}
