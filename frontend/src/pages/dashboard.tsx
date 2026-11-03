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
import type { ReactNode } from "react"
import { cn } from "cn"

import { PageHeader } from "@/components/page-header"
import { ErrorState } from "@/components/states"
import { OverdueBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboard } from "@/features/dashboard/api"
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

function OverdueList({ data, allLibraries }: { data: Dashboard; allLibraries: boolean }) {
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
          <Link to={`/borrow-records/${loan.id}`} className="flex items-center gap-3 py-2 hover:bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{loan.borrower.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {loan.loanNumber} · due {formatDueDate(loan.dueDate)} · {plural(loan.outstandingTotal, "copy", "copies")}
                {showLibrary && ` · ${loan.library.name}`}
              </p>
            </div>
            <OverdueBadge days={loan.daysOverdue} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function PendingList({ data, allLibraries }: { data: Dashboard; allLibraries: boolean }) {
  const showLibrary = allLibraries && mixesLibraries(data.pendingLoans.map((l) => l.library.name))
  if (data.pendingLoans.length === 0)
    return <p className="text-sm text-muted-foreground">No requests waiting.</p>
  return (
    <ul className="divide-y">
      {data.pendingLoans.map((loan) => (
        <li key={loan.id}>
          <Link to={`/borrow-records/${loan.id}`} className="flex items-center gap-3 py-2 hover:bg-muted/50">
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
          </Link>
        </li>
      ))}
    </ul>
  )
}

function ActivityFeed({ data, allLibraries }: { data: Dashboard; allLibraries: boolean }) {
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
                <Link to={`/borrow-records/${a.loanId}`} className="font-mono text-xs hover:underline">
                  {a.loanNumber}
                </Link>
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
  const dashboard = useDashboard(libraryId)
  const d = dashboard.data
  const allLibraries = !libraryId

  return (
    <>
      <PageHeader title="Dashboard" />

      {dashboard.isError && !d ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <>
          <section aria-label="Borrowing stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Pending requests" value={d?.loans.pending} icon={<FileInputIcon />} to="/borrow-records?tab=pending" tone="warn" />
            <StatCard label="Currently borrowed" value={d?.loans.active} icon={<HandHelpingIcon />} to="/borrow-records?tab=borrowed" />
            <StatCard label="Overdue" value={d?.loans.overdue} icon={<AlertTriangleIcon />} to="/borrow-records?tab=overdue" tone="danger" />
            <StatCard label="Returned this month" value={d?.loans.returnedThisMonth} icon={<PackageCheckIcon />} to="/borrow-records?tab=returned" />
          </section>
          <section aria-label="Stock stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Books" value={d?.totals.books} icon={<BookOpenIcon />} to="/books" />
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
                <CardAction>
                  <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/borrow-records?tab=overdue" />}>
                    View all
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>{d ? <OverdueList data={d} allLibraries={allLibraries} /> : <ListSkeleton />}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileInputIcon className="size-4 text-amber-600" />
                  Pending requests
                </CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/borrow-records?tab=pending" />}>
                    View all
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>{d ? <PendingList data={d} allLibraries={allLibraries} /> : <ListSkeleton />}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>{d ? <ActivityFeed data={d} allLibraries={allLibraries} /> : <ListSkeleton />}</CardContent>
          </Card>
        </>
      )}
    </>
  )
}
