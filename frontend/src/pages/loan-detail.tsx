import { useState } from "react"
import { Link, useParams } from "react-router"
import {
  AlertTriangleIcon,
  BanIcon,
  CalendarClockIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  StickyNoteIcon,
  XIcon,
} from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { ErrorState, PageSkeleton } from "@/components/states"
import { LoanStatusBadges } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { useLoan } from "@/features/loans/api"
import {
  ApproveDialog,
  CancelDialog,
  EditItemsDialog,
  EditNotesDialog,
  ExtendDueDateDialog,
  RejectDialog,
} from "@/features/loans/loan-actions"
import { DecisionEmailCard } from "@/features/loans/decision-email"
import { LoanTimeline, ReturnHistory } from "@/features/loans/loan-timeline"
import { decisionVerbs, submittedNameDiffers } from "@/features/loans/loan-utils"
import { ReturnCheck } from "@/features/loans/return-check"
import { ApiError } from "@/lib/api"
import { formatDateTime, formatDueDate, plural } from "@/lib/format"
import { useLibraryScope } from "@/lib/library-scope"
import { isOpenStatus } from "@/lib/loan-status"
import type { LoanDetail } from "@/types/api"

type DialogName = "approve" | "reject" | "cancel" | "extend" | "items" | "notes" | null

/** Label/value row; hidden when there is no value. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  )
}

function ItemsTable({ loan }: { loan: LoanDetail }) {
  const canOpenBooks = useAuth().can("books.view")
  const borrowed = loan.status !== "PENDING" && loan.status !== "REJECTED" && loan.status !== "CANCELLED"
  // While a request waits, show the book's current stock so staff can tell whether it can be accepted.
  const pending = loan.status === "PENDING"
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Book</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          {pending && <TableHead className="text-right">Copies available</TableHead>}
          {borrowed && (
            <>
              <TableHead className="hidden text-right sm:table-cell">Good</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Damaged</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Lost</TableHead>
              <TableHead className="text-right">Still out</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loan.items.map((i) => (
          <TableRow key={i.id}>
            <TableCell className="whitespace-normal">
              {canOpenBooks ? (
                <Link to={`/books/${i.bookId}`} className="font-medium hover:underline">
                  {i.book.title}
                </Link>
              ) : (
                <span className="font-medium">{i.book.title}</span>
              )}
              {i.book.archived && <span className="ml-2 text-xs text-destructive">(archived)</span>}
              <div className="text-xs text-muted-foreground">
                {[i.book.author, i.book.callNumber].filter(Boolean).join(" · ")}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
            {pending && (
              <TableCell className="text-right tabular-nums">
                <span
                  className={cn(i.book.availableCopies < i.quantity && "font-medium text-destructive")}
                  title={`${i.book.availableCopies} of ${i.book.totalCopies} copies are on the shelf`}
                >
                  {i.book.availableCopies} / {i.book.totalCopies}
                </span>
                {i.book.availableCopies < i.quantity && (
                  <div className="text-xs text-destructive">Not enough copies</div>
                )}
              </TableCell>
            )}
            {borrowed && (
              <>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{i.returnedGood}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{i.returnedDamaged}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{i.lost}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{i.outstanding}</TableCell>
              </>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function LoanDetailPage() {
  const { id } = useParams()
  const loanQuery = useLoan(id)
  const { libraries } = useLibraryScope()
  const { can } = useAuth()
  const [dialog, setDialog] = useState<DialogName>(null)

  if (loanQuery.isPending) return <PageSkeleton />
  if (loanQuery.isError) {
    const notFound = loanQuery.error instanceof ApiError && loanQuery.error.status === 404
    return (
      <ErrorState
        title={notFound ? "Borrow record not found" : "Couldn't load this borrow record"}
        error={loanQuery.error}
        onRetry={notFound ? undefined : () => void loanQuery.refetch()}
      />
    )
  }

  const loan = loanQuery.data
  const isPending = loan.status === "PENDING"
  const isOpen = isOpenStatus(loan.status)
  const isClosed = !!loan.closedAt || loan.status === "RETURNED" || loan.status === "REJECTED" || loan.status === "CANCELLED"
  const library = libraries.find((l) => l.id === loan.libraryId)
  // Each action shows only with the permission its endpoint needs.
  const canApprove = isPending && can("loans.approve") // approve + reject
  const canEditItems = isPending && can("loans.update")
  const canExtend = isOpen && can("loans.update")
  const canEditNotes = !isClosed && can("loans.update")
  const canCancel = isPending && can("loans.cancel")
  const canReturn = isOpen && can("loans.return")
  const hasActions = canApprove || canEditItems || canExtend || canEditNotes || canCancel
  const verbs = decisionVerbs(loan)
  const dialogProps = (name: Exclude<DialogName, null>) => ({
    loan,
    open: dialog === name,
    onOpenChange: (o: boolean) => setDialog(o ? name : null),
  })

  return (
    <>
      <PageHeader
        back={{ to: "/borrow-records", label: "Borrow Records" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {loan.loanNumber}
            <LoanStatusBadges status={loan.status} isOverdue={loan.isOverdue} daysOverdue={loan.daysOverdue} />
          </span>
        }
        actions={
          hasActions ? (
            <>
              {canApprove && (
                <Button onClick={() => setDialog("approve")}>
                  <CheckIcon data-icon="inline-start" />
                  {verbs.approve}
                </Button>
              )}
              {canEditItems && (
                <Button variant="outline" onClick={() => setDialog("items")}>
                  <PencilIcon data-icon="inline-start" />
                  Edit items
                </Button>
              )}
              {canApprove && (
                <Button variant="destructive" onClick={() => setDialog("reject")}>
                  <XIcon data-icon="inline-start" />
                  {verbs.reject}
                </Button>
              )}
              {canExtend && (
                <Button variant="outline" onClick={() => setDialog("extend")}>
                  <CalendarClockIcon data-icon="inline-start" />
                  Extend due date
                </Button>
              )}
              {(canEditNotes || canCancel) && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    {canEditNotes && (
                      <DropdownMenuItem onClick={() => setDialog("notes")}>
                        <StickyNoteIcon />
                        Edit notes
                      </DropdownMenuItem>
                    )}
                    {canCancel && (
                      <DropdownMenuItem variant="destructive" onClick={() => setDialog("cancel")}>
                        <BanIcon />
                        Cancel request
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          ) : undefined
        }
      />

      {submittedNameDiffers(loan) && (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Check the borrower's identity</p>
            <p>
              Name on form: <strong>“{loan.submittedName}”</strong>. Matched borrower: <strong>“{loan.borrower.name}”</strong>.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{isPending ? "Requested books" : "Books"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ItemsTable loan={loan} />
            </CardContent>
          </Card>

          {canReturn && <ReturnCheck key={`${loan.id}-${loan.returns.length}`} loan={loan} />}

          {(isOpen || loan.returns.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Return history</CardTitle>
              </CardHeader>
              <CardContent>
                <ReturnHistory returns={loan.returns} />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Borrower</CardTitle>
            </CardHeader>
            <CardContent>
              {can("borrowers.view") ? (
                <Link to={`/borrowers/${loan.borrower.id}`} className="font-medium hover:underline">
                  {loan.borrower.name}
                </Link>
              ) : (
                <p className="font-medium">{loan.borrower.name}</p>
              )}
              <dl className="mt-2 divide-y">
                <InfoRow label="Email">
                  {loan.borrower.email && (
                    <a href={`mailto:${loan.borrower.email}`} className="break-all hover:underline">
                      {loan.borrower.email}
                    </a>
                  )}
                </InfoRow>
                <InfoRow label="ID number">{loan.borrower.idNumber}</InfoRow>
                <InfoRow label="Contact">{loan.borrower.contact}</InfoRow>
                <InfoRow label="Affiliation">{loan.borrower.affiliation}</InfoRow>
                {submittedNameDiffers(loan) && <InfoRow label="Name on form">{loan.submittedName}</InfoRow>}
              </dl>
            </CardContent>
          </Card>

          <DecisionEmailCard loan={loan} canResend={can("loans.approve")} />

          <Card>
            <CardHeader>
              <CardTitle>Borrow details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <InfoRow label="Library">{loan.library.name}</InfoRow>
                <InfoRow label="Requested">{formatDateTime(loan.requestedAt)}</InfoRow>
                <InfoRow label="Borrowed">{loan.borrowedAt && formatDateTime(loan.borrowedAt)}</InfoRow>
                <InfoRow label="Due date">{loan.dueDate && formatDueDate(loan.dueDate)}</InfoRow>
                <InfoRow label="Closed">{loan.closedAt && formatDateTime(loan.closedAt)}</InfoRow>
                <InfoRow label="Created by">{loan.createdBy?.name ?? (loan.source === "PUBLIC_FORM" ? "Public form" : null)}</InfoRow>
                <InfoRow label={loan.source === "PUBLIC_FORM" ? "Accepted by" : "Released by"}>{loan.approvedBy?.name}</InfoRow>
                <InfoRow label="Closed by">{loan.closedBy?.name}</InfoRow>
                {isOpen && <InfoRow label="Still out">{plural(loan.outstandingTotal, "copy", "copies")}</InfoRow>}
              </dl>
              {loan.notes && (
                <div className="mt-3 rounded-lg bg-muted/50 p-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{loan.notes}</p>
                </div>
              )}
              {loan.staffNotes && (
                <div className="mt-3 rounded-lg bg-muted/50 p-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">
                    {loan.status === "REJECTED" ? "Rejection reason" : loan.status === "CANCELLED" ? "Cancellation reason" : "Staff notes"}
                  </p>
                  <p className="whitespace-pre-wrap">{loan.staffNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <LoanTimeline loan={loan} />
            </CardContent>
          </Card>
        </div>
      </div>

      {canApprove && (
        <>
          <ApproveDialog
            {...dialogProps("approve")}
            defaultLoanDays={library?.defaultLoanDays}
            onEditItems={canEditItems ? () => setDialog("items") : undefined}
          />
          <RejectDialog {...dialogProps("reject")} />
        </>
      )}
      {canCancel && <CancelDialog {...dialogProps("cancel")} />}
      {canEditItems && dialog === "items" && <EditItemsDialog {...dialogProps("items")} />}
      {canExtend && dialog === "extend" && <ExtendDueDateDialog {...dialogProps("extend")} />}
      {canEditNotes && dialog === "notes" && <EditNotesDialog {...dialogProps("notes")} />}
    </>
  )
}
