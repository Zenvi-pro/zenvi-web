import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Width in px (max 92vw). */
  width?: number;
  /** Prevent closing by clicking outside / Escape (e.g. while exporting). */
  dismissible?: boolean;
  className?: string;
  bodyClassName?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 480,
  dismissible = true,
  className,
  bodyClassName,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (dismissible || next ? onOpenChange(next) : undefined)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 grid animate-fade-in place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]">
          <RadixDialog.Content
            onEscapeKeyDown={(e) => (dismissible ? undefined : e.preventDefault())}
            onPointerDownOutside={(e) => (dismissible ? undefined : e.preventDefault())}
            onInteractOutside={(e) => (dismissible ? undefined : e.preventDefault())}
            style={{ width: `min(${width}px, 92vw)` }}
            className={cn(
              "relative flex max-h-[88vh] animate-pop-in flex-col overflow-hidden rounded-xl bg-base text-fg shadow-dialog outline-none",
              className,
            )}
          >
            <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
              <div className="min-w-0 flex-1">
                <RadixDialog.Title className="text-md font-semibold tracking-tight">{title}</RadixDialog.Title>
                {description ? (
                  <RadixDialog.Description className="mt-0.5 text-sm text-fg-subtle">{description}</RadixDialog.Description>
                ) : (
                  <RadixDialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RadixDialog.Description>
                )}
              </div>
              {dismissible ? (
                <RadixDialog.Close
                  className="-mr-1.5 -mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-white/[0.06] hover:text-fg"
                  aria-label="Close"
                >
                  <X size={16} />
                </RadixDialog.Close>
              ) : null}
            </header>
            <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5", bodyClassName)}>{children}</div>
            {footer ? (
              <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-raised px-5 py-3">{footer}</footer>
            ) : null}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
