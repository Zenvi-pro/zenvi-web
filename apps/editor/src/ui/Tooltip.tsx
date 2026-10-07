import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { Kbd } from "./Kbd";

export const TooltipProvider = RadixTooltip.Provider;

export interface TooltipProps {
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
  disabled?: boolean;
}

export function Tooltip({ label, shortcut, side = "bottom", children, disabled }: TooltipProps) {
  if (disabled) return children;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[70] flex animate-fade-in select-none items-center gap-2 rounded-md bg-highlight px-2 py-1 text-xs text-fg shadow-menu"
        >
          {label}
          {shortcut ? <Kbd shortcut={shortcut} /> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
