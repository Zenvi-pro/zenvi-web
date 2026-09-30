import { clsx, type ClassValue } from "clsx";

/** Join class names. Callers pass layout classes; components own their look. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
