/**
 * Menus: one declarative spec rendered as a dropdown (top bar, buttons) or a
 * context menu (timeline, files). Both Radix flavours share the same styles.
 */
import * as RadixContext from "@radix-ui/react-context-menu";
import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";
import { Kbd } from "./Kbd";

export type MenuSpec =
  | {
      type: "item";
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | { type: "check"; label: string; checked: boolean; shortcut?: string; disabled?: boolean; onSelect: () => void }
  | { type: "sub"; label: string; icon?: ReactNode; disabled?: boolean; items: MenuSpec[] }
  | { type: "separator" }
  | { type: "label"; label: string };

export const menuContentClass =
  "z-[60] min-w-[200px] max-h-[var(--radix-dropdown-menu-content-available-height,80vh)] overflow-y-auto rounded-lg bg-elevated p-1 text-sm text-fg shadow-menu animate-pop-in outline-none";

const itemClass =
  "group relative flex h-7 cursor-default select-none items-center gap-2 rounded-md pl-2 pr-2 outline-none " +
  "data-[highlighted]:bg-accent data-[highlighted]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-35 " +
  "data-[state=open]:bg-white/[0.08]";

function Shortcut({ combo }: { combo?: string }) {
  if (!combo) return null;
  return <Kbd shortcut={combo} className="ml-auto pl-6 opacity-80 group-data-[highlighted]:opacity-100" />;
}

type Flavour = typeof RadixDropdown | typeof RadixContext;

function renderItems(R: Flavour, items: MenuSpec[], checkable: boolean): ReactNode {
  // Reserve the check column only when a menu has check items.
  const inset = checkable || items.some((i) => i.type === "check");
  return items.map((item, index) => {
    switch (item.type) {
      case "separator":
        return <R.Separator key={index} className="mx-1 my-1 h-px bg-line" />;
      case "label":
        return (
          <R.Label key={index} className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-fg-faint">
            {item.label}
          </R.Label>
        );
      case "check":
        return (
          <R.CheckboxItem
            key={index}
            checked={item.checked}
            disabled={item.disabled}
            onSelect={item.onSelect}
            className={cn(itemClass, "pl-7")}
          >
            <R.ItemIndicator className="absolute left-2 inline-flex">
              <Check size={13} strokeWidth={2.5} />
            </R.ItemIndicator>
            <span className="truncate">{item.label}</span>
            <Shortcut combo={item.shortcut} />
          </R.CheckboxItem>
        );
      case "sub":
        return (
          <R.Sub key={index}>
            <R.SubTrigger disabled={item.disabled} className={cn(itemClass, inset && "pl-7")}>
              {item.icon ? <span className="inline-flex w-4 justify-center text-fg-muted group-data-[highlighted]:text-white">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
              <ChevronRight size={14} className="ml-auto text-fg-subtle group-data-[highlighted]:text-white" />
            </R.SubTrigger>
            <R.Portal>
              <R.SubContent sideOffset={4} alignOffset={-4} collisionPadding={8} className={menuContentClass}>
                {renderItems(R, item.items, false)}
              </R.SubContent>
            </R.Portal>
          </R.Sub>
        );
      case "item":
        return (
          <R.Item
            key={index}
            disabled={item.disabled}
            onSelect={item.onSelect}
            className={cn(itemClass, inset && !item.icon && "pl-7", item.danger && "text-danger data-[highlighted]:bg-danger")}
          >
            {item.icon ? <span className="inline-flex w-4 justify-center text-fg-muted group-data-[highlighted]:text-white">{item.icon}</span> : null}
            <span className="truncate">{item.label}</span>
            <Shortcut combo={item.shortcut} />
          </R.Item>
        );
    }
  });
}

export interface DropdownMenuProps {
  trigger: ReactElement;
  items: MenuSpec[];
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  className?: string;
}

export function DropdownMenu({ trigger, items, align = "start", side = "bottom", sideOffset = 6, open, onOpenChange, modal, className }: DropdownMenuProps) {
  return (
    <RadixDropdown.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8}
          loop
          className={cn(menuContentClass, className)}
        >
          {renderItems(RadixDropdown, items, false)}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}

export interface ContextMenuProps {
  children: ReactElement;
  /** Built lazily when the menu opens, so menus reflect the current state. */
  items: () => MenuSpec[];
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

export function ContextMenu({ children, items, onOpenChange, disabled }: ContextMenuProps) {
  return (
    <RadixContext.Root onOpenChange={onOpenChange} modal={false}>
      <RadixContext.Trigger asChild disabled={disabled}>
        {children}
      </RadixContext.Trigger>
      <RadixContext.Portal>
        <RadixContext.Content collisionPadding={8} loop className={menuContentClass}>
          <LazyItems build={items} />
        </RadixContext.Content>
      </RadixContext.Portal>
    </RadixContext.Root>
  );
}

function LazyItems({ build }: { build: () => MenuSpec[] }) {
  return <>{renderItems(RadixContext, build(), false)}</>;
}
