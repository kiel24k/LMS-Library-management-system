import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { EmptyState, ErrorState, PageSkeleton, TableSkeleton } from "@/components/states"
import { LoanStatusBadges } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { useBook } from "@/features/books/api"
import { BookActionsMenu } from "@/features/books/book-actions"
import { BookCover } from "@/features/books/book-cover"
import { BookFormDialog } from "@/features/books/book-form-dialog"
import { useLoans } from "@/features/loans/api"
import { LoansTable } from "@/features/loans/loans-table"
import { ApiError } from "@/lib/api"
import { formatDueDate } from "@/lib/format"
import { useLibraryScope } from "@/lib/library-scope"

const HISTORY_PAGE_SIZE = 10

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  )
}

export function BookDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { libraries } = useLibraryScope()
  const { can } = useAuth()
  // Who has it now comes with the book; the links from it and the borrowing history need their own permissions.
  const canViewLoans = can("loans.view")
  const canViewBorrowers = can("borrowers.view")
  const bookQuery = useBook(id)
  const [historyPage, setHistoryPage] = useState(1)
  const history = useLoans(
    { bookId: id, page: historyPage, pageSize: HISTORY_PAGE_SIZE },
    { enabled: !!id && canViewLoans },
  )
  const [editing, setEditing] = useState(false)

  if (bookQuery.isPending) return <PageSkeleton />
  if (bookQuery.isError) {
    const notFound = bookQuery.error instanceof ApiError && bookQuery.error.status === 404
    return (
      <ErrorState
        title={notFound ? "Book not found" : "Couldn't load this book"}
        error={bookQuery.error}
        onRetry={notFound ? undefined : () => void bookQuery.refetch()}
      />
    )
  }
  const book = bookQuery.data

  // Rows without a value are hidden.
  const details = (
    [
      ["Library", book.library.name],
      ["Category", book.category?.name],
      ["Author", book.author],
      ["ISBN", book.isbn],
      ["Publisher", book.publisher],
      ["Year", book.publicationYear],
      ["Call number", book.callNumber],
    ] as [string, React.ReactNode][]
  ).filter(([, value]) => value !== null && value !== undefined && value !== "")

  return (
    <>
      <PageHeader
        back={{ to: "/books", label: "Books" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {book.title}
            {book.archived && <Badge variant="secondary">Archived</Badge>}
          </span>
        }
        actions={
          <BookActionsMenu
            book={book}
            showView={false}
            onEdit={() => setEditing(true)}
            afterDelete={() => void navigate("/books", { replace: true })}
          />
        }
      />

      {/* The picture beside the copies and details; on a phone it sits above them. */}
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <BookCover src={book.coverUrl} size="lg" />
        <div className="grid min-w-0 flex-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Copies</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <Stat label="Total" value={book.totalCopies} />
              <Stat
                label="Available"
                value={book.availableCopies}
                tone={book.availableCopies === 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}
              />
              <Stat label="Borrowed" value={book.onLoan} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm">
                {details.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-1.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              {book.notes && <p className="mt-3 rounded-lg bg-muted/50 p-2 text-sm whitespace-pre-wrap">{book.notes}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Who has it now</CardTitle>
        </CardHeader>
        <CardContent>
          {book.currentLoans.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody has it now.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref. no.</TableHead>
                  <TableHead>Borrower</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Borrowed</TableHead>
                  <TableHead className="text-right">Still out</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {book.currentLoans.map((l) => (
                  <TableRow key={l.loanId}>
                    <TableCell>
                      {canViewLoans ? (
                        <Link to={`/borrow-records/${l.loanId}`} className="font-mono text-xs font-medium hover:underline">
                          {l.loanNumber}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs font-medium">{l.loanNumber}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canViewBorrowers ? (
                        <Link to={`/borrowers/${l.borrower.id}`} className="hover:underline">
                          {l.borrower.name}
                        </Link>
                      ) : (
                        l.borrower.name
                      )}
                    </TableCell>
                    <TableCell>
                      <LoanStatusBadges status={l.status} isOverdue={l.isOverdue} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{l.outstanding}</TableCell>
                    <TableCell className={l.isOverdue ? "font-medium text-red-600 dark:text-red-400" : undefined}>
                      {formatDueDate(l.dueDate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canViewLoans && (
        <Card>
          <CardHeader>
            <CardTitle>Borrowing history</CardTitle>
          </CardHeader>
          <CardContent>
            {history.isPending ? (
              <TableSkeleton columns={6} rows={3} />
            ) : history.isError ? (
              <ErrorState error={history.error} onRetry={() => void history.refetch()} />
            ) : history.data.data.length === 0 ? (
              <EmptyState title="Never borrowed" />
            ) : (
              <>
                <LoansTable loans={history.data.data} showLibrary={false} />
                <PaginationBar
                  page={historyPage}
                  pageSize={HISTORY_PAGE_SIZE}
                  total={history.data.total}
                  onPageChange={setHistoryPage}
                  isFetching={history.isPlaceholderData}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {editing && can("books.update") && (
        <BookFormDialog
          open
          onOpenChange={(o) => !o && setEditing(false)}
          book={book}
          libraries={libraries}
          defaultLibraryId={book.libraryId}
        />
      )}
    </>
  )
}
