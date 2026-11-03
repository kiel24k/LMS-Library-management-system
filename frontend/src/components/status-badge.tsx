import { AlertTriangleIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { LOAN_STATUS_CLASS, LOAN_STATUS_LABEL, OVERDUE_CLASS } from "@/lib/loan-status"
import { plural } from "@/lib/format"
import type { LoanStatus } from "@/types/api"

export function LoanStatusBadge({ status, className }: { status: LoanStatus; className?: string }) {
  return <Badge className={cn(LOAN_STATUS_CLASS[status], className)}>{LOAN_STATUS_LABEL[status]}</Badge>
}

export function OverdueBadge({ days, className }: { days?: number; className?: string }) {
  return (
    <Badge className={cn(OVERDUE_CLASS, className)}>
      <AlertTriangleIcon data-icon="inline-start" />
      {days && days > 0 ? `Overdue ${plural(days, "day")}` : "Overdue"}
    </Badge>
  )
}

/** Status badge plus an overdue badge when applicable. */
export function LoanStatusBadges({
  status,
  isOverdue,
  daysOverdue,
}: {
  status: LoanStatus
  isOverdue: boolean
  daysOverdue?: number
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <LoanStatusBadge status={status} />
      {isOverdue && <OverdueBadge days={daysOverdue} />}
    </span>
  )
}
