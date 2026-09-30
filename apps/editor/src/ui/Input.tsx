import { Search, X } from "lucide-react";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

export const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-line-strong bg-white/[0.03] px-2.5 text-sm text-fg placeholder:text-fg-faint " +
  "outline-none transition-[border-color,background-color] duration-100 hover:border-line-bright " +
  "focus:border-accent focus:bg-white/[0.04] focus-visible:ring-1 focus-visible:ring-accent/40 disabled:opacity-40";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, className)} {...rest} />;
});

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, className, placeholder = "Search", ...rest },
  ref,
) {
  return (
    <div className={cn("relative", className)}>
      <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint" />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onValueChange("");
          }
        }}
        className={cn(inputClass, "h-7 pl-7 pr-7 [&::-webkit-search-cancel-button]:hidden")}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onValueChange("")}
          className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:bg-white/[0.08] hover:text-fg"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
});
