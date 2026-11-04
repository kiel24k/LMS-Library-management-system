import type { ReactNode } from "react"
import { Link } from "react-router"
import { AlertTriangleIcon, BookOpenIcon, BookPlusIcon, ClockIcon, HistoryIcon, UserRoundXIcon } from "lucide-react"
import { cn } from "cn"

import { PageHeader } from "@/components/page-header"
import { EmptyState, ErrorState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useMyLoans } from "@/features/my-books/api"
import { CurrentBorrowCard, HistoryList, PendingRequestCard } from "@/features/my-books/my-loans"
import { isOpenStatus } from "@/lib/loan-status"
import type { PortalLoan } from "@/types/api"

function BorrowMoreButton({ size }: { size?: "sm" | "default" }) {
  return (
    <Button size={size} nativeButton={false} render={<Link to="/catalog" />}>
      <BookPlusIcon data-icon="inline-start" />
      Borrow more books
    </Button>
  )
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone?: "warn" | "danger" }) {
  return (
    <Card size="sm" className={cn(tone === "danger" && value > 0 && "ring-red-500/50")}>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5 [&_svg]:size-4">
          {icon}
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "warn" && value > 0 && "text-amber-600 dark:text-amber-400",
            tone === "danger" && value > 0 && "text-red-600 dark:text-red-400",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="flex items-center gap-2 font-heading text-lg font-semibold">
        {title}
        {!!count && <span className="text-sm font-normal text-muted-foreground">({count})</span>}
      </h2>
      {children}
    </section>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-28" />
    </div>
  )
}

/** Splits the borrower's records into what is out now, what is waiting, and what is finished (newest first). */
function groupLoans(loans: PortalLoan[]) {
  const current = loans
    .filter((l) => isOpenStatus(l.status))
    // Overdue first, then the earliest due date.
    .sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
  const pending = loans.filter((l) => l.status === "PENDING")
  const history = loans.filter((l) => !isOpenStatus(l.status) && l.status !== "PENDING")
  return { current, pending, history }
}

/**
 * My Books (/my-books, my_books.view): the borrow records of the borrower linked to the signed-in account — what is
 * out now, requests waiting for approval and history. Accounts made when a request was accepted are linked to that
 * borrower; other accounts see an empty state.
 */
export function MyBooksPage() {
  const loans = useMyLoans()
  const borrower = loans.data?.borrower ?? null

  let body: ReactNode
  if (loans.isPending) body = <LoadingState />
  else if (loans.isError) body = <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />
  else if (!borrower) {
    body = (
      <EmptyState
        icon={<UserRoundXIcon />}
        title="This account isn't linked to a borrower."
        description="Accounts made when a borrower's request is accepted show that borrower's books here."
      />
    )
  } else if (loans.data.data.length === 0) {
    body = (
      <EmptyState
        icon={<BookOpenIcon />}
        title="No borrowed books yet"
        description="Browse the books the library has available and send a request. We'll email you as soon as it's accepted."
        action={<BorrowMoreButton size="sm" />}
      />
    )
  } else {
    const { current, pending, history } = groupLoans(loans.data.data)
    const withYou = current.reduce((sum, l) => sum + l.items.reduce((s, i) => s + i.outstanding, 0), 0)
    const overdue = current.filter((l) => l.isOverdue)
    body = (
      <>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="With you" value={withYou} icon={<BookOpenIcon />} />
          <Stat label="Overdue" value={overdue.length} icon={<AlertTriangleIcon />} tone="danger" />
          <Stat label="Waiting" value={pending.length} icon={<ClockIcon />} tone="warn" />
        </div>

        {overdue.length > 0 && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100"
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-medium">
                {overdue.length === 1
                  ? "One of your borrows is past its due date."
                  : `${overdue.length} of your borrows are past their due dates.`}
              </span>{" "}
              Please return the books to the library as soon as you can.
            </p>
          </div>
        )}

        <Section id="my-current" title="Borrowed now" count={current.length}>
          {current.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-background px-4 py-6 text-center text-sm text-muted-foreground">
              You have no books out right now.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {current.map((loan) => (
                <CurrentBorrowCard key={loan.id} loan={loan} />
              ))}
            </div>
          )}
        </Section>

        {pending.length > 0 && (
          <Section id="my-pending" title="Waiting for approval" count={pending.length}>
            <div className="flex flex-col gap-4">
              {pending.map((loan) => (
                <PendingRequestCard key={loan.id} loan={loan} />
              ))}
            </div>
          </Section>
        )}

        <Section id="my-history" title="History">
          <Card>
            <CardContent>
              {history.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HistoryIcon className="size-4" aria-hidden />
                  Returned and past requests will show here.
                </p>
              ) : (
                <HistoryList loans={history} />
              )}
            </CardContent>
          </Card>
        </Section>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="My Books"
        description={borrower ? `Books borrowed by ${borrower.name}, requests and history.` : "Books you borrowed and your requests."}
        actions={borrower && <BorrowMoreButton />}
      />
      <div className="flex max-w-4xl flex-col gap-6">{body}</div>
    </>
  )
}
