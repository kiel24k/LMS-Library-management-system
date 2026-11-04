import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { PencilIcon, ShieldIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { PageHeader } from "@/components/page-header"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states"
import { OverdueBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { useBorrower, useDeleteBorrower } from "@/features/borrowers/api"
import { BorrowerFormDialog } from "@/features/borrowers/borrower-form-dialog"
import { LoansTable } from "@/features/loans/loans-table"
import { ApiError, errorMessage } from "@/lib/api"
import { formatDate, formatDueDate } from "@/lib/format"
import { isOpenStatus } from "@/lib/loan-status"
import { MustChangePasswordBadge } from "@/features/users/account-badge"
import type { Borrower } from "@/types/api"

function accountHint(b: Pick<Borrower, "email" | "account" | "mustChangePassword">): string {
  if (!b.account) {
    if (!b.email) return "Add an email address to send accept / reject emails and give them an account."
    return "An account is created when one of their requests is accepted. They then sign in with this email to see their books."
  }
  if (b.mustChangePassword) return "They still have the default password and will be asked to change it when they sign in."
  return "They sign in with this account; its My Books page shows their borrowed books and requests."
}

/**
 * "Online account" row: the account linked to this borrower — an ordinary account with a role, managed (password,
 * role, active) under Users → Accounts like every other account.
 */
function LinkedAccount({ borrower: b }: { borrower: Pick<Borrower, "account" | "mustChangePassword"> }) {
  const { can } = useAuth()
  if (!b.account) {
    return <span className="text-muted-foreground">None — created when one of their requests is accepted.</span>
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="break-all">{b.account.email}</span>
      <span className="flex flex-wrap justify-end gap-1">
        <Badge variant="secondary">
          <ShieldIcon data-icon="inline-start" />
          {b.account.role.name}
        </Badge>
        {b.account.active ? (
          <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">Active</Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        )}
        {b.mustChangePassword && <MustChangePasswordBadge />}
      </span>
      {can("users.view") && (
        <Link to="/users" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Manage in Users → Accounts
        </Link>
      )}
    </span>
  )
}

export function BorrowerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const query = useBorrower(id)
  const del = useDeleteBorrower()
  const { can } = useAuth()
  const canEdit = can("borrowers.update")
  const canDelete = can("borrowers.delete")
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
          canEdit || canDelete ? (
            <>
              {canEdit && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Button>
              )}
              {canDelete && (
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2Icon data-icon="inline-start" />
                  Delete
                </Button>
              )}
            </>
          ) : undefined
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
          <CardTitle>Email and online account</CardTitle>
          <CardDescription>{accountHint(b)}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            <div className="flex justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-muted-foreground">Email</dt>
              <dd className="min-w-0 text-right break-all">
                {b.email ? (
                  <a href={`mailto:${b.email}`} className="hover:underline">
                    {b.email}
                  </a>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-muted-foreground">Online account</dt>
              <dd className="min-w-0 text-right">
                <LinkedAccount borrower={b} />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

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
                      {can("books.view") ? (
                        <Link to={`/books/${item.bookId}`} className="font-medium hover:underline">
                          {item.book.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{item.book.title}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.outstanding} of {item.quantity}
                    </TableCell>
                    <TableCell>
                      {can("loans.view") ? (
                        <Link to={`/borrow-records/${loan.id}`} className="font-mono text-xs hover:underline">
                          {loan.loanNumber}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{loan.loanNumber}</span>
                      )}
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

      {canEdit && editing && <BorrowerFormDialog open onOpenChange={setEditing} borrower={b} />}
      <ConfirmDialog
        open={canDelete && confirmDelete}
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
