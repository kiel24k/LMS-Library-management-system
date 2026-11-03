import { cn } from "cn"

import { MAX_COPIES } from "@/features/books/paste-books"

// Large, calm controls for older eyes (overrides the compact shadcn defaults), shared by "Add many books" and the
// Add / Edit book dialog. The dark, offset focus ring shows clearly which box or button is active; the scroll
// margins keep a focused box clear of a sticky save bar.
export const FOCUS =
  "focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:focus-visible:ring-red-700 dark:aria-invalid:focus-visible:ring-red-400"
export const BIG_INPUT = cn("h-12 scroll-mt-24 scroll-mb-56 px-3 text-lg md:text-lg", FOCUS)
export const BIG_LABEL = "text-lg font-semibold"
export const BIG_BUTTON = cn(
  "h-12 gap-2 px-5 text-lg has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-5",
  FOCUS,
)
export const BIG_SELECT = cn(
  "w-full px-3 text-lg data-[size=default]:h-12 [&_svg:not([class*='size-'])]:size-5",
  FOCUS,
)
export const BIG_ITEM = "py-2.5 text-lg"
export const HINT = "text-base text-foreground/80"
export const ERROR_TEXT = "text-base font-medium text-red-700 dark:text-red-400"

/** Copies as a number: blank counts as `fallback`, anything outside min…max as the nearest limit. */
export function copiesCount(
  value: string,
  { min = 1, max = MAX_COPIES, fallback }: { min?: number; max?: number; fallback?: number } = {},
): number {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : (fallback ?? min)
}
