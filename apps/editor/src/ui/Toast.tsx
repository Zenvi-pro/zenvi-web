import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { cn } from "./cn";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Problems worth reading at a glance (a failed step), one line each, in warning style. */
  issues?: string[];
  /** The long version, collapsed under "Details"; opening it keeps the toast up. */
  details?: string;
  action?: { label: string; onClick: () => void };
  /** Milliseconds; 0 keeps it until dismissed. */
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  push(toast: Omit<ToastItem, "id" | "duration"> & { duration?: number }): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(toast) {
    const id = nextId++;
    const duration = toast.duration ?? (toast.kind === "error" ? 7000 : 4000);
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id, duration }] }));
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

type ToastOptions = Partial<Pick<ToastItem, "description" | "issues" | "details" | "action" | "duration">>;

export const toast = {
  info: (title: string, opts: ToastOptions = {}) => useToasts.getState().push({ kind: "info", title, ...opts }),
  success: (title: string, opts: ToastOptions = {}) => useToasts.getState().push({ kind: "success", title, ...opts }),
  warning: (title: string, opts: ToastOptions = {}) => useToasts.getState().push({ kind: "warning", title, ...opts }),
  error: (title: string, opts: ToastOptions = {}) => useToasts.getState().push({ kind: "error", title, ...opts }),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
};

const icons = {
  info: <Info size={15} className="text-accent-hover" />,
  success: <CheckCircle2 size={15} className="text-success" />,
  warning: <AlertTriangle size={15} className="text-warning" />,
  error: <XCircle size={15} className="text-danger" />,
};

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (!item.duration || reading) return;
    const timer = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, reading, dismiss]);
  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-[340px] max-w-[calc(100vw-32px)] animate-slide-up items-start gap-2.5 rounded-lg bg-elevated px-3 py-2.5 shadow-menu"
    >
      <span className="mt-0.5 shrink-0">{icons[item.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{item.title}</p>
        {item.description ? <p className="mt-0.5 whitespace-pre-line text-xs text-fg-subtle">{item.description}</p> : null}
        {item.issues?.map((issue) => (
          <p key={issue} className="mt-1 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle size={12} className="mt-px shrink-0" />
            {issue}
          </p>
        ))}
        {item.details ? (
          <details className="mt-1 text-xs text-fg-subtle" onToggle={(e) => setReading(e.currentTarget.open)}>
            <summary className="cursor-pointer select-none text-fg-faint hover:text-fg">Details</summary>
            <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-line">{item.details}</p>
          </details>
        ) : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              dismiss(item.id);
            }}
            className="mt-1.5 text-xs font-medium text-accent-hover hover:underline"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(item.id)}
        className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-fg-faint hover:bg-white/[0.08] hover:text-fg"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function Toaster({ className }: { className?: string }) {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className={cn("pointer-events-none fixed bottom-4 right-4 z-[80] flex flex-col items-end gap-2", className)}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}
