import type { ReactNode } from "react"
import { BookIcon, CalendarIcon, ClockIcon, MapPinIcon } from "lucide-react"
import { cn } from "cn"

import { LoanStatusBadge, LoanStatusBadges, OverdueBadge } from "@/components/status-badge"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { daysUntil, dueInText, formatFriendlyDate } from "@/features/my-books/dates"
import { formatDate, formatDateTime, plural } from "@/lib/format"
import type { PortalLoan } from "@/types/api"

type Item = PortalLoan["items"][number]

function RefNumber({ loan }: { loan: PortalLoan }) {
  return <span className="font-mono text-xs font-medium text-muted-foreground">{loan.loanNumber}</span>
}

function BookLine({ item, trailing, muted }: { item: Item; trailing?: ReactNode; muted?: boolean }) {
  return (
    <li className={cn("flex items-start gap-3 py-2", muted && "text-muted-foreground")}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <BookIcon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium break-words", !muted && "text-foreground")}>{item.title}</p>
        {item.author && <p className="text-xs text-muted-foreground">{item.author}</p>}
      </div>
      {trailing && <div className="shrink-0 text-right text-xs">{trailing}</div>}
    </li>
  )
}

/** A borrow that is out now: due date first, then what is still with the borrower. */
export function CurrentBorrowCard({ loan }: { loan: PortalLoan }) {
  const dueText = loan.dueDate ? dueInText(loan.dueDate) : null
  // Today or tomorrow: worth a second look.
  const dueSoon = !!loan.dueDate && !loan.isOverdue && daysUntil(loan.dueDate) <= 1
  const outstanding = loan.items.reduce((sum, i) => sum + i.outstanding, 0)
  return (
    <Card className={cn(loan.isOverdue && "ring-red-500/50")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {loan.dueDate ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon className="size-4 text-muted-foreground" aria-hidden />
              Due {formatFriendlyDate(loan.dueDate)}
            </span>
          ) : (
            "Borrowed"
          )}
          {loan.isOverdue && <OverdueBadge days={loan.daysOverdue} />}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {dueText && (
            <span className={cn("font-medium", dueSoon && "text-amber-700 dark:text-amber-300")}>{dueText}</span>
          )}
          <span>{plural(outstanding, "copy", "copies")} with you</span>
        </CardDescription>
        <CardAction>
          <RefNumber loan={loan} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {loan.items.map((item) => (
            <BookLine
              key={item.bookId}
              item={item}
              muted={item.outstanding === 0}
              trailing={
                item.outstanding === 0 ? (
                  "Returned"
                ) : item.outstanding === item.quantity ? (
                  item.quantity > 1 ? `${item.quantity} copies` : null
                ) : (
                  <>
                    <span className="font-medium text-foreground">{item.outstanding}</span> of {item.quantity} still with you
                  </>
                )
              }
            />
          ))}
        </ul>
      </CardContent>
      {/* Books are returned in person: staff record it with "Return check", and the record then moves to History. */}
      <CardFooter className="items-start gap-1.5 border-t bg-muted/30 py-3 text-xs text-muted-foreground">
        <MapPinIcon className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">How to return:</span> bring the books to {loan.library.name}{" "}
          {loan.isOverdue ? "as soon as you can" : "any time — you don't have to wait for the due date"} and give the
          staff your reference number <span className="font-mono font-medium text-foreground">{loan.loanNumber}</span>.
          Once they check the books in, this moves to History.
        </span>
        {loan.borrowedAt && <span className="hidden shrink-0 sm:inline">Borrowed {formatDate(loan.borrowedAt)}</span>}
      </CardFooter>
    </Card>
  )
}

/** A request the library hasn't decided on yet. */
export function PendingRequestCard({ loan }: { loan: PortalLoan }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {loan.library.name}
          <LoanStatusBadge status={loan.status} />
        </CardTitle>
        <CardDescription className="inline-flex items-center gap-1.5">
          <ClockIcon className="size-3.5" aria-hidden />
          Sent {formatDateTime(loan.requestedAt)}
        </CardDescription>
        <CardAction>
          <RefNumber loan={loan} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {loan.items.map((item) => (
            <BookLine key={item.bookId} item={item} trailing={item.quantity > 1 ? `${item.quantity} copies` : null} />
          ))}
        </ul>
      </CardContent>
      <CardFooter className="border-t bg-muted/30 py-3 text-xs text-muted-foreground">
        We'll email you once the library accepts or declines this request.
      </CardFooter>
    </Card>
  )
}

function historyDate(loan: PortalLoan): string {
  return formatDate(loan.closedAt ?? loan.borrowedAt ?? loan.requestedAt)
}

/** Finished borrows and requests: returned, declined (with the library's reason) or cancelled. */
export function HistoryList({ loans }: { loans: PortalLoan[] }) {
  return (
    <ul className="divide-y">
      {loans.map((loan) => {
        const copies = loan.items.reduce((sum, i) => sum + i.quantity, 0)
        return (
          <li key={loan.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <LoanStatusBadges status={loan.status} isOverdue={loan.isOverdue} daysOverdue={loan.daysOverdue} />
              <RefNumber loan={loan} />
              <span className="ml-auto text-xs text-muted-foreground">{historyDate(loan)}</span>
            </div>
            <p className="text-sm">
              <span className="font-medium">{loan.items.map((i) => i.title).join(", ")}</span>
              <span className="text-muted-foreground">
                {" "}
                · {plural(copies, "copy", "copies")} · {loan.library.name}
              </span>
            </p>
            {loan.status === "REJECTED" && loan.staffNotes && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="font-medium">Reason from the library: </span>
                <span className="whitespace-pre-wrap">{loan.staffNotes}</span>
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
