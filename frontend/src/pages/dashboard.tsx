import { Link } from "react-router"
import {
  AlertTriangleIcon,
  BanIcon,
  BookCopyIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileInputIcon,
  HandHelpingIcon,
  LibraryBigIcon,
  PackageCheckIcon,
  XCircleIcon,
} from "lucide-react"
import { useState, type ReactNode } from "react"
import { cn } from "cn"

import { PageHeader } from "@/components/page-header"
import { ErrorState } from "@/components/states"
import { OverdueBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/features/auth/use-auth"
import { useDashboard } from "@/features/dashboard/api"
import { QuickDecisionButtons, QuickDecisionDialogs, type QuickDecision } from "@/features/loans/quick-decision"
import { formatDateTime, formatDueDate, formatRelative, plural } from "@/lib/format"
import { useLibraryScope } from "@/lib/library-scope"
import type { ActivityType, Dashboard } from "@/types/api"

function StatCard({
  label,
  value,
  icon,
  to,
  tone,
}: {
  label: string
  value: number | undefined
  icon: ReactNode
  to?: string
  tone?: "warn" | "danger"
}) {
  const body = (
    <Card
      size="sm"
      className={cn(
        "h-full transition-colors",
        to && "hover:bg-muted/50",
        tone === "warn" && value ? "ring-amber-400/60" : undefined,
        tone === "danger" && value ? "ring-red-500/50" : undefined,
      )}
    >
      <CardHeader>
        <CardDescription className="flex items-center gap-2 [&_svg]:size-4">
          {icon}
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "warn" && value ? "text-amber-600 dark:text-amber-400" : undefined,
            tone === "danger" && value ? "text-red-600 dark:text-red-400" : undefined,
          )}
        >
          {value === undefined ? <Skeleton className="h-7 w-12" /> : value.toLocaleString()}
        </CardTitle>
      </CardHeader>
    </Card>
  )
  return to ? (
    <Link to={to} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  )
}

const ACTIVITY: Record<ActivityType, { icon: ReactNode; verb: string; tone: string }> = {
  REQUESTED: { icon: <FileInputIcon />, verb: "requested", tone: "text-amber-600 dark:text-amber-400" },
  BORROWED: { icon: <HandHelpingIcon />, verb: "borrowed", tone: "text-sky-600 dark:text-sky-400" },
  RETURNED: { icon: <PackageCheckIcon />, verb: "returned", tone: "text-emerald-600 dark:text-emerald-400" },
  REJECTED: { icon: <XCircleIcon />, verb: "request rejected", tone: "text-rose-600 dark:text-rose-400" },
  CANCELLED: { icon: <BanIcon />, verb: "request cancelled", tone: "text-muted-foreground" },
}

/** A list row that opens the borrow record, or a plain row when the user can't open records (no loans.view). */
function LoanRow({
  loanId,
  canOpen,
  className: extraClassName,
  children,
}: {
  loanId: string
  canOpen: boolean
  className?: string
  children: ReactNode
}) {
  const className = cn("flex items-center gap-3 py-2", extraClassName)
  return canOpen ? (
    <Link to={`/borrow-records/${loanId}`} className={cn(className, "hover:bg-muted/50")}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  )
}

/** Library names are only worth showing when a list mixes libraries. */
function mixesLibraries(names: string[]): boolean {
  return new Set(names).size > 1
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  )
}

type ListProps = { data: Dashboard; allLibraries: boolean; canOpen: boolean }

function OverdueList({ data, allLibraries, canOpen }: ListProps) {
  const showLibrary = allLibraries && mixesLibraries(data.overdueLoans.map((l) => l.library.name))
  if (data.overdueLoans.length === 0)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2Icon className="size-4 text-emerald-600" /> Nothing is overdue.
      </p>
    )
  return (
    <ul className="divide-y">
      {data.overdueLoans.map((loan) => (
        <li key={loan.id}>
          <LoanRow loanId={loan.id} canOpen={canOpen}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{loan.borrower.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {loan.loanNumber} · due {formatDueDate(loan.dueDate)} · {plural(loan.outstandingTotal, "copy", "copies")}
                {showLibrary && ` · ${loan.library.name}`}
              </p>
            </div>
            <OverdueBadge days={loan.daysOverdue} />
          </LoanRow>
        </li>
      ))}
    </ul>
  )
}

/** `onDecide` (with loans.approve) adds Accept / Reject buttons to each request. */
function PendingList({
  data,
  allLibraries,
  canOpen,
  onDecide,
}: ListProps & { onDecide?: (decision: QuickDecision) => void }) {
  const showLibrary = allLibraries && mixesLibraries(data.pendingLoans.map((l) => l.library.name))
  if (data.pendingLoans.length === 0)
    return <p className="text-sm text-muted-foreground">No requests waiting.</p>
  return (
    <ul className="divide-y">
      {data.pendingLoans.map((loan) => (
        <li key={loan.id} className="flex flex-wrap items-center gap-x-3">
          <LoanRow loanId={loan.id} canOpen={canOpen} className="min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{loan.borrower.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {loan.loanNumber} · {plural(loan.totalQuantity, "copy", "copies")}
                {showLibrary && ` · ${loan.library.name}`}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(loan.requestedAt)}>
              <ClockIcon className="mr-1 inline size-3" />
              {formatRelative(loan.requestedAt)}
            </span>
          </LoanRow>
          {onDecide && (
            <div className="ml-auto pb-2 sm:pb-0">
              <QuickDecisionButtons loan={loan} onPick={onDecide} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function ActivityFeed({ data, allLibraries, canOpen }: ListProps) {
  const showLibrary = allLibraries && mixesLibraries(data.recentActivity.map((a) => a.libraryName))
  if (data.recentActivity.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>
  return (
    <ul className="flex flex-col gap-3">
      {data.recentActivity.map((a, idx) => {
        const meta = ACTIVITY[a.type]
        return (
          <li key={`${a.loanId}-${a.type}-${a.at}-${idx}`} className="flex gap-3">
            <span className={cn("mt-0.5 [&_svg]:size-4", meta.tone)}>{meta.icon}</span>
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <span className="font-medium">{a.borrowerName}</span> {meta.verb} ·{" "}
                {canOpen ? (
                  <Link to={`/borrow-records/${a.loanId}`} className="font-mono text-xs hover:underline">
                    {a.loanNumber}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{a.loanNumber}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                <span title={formatDateTime(a.at)}>{formatRelative(a.at)}</span>
                {a.byName && ` · by ${a.byName}`}
                {showLibrary && ` · ${a.libraryName}`}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function DashboardPage() {
  const { libraryId } = useLibraryScope()
  const { can } = useAuth()
  // The route already needs dashboard.view; the flag also stops polling the moment it's taken away.
  const dashboard = useDashboard(libraryId, { enabled: can("dashboard.view") })
  const d = dashboard.data
  const allLibraries = !libraryId
  // Numbers are shown to everyone with dashboard.view; links only lead to pages the user can open.
  const canOpenLoans = can("loans.view")
  const loansLink = (tab: string) => (canOpenLoans ? `/borrow-records?tab=${tab}` : undefined)
  const listProps = { allLibraries, canOpen: canOpenLoans }
  const canDecide = can("loans.approve")
  const [decision, setDecision] = useState<QuickDecision | null>(null)

  return (
    <>
      <PageHeader title="Dashboard" />

      {dashboard.isError && !d ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <>
          <section aria-label="Borrowing stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Pending requests" value={d?.loans.pending} icon={<FileInputIcon />} to={loansLink("pending")} tone="warn" />
            <StatCard label="Currently borrowed" value={d?.loans.active} icon={<HandHelpingIcon />} to={loansLink("borrowed")} />
            <StatCard label="Overdue" value={d?.loans.overdue} icon={<AlertTriangleIcon />} to={loansLink("overdue")} tone="danger" />
            <StatCard label="Returned this month" value={d?.loans.returnedThisMonth} icon={<PackageCheckIcon />} to={loansLink("returned")} />
          </section>
          <section aria-label="Stock stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Books" value={d?.totals.books} icon={<BookOpenIcon />} to={can("books.view") ? "/books" : undefined} />
            <StatCard label="Copies" value={d?.totals.copies} icon={<BookCopyIcon />} />
            <StatCard label="Available" value={d?.totals.available} icon={<LibraryBigIcon />} />
            <StatCard label="Copies out" value={d?.totals.borrowedOut} icon={<HandHelpingIcon />} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangleIcon className="size-4 text-red-600" />
                  Overdue
                </CardTitle>
                {canOpenLoans && (
                  <CardAction>
                    <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/borrow-records?tab=overdue" />}>
                      View all
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent>{d ? <OverdueList data={d} {...listProps} /> : <ListSkeleton />}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileInputIcon className="size-4 text-amber-600" />
                  Pending requests
                </CardTitle>
                {canOpenLoans && (
                  <CardAction>
                    <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/borrow-records?tab=pending" />}>
                      View all
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent>
                {d ? (
                  <PendingList data={d} {...listProps} onDecide={canDecide ? setDecision : undefined} />
                ) : (
                  <ListSkeleton />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>{d ? <ActivityFeed data={d} {...listProps} /> : <ListSkeleton />}</CardContent>
          </Card>
        </>
      )}

      {canDecide && <QuickDecisionDialogs decision={decision} onClose={() => setDecision(null)} />}
    </>
  )
}
