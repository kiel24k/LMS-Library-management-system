import type { LoanStatus } from "@/types/api"

export const STATUS_ORDER: LoanStatus[] = ["PENDING", "BORROWED", "PARTIALLY_RETURNED", "RETURNED", "REJECTED", "CANCELLED"]

/** `statuses` empty = every status. `overdue` narrows the result to open records past their due date. */
export type StatusFilterValue = { statuses: LoanStatus[]; overdue: boolean }

/** What the page shows when the URL has no filter: books that are out right now. */
export const DEFAULT_STATUS_FILTER: StatusFilterValue = { statuses: ["BORROWED", "PARTIALLY_RETURNED"], overdue: false }

const sameStatuses = (a: LoanStatus[], b: LoanStatus[]) => a.length === b.length && a.every((s) => b.includes(s))

export const isDefaultStatusFilter = (f: StatusFilterValue) =>
  !f.overdue && sameStatuses(f.statuses, DEFAULT_STATUS_FILTER.statuses)

/** The old tab links (dashboard, bookmarks): ?tab=pending|borrowed|active|overdue|returned|all. */
function fromLegacyTab(tab: string | null): StatusFilterValue | null {
  switch (tab) {
    case "pending":
      return { statuses: ["PENDING"], overdue: false }
    case "borrowed":
    case "active":
      return DEFAULT_STATUS_FILTER
    case "overdue":
      return { statuses: [], overdue: true }
    case "returned":
      return { statuses: ["RETURNED"], overdue: false }
    case "all":
      return { statuses: [], overdue: false }
    default:
      return null
  }
}

/**
 * Reads the filter from the URL: `?status=PENDING,BORROWED` (or `status=all`) and `?overdue=1`; falls back to the old
 * `?tab=` links, then to the default.
 */
export function parseStatusFilter(params: URLSearchParams): StatusFilterValue {
  const raw = params.get("status")
  const overdue = params.get("overdue") === "1"
  if (raw !== null) {
    if (raw === "all") return { statuses: [], overdue }
    const wanted = raw.split(",").map((s) => s.trim().toUpperCase())
    const statuses = STATUS_ORDER.filter((s) => wanted.includes(s))
    return { statuses: statuses.length ? statuses : DEFAULT_STATUS_FILTER.statuses, overdue }
  }
  if (overdue) return { statuses: [], overdue: true }
  return fromLegacyTab(params.get("tab")) ?? DEFAULT_STATUS_FILTER
}

/** Writes the filter into `next` (the default leaves the URL clean). Also drops the old `tab` parameter. */
export function writeStatusFilter(next: URLSearchParams, f: StatusFilterValue) {
  next.delete("tab")
  next.delete("status")
  next.delete("overdue")
  if (isDefaultStatusFilter(f)) return
  next.set("status", f.statuses.length ? STATUS_ORDER.filter((s) => f.statuses.includes(s)).join(",") : "all")
  if (f.overdue) next.set("overdue", "1")
}
