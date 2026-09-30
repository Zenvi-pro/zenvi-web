import { ArrowUp, Bot, Check, LogIn, Plus, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { useAuth } from "@/lib/auth";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/Controls";
import { ZenviMark } from "@/ui/Logo";
import { Select } from "@/ui/Select";
import { Spinner } from "@/ui/Spinner";
import { useSession } from "../session/context";
import { toolsAvailable } from "./bridge";
import { Markdown } from "./Markdown";
import { assistantStore, loadModels, newChat, send, setModel, stop, type ChatMessage, type ToolActivity } from "./store";

const SUGGESTIONS = [
  "Trim the first 3 seconds of the first clip",
  "Add a fade in and out to every clip",
  "Make the background music quieter under speech",
  "What's on my timeline?",
];

function ToolRow({ tool }: { tool: ToolActivity }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-line bg-white/[0.02] px-2 py-1.5 text-xs">
      <span className="mt-px shrink-0">
        {tool.status === "running" ? <Spinner size={12} className="text-accent-hover" /> : tool.status === "done" ? <Check size={12} className="text-success" /> : <X size={12} className="text-danger" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-fg-muted">{tool.label}</p>
        {tool.detail ? <p className={cn("line-clamp-2 text-fg-subtle", tool.status === "error" && "text-danger/90")}>{tool.detail}</p> : null}
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent/[0.18] px-3 py-2 text-sm text-fg">{message.text}</div>
      </div>
    );
  }
  if (message.role === "note") {
    return <p className="text-center text-xs text-fg-subtle">{message.text}</p>;
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong bg-elevated text-fg">
        <ZenviMark size={12} />
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed text-fg-muted">
        {message.tools.length > 0 ? (
          <div className="space-y-1">
            {message.tools.map((t) => (
              <ToolRow key={t.callId} tool={t} />
            ))}
          </div>
        ) : null}
        {message.text ? <Markdown text={message.text} /> : null}
        {message.streaming && !message.text ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <Spinner size={12} /> Thinking…
          </span>
        ) : null}
        {message.error ? <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{message.error}</p> : null}
      </div>
    </div>
  );
}

export default function AssistantPanel() {
  const session = useSession();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const store = assistantStore(session);
  const messages = useStore(store, (s) => s.messages);
  const running = useStore(store, (s) => s.running);
  const models = useStore(store, (s) => s.models);
  const modelId = useStore(store, (s) => s.modelId);
  const modelsError = useStore(store, (s) => s.modelsError);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status === "signed-in" && models === null) void loadModels(session);
  }, [status, models, session]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [draft]);

  const submit = (text = draft) => {
    if (!text.trim() || running) return;
    setDraft("");
    void send(session, text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  if (status === "disabled") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Bot size={22} className="text-fg-faint" />
        <p className="text-sm text-fg-muted">The Assistant needs sign-in, which is off in this build.</p>
      </div>
    );
  }

  if (status !== "signed-in") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-elevated text-fg">
          <ZenviMark size={18} />
        </div>
        <div>
          <p className="text-md font-medium text-fg">Edit by asking</p>
          <p className="mt-1 text-xs text-fg-subtle">The Zenvi Assistant cuts, arranges, fades and mixes your timeline for you. Sign in to use it.</p>
        </div>
        <Button variant="white" size="md" icon={<LogIn size={14} />} disabled={status === "loading"} onClick={() => navigate(`/login?next=${encodeURIComponent(window.location.pathname.replace(/^\/editor/, ""))}`)}>
          Sign in
        </Button>
      </div>
    );
  }

  const modelOptions = (models ?? []).map((m) => ({ value: m.model_id, label: m.display_name, hint: m.provider }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        {models === null ? (
          <span className="flex h-7 flex-1 items-center gap-2 px-1 text-xs text-fg-subtle">
            <Spinner size={12} /> Loading models…
          </span>
        ) : modelOptions.length > 0 && modelId ? (
          <Select<string> ariaLabel="Model" value={modelId} options={modelOptions} onChange={(v) => setModel(session, v)} className="min-w-0 flex-1" />
        ) : (
          <span className="flex-1 truncate px-1 text-xs text-fg-subtle" title={modelsError ?? undefined}>
            {modelsError ? "Models unavailable" : "Default model"}
          </span>
        )}
        <IconButton label="New chat" onClick={() => newChat(session)} disabled={messages.length === 0 && !running}>
          <Plus size={15} />
        </IconButton>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-elevated text-fg">
              <ZenviMark size={18} />
            </div>
            <div>
              <p className="text-md font-medium text-fg">What should we edit?</p>
              <p className="mt-1 text-xs text-fg-subtle">Changes land on your timeline as normal edits. Undo works like always.</p>
            </div>
            <div className="flex w-full flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-left text-xs text-fg-muted outline-none transition-colors hover:border-line-strong hover:bg-white/[0.05] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {s}
                </button>
              ))}
            </div>
            {!toolsAvailable() ? <p className="text-2xs text-fg-faint">Editing tools are still rolling out to the web editor; answers work today.</p> : null}
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} message={m} />)
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <div className="flex items-end gap-1.5 rounded-xl border border-line-strong bg-white/[0.03] p-1.5 focus-within:border-accent">
          <textarea
            ref={input}
            value={draft}
            rows={1}
            aria-label="Message the Zenvi Assistant"
            placeholder="Ask Zenvi to edit…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-fg outline-none placeholder:text-fg-faint"
          />
          {running ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => stop(session)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-black outline-none hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!draft.trim()}
              onClick={() => submit()}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white outline-none transition-opacity hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-30"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
        <p className="mt-1 px-1 text-2xs text-fg-faint">Enter to send · Shift+Enter for a new line</p>
      </div>
    </div>
  );
}
