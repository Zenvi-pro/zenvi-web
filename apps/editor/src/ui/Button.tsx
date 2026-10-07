import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "white" | "secondary" | "ghost" | "danger" | "accent-outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-press",
  white: "bg-white text-black hover:bg-white/90 active:bg-white/80",
  secondary:
    "bg-elevated text-fg border border-line-strong hover:bg-overlay hover:border-line-bright active:bg-highlight",
  ghost: "text-fg-muted hover:text-fg hover:bg-white/[0.06] active:bg-white/[0.1]",
  danger: "bg-danger text-white hover:brightness-110 active:brightness-95",
  "accent-outline": "border border-accent/30 bg-accent/[0.07] text-fg hover:bg-accent/[0.14] hover:border-accent/50",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-xs gap-1 rounded-sm",
  sm: "h-7 px-2.5 text-sm gap-1.5 rounded-md",
  md: "h-8 px-3 text-sm gap-1.5 rounded-md",
  lg: "h-10 px-4 text-md gap-2 rounded-lg",
  xl: "h-11 px-5 text-md gap-2 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, trailing, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium outline-none",
        "transition-[background-color,border-color,color,opacity,filter] duration-100",
        "focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
        "disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "xs" ? 12 : 14} /> : icon}
      {children}
      {trailing}
    </button>
  );
});
