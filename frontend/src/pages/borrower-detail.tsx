import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { PencilIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { PageHeader } from "@/components/page-header"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states"
import { OverdueBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useBorrower, useDeleteBorrower } from "@/features/borrowers/api"
import { BorrowerFormDialog } from "@/features/borrowers/borrower-form-dialog"
import { LoansTable } from "@/features/loans/loans-table"
import { ApiError, errorMessage } from "@/lib/api"
import { formatDate, formatDueDate } from "@/lib/format"
import { isOpenStatus } from "@/lib/loan-status"

export function BorrowerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const query = useBorrower(id)
  const del = useDeleteBorrower()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (query.isPending) return <PageSkeleton />
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <ErrorState
        title={notFound ? "Borrower not found" : "Couldn't load this borrower"}
        error={query.error}
        onRetry={notFound ? undefined : () => void query.refetch()}
      />
    )
  }
  const b = query.data
  // What they still have: outstanding items of open loans.
  const stillOut = b.loans
    .filter((l) => isOpenStatus(l.status))
    .flatMap((l) => l.items.filter((i) => i.outstanding > 0).map((i) => ({ loan: l, item: i })))

  return (
    <>
      <PageHeader
        back={{ to: "/borrowers", label: "Borrowers" }}
        title={b.name}
        description={[b.idNumber && `ID ${b.idNumber}`, b.affiliation, b.contact].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Current borrows", b.activeLoans],
          ["Copies out", b.outstandingCopies],
          ["Borrow records", b.loans.length],
          ["Since", formatDate(b.createdAt)],
        ].map(([label, value]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Not returned yet</CardTitle>
        </CardHeader>
        <CardContent>
          {stillOut.length === 0 ? (
            <p className="text-sm text-muted-foreground">All books returned.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Book</TableHead>
                  <TableHead className="text-right">Still out</TableHead>
                  <TableHead>Ref. no.</TableHead>
                  <TableHead>Library</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stillOut.map(({ loan, item }) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link to={`/books/${item.bookId}`} className="font-medium hover:underline">
                        {item.book.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.outstanding} of {item.quantity}
                    </TableCell>
                    <TableCell>
                      <Link to={`/borrow-records/${loan.id}`} className="font-mono text-xs hover:underline">
                        {loan.loanNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{loan.library.name}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {formatDueDate(loan.dueDate)}
                        {loan.isOverdue && <OverdueBadge days={loan.daysOverdue} />}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Borrowing history</CardTitle>
        </CardHeader>
        <CardContent>
          {b.loans.length === 0 ? (
            <EmptyState title="No borrow records yet" />
          ) : (
            <LoansTable loans={b.loans} showBorrower={false} />
          )}
        </CardContent>
      </Card>

      {editing && <BorrowerFormDialog open onOpenChange={setEditing} borrower={b} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${b.name}?`}
        description="This can't be undone."
        confirmLabel="Delete borrower"
        destructive
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(b.id, {
            onSuccess: () => {
              toast.success(`${b.name} deleted.`)
              void navigate("/borrowers", { replace: true })
            },
            onError: (e) => {
              setConfirmDelete(false)
              if (e instanceof ApiError && e.code === "BORROWER_HAS_LOANS") {
                toast.error("Can't delete: this borrower has borrow records.")
              } else toast.error(errorMessage(e))
            },
          })
        }
      />
    </>
  )
}
