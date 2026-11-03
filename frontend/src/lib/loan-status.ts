import type { LoanStatus } from "@/types/api"

export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  PENDING: "Pending",
  BORROWED: "Borrowed",
  PARTIALLY_RETURNED: "Partially returned",
  RETURNED: "Returned",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
}

/** Consistent colors for every place a loan status is shown. */
export const LOAN_STATUS_CLASS: Record<LoanStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  BORROWED: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200",
  PARTIALLY_RETURNED: "bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200",
  RETURNED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200",
  REJECTED: "bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200",
  CANCELLED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300",
}

export const OVERDUE_CLASS = "bg-red-600 text-white dark:bg-red-500/80"

export const OPEN_STATUSES: LoanStatus[] = ["BORROWED", "PARTIALLY_RETURNED"]

export function isOpenStatus(status: LoanStatus): boolean {
  return status === "BORROWED" || status === "PARTIALLY_RETURNED"
}

/** Friendly explanation used on the public status page. */
export const PUBLIC_STATUS_TEXT: Record<LoanStatus, string> = {
  PENDING: "Waiting for staff. Show this number at the library.",
  BORROWED: "Please return by the due date.",
  PARTIALLY_RETURNED: "Some books are still out.",
  RETURNED: "All books returned. Thank you!",
  REJECTED: "Not approved. Please ask the library staff.",
  CANCELLED: "This request was cancelled.",
}
