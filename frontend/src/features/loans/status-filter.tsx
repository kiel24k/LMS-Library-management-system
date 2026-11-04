import { CheckIcon, ChevronDownIcon, ListFilterIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LOAN_STATUS_LABEL } from "@/lib/loan-status"
import { cn } from "cn"
import type { LoanStatus } from "@/types/api"

import { DEFAULT_STATUS_FILTER, STATUS_ORDER, isDefaultStatusFilter, type StatusFilterValue } from "./status-filter-state"

function triggerText(f: StatusFilterValue): string {
  const names =
    f.statuses.length === 0
      ? f.overdue
        ? ""
        : "All"
      : f.statuses.length <= 2
        ? STATUS_ORDER.filter((s) => f.statuses.includes(s)).map((s) => LOAN_STATUS_LABEL[s]).join(", ")
        : `${f.statuses.length} selected`
  if (!f.overdue) return names
  return names ? `${names} · Overdue` : "Overdue"
}

/** Solid dot colors (the badge colors are too pale for a small dot). */
const STATUS_DOT: Record<LoanStatus, string> = {
  PENDING: "bg-amber-500",
  BORROWED: "bg-sky-500",
  PARTIALLY_RETURNED: "bg-violet-500",
  RETURNED: "bg-emerald-500",
  REJECTED: "bg-rose-500",
  CANCELLED: "bg-zinc-400",
}

/**
 * A visible checkbox square on the left of a menu checkbox item (replaces the menu's right-hand check mark; Base UI
 * marks the item with data-checked).
 */
const ITEM_CLASS = "group/check pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
function Box() {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input text-primary-foreground dark:bg-input/30 group-data-checked/check:border-primary group-data-checked/check:bg-primary"
    >
      <CheckIcon className="hidden size-3.5 stroke-primary-foreground group-data-checked/check:block" />
    </span>
  )
}

function Count({ value, className }: { value: number | undefined; className?: string }) {
  if (!value) return null
  return (
    <Badge variant="secondary" className={cn("ml-auto h-5 min-w-5 px-1.5 tabular-nums", className)}>
      {value}
    </Badge>
  )
}

/** Status filter for the Borrow Records list: a dropdown of checkboxes (any number of statuses, plus "Overdue only"). */
export function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: StatusFilterValue
  onChange: (next: StatusFilterValue) => void
  /** Optional numbers from the dashboard (shown next to the matching options). */
  counts?: { pending?: number; overdue?: number }
}) {
  const toggle = (status: LoanStatus, checked: boolean) => {
    const statuses = checked ? [...value.statuses, status] : value.statuses.filter((s) => s !== status)
    onChange({ ...value, statuses: STATUS_ORDER.filter((s) => statuses.includes(s)) })
  }
  const isDefault = isDefaultStatusFilter(value)
  const showsEverything = value.statuses.length === 0 && !value.overdue

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="w-full justify-between gap-2 md:w-auto md:max-w-80" aria-label={`Status filter: ${triggerText(value)}`} />
        }
      >
        <ListFilterIcon data-icon="inline-start" />
        <span className="text-muted-foreground">Status:</span>
        <span className="truncate">{triggerText(value)}</span>
        {!!counts?.pending && !value.statuses.includes("PENDING") && value.statuses.length > 0 && (
          // Pending requests waiting while the filter hides them: keep them noticeable.
          <Badge className="h-5 min-w-5 bg-amber-500 px-1.5 text-amber-950 tabular-nums" title={`${counts.pending} pending`}>
            {counts.pending}
          </Badge>
        )}
        <ChevronDownIcon data-icon="inline-end" className="ml-auto opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Status (nothing checked = all)</DropdownMenuLabel>
          {STATUS_ORDER.map((s) => (
            <DropdownMenuCheckboxItem key={s} checked={value.statuses.includes(s)} onCheckedChange={(c) => toggle(s, c)} className={ITEM_CLASS}>
              <Box />
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[s])} />
              {LOAN_STATUS_LABEL[s]}
              {s === "PENDING" && <Count value={counts?.pending} className="bg-amber-500 text-amber-950" />}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={value.overdue} onCheckedChange={(c) => onChange({ ...value, overdue: c })} className={ITEM_CLASS}>
          <Box />
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-red-600" />
          Overdue only
          <Count value={counts?.overdue} className="bg-red-600 text-white" />
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={showsEverything} onClick={() => onChange({ statuses: [], overdue: false })}>
          Show all
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isDefault} onClick={() => onChange(DEFAULT_STATUS_FILTER)}>
          Reset to borrowed now
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
