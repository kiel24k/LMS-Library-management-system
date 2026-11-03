import { Link, useNavigate } from "react-router"

import { LoanStatusBadges } from "@/components/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatDueDate } from "@/lib/format"
import type { Loan } from "@/types/api"

function booksSummary(loan: Loan): string {
  const first = loan.items[0]?.book.title ?? ""
  const more = loan.items.length - 1
  return more > 0 ? `${first} +${more} more` : first
}

/** Shared loan list table (loans page, book history, borrower history). */
export function LoansTable({
  loans,
  showLibrary = true,
  showBorrower = true,
}: {
  loans: Loan[]
  showLibrary?: boolean
  showBorrower?: boolean
}) {
  const navigate = useNavigate()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ref. no.</TableHead>
          {showBorrower && <TableHead>Borrower</TableHead>}
          {showLibrary && <TableHead>Library</TableHead>}
          <TableHead>Books</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Requested</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="text-right">Out</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loans.map((loan) => (
          <TableRow
            key={loan.id}
            className="cursor-pointer"
            onClick={() => void navigate(`/borrow-records/${loan.id}`)}
          >
            <TableCell>
              <Link
                to={`/borrow-records/${loan.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-xs font-medium hover:underline"
              >
                {loan.loanNumber}
              </Link>
              {loan.source === "PUBLIC_FORM" && <div className="text-[11px] text-muted-foreground">Public form</div>}
            </TableCell>
            {showBorrower && (
              <TableCell>
                <div className="font-medium">{loan.borrower.name}</div>
                {loan.borrower.idNumber && <div className="text-xs text-muted-foreground">ID {loan.borrower.idNumber}</div>}
              </TableCell>
            )}
            {showLibrary && <TableCell className="text-muted-foreground">{loan.library.name}</TableCell>}
            <TableCell className="max-w-64">
              <div className="truncate" title={loan.items.map((i) => `${i.book.title} ×${i.quantity}`).join("\n")}>
                {booksSummary(loan)}
              </div>
              <div className="text-xs text-muted-foreground">{loan.totalQuantity} {loan.totalQuantity === 1 ? "copy" : "copies"}</div>
            </TableCell>
            <TableCell>
              <LoanStatusBadges status={loan.status} isOverdue={loan.isOverdue} daysOverdue={loan.daysOverdue} />
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(loan.requestedAt)}</TableCell>
            <TableCell className={loan.isOverdue ? "font-medium text-red-600 dark:text-red-400" : undefined}>
              {formatDueDate(loan.dueDate)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{loan.outstandingTotal}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
