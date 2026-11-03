import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  useApproveLoan,
  useCancelLoan,
  useRejectLoan,
  useUpdateLoan,
} from "@/features/loans/api"
import { lineIssuesFromError } from "@/features/loans/loan-errors"
import { LoanItemsEditor, type ItemLine } from "@/features/loans/loan-items-editor"
import { ApiError, errorMessage } from "@/lib/api"
import { todayInManila } from "@/lib/format"
import { submittedNameDiffers } from "@/features/loans/loan-utils"
import type { InsufficientCopiesDetails, InvalidBooksDetails, LoanDetail } from "@/types/api"

type DialogProps = { loan: LoanDetail; open: boolean; onOpenChange: (open: boolean) => void }

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </div>
  )
}

export function ApproveDialog({
  loan,
  open,
  onOpenChange,
  defaultLoanDays,
  onEditItems,
}: DialogProps & { defaultLoanDays?: number; onEditItems: () => void }) {
  const approve = useApproveLoan(loan.id)
  const [dueDate, setDueDate] = useState("")
  const [error, setError] = useState<unknown>(null)
  const today = todayInManila()
  const dateInvalid = !!dueDate && dueDate < today

  const close = (o: boolean) => {
    if (approve.isPending) return
    onOpenChange(o)
    if (!o) {
      setError(null)
      setDueDate("")
    }
  }

  const submit = () => {
    setError(null)
    approve.mutate(
      { dueDate: dueDate || undefined },
      {
        onSuccess: (l) => {
          toast.success(`Approved. Due ${l.dueDate}.`)
          close(false)
        },
        onError: (e) => setError(e),
      },
    )
  }

  let errorContent: React.ReactNode = null
  if (error instanceof ApiError && error.code === "INSUFFICIENT_COPIES") {
    const books = (error.details as InsufficientCopiesDetails | undefined)?.books ?? []
    errorContent = (
      <ErrorBox>
        <p className="font-medium">Not enough copies:</p>
        <ul className="mt-1 list-disc pl-5">
          {books.map((b) => (
            <li key={b.bookId}>
              {b.title}: {b.requested} requested, {b.available} available
            </li>
          ))}
        </ul>
      </ErrorBox>
    )
  } else if (error instanceof ApiError && error.code === "INVALID_BOOKS") {
    const ids = (error.details as InvalidBooksDetails | undefined)?.bookIds ?? []
    const titles = loan.items.filter((i) => ids.includes(i.bookId)).map((i) => i.book.title)
    errorContent = (
      <ErrorBox>
        Can't be borrowed: {titles.join(", ") || ids.join(", ")}. Remove them first.
      </ErrorBox>
    )
  } else if (error) {
    errorContent = <ErrorBox>{errorMessage(error)}</ErrorBox>
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve {loan.loanNumber}</DialogTitle>
          <DialogDescription>
            Release {loan.totalQuantity} {loan.totalQuantity === 1 ? "copy" : "copies"} to {loan.borrower.name}.
          </DialogDescription>
        </DialogHeader>
        {submittedNameDiffers(loan) && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
            Name on form <strong>“{loan.submittedName}”</strong> differs from borrower <strong>“{loan.borrower.name}”</strong>.
            Check their ID.
          </div>
        )}
        <Field data-invalid={dateInvalid}>
          <FieldLabel htmlFor="approve-due">Due date (optional)</FieldLabel>
          <Input
            id="approve-due"
            type="date"
            min={today}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={dateInvalid}
          />
          {!!defaultLoanDays && <FieldDescription>Default: {defaultLoanDays} days.</FieldDescription>}
          {dateInvalid && <FieldError>The due date can't be in the past.</FieldError>}
        </Field>
        {errorContent}
        <DialogFooter>
          {error instanceof ApiError && (error.code === "INSUFFICIENT_COPIES" || error.code === "INVALID_BOOKS") && (
            <Button
              variant="outline"
              onClick={() => {
                close(false)
                onEditItems()
              }}
            >
              Edit items
            </Button>
          )}
          <Button onClick={submit} disabled={approve.isPending || dateInvalid}>
            {approve.isPending && <Spinner data-icon="inline-start" />}
            Approve &amp; release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RejectDialog({ loan, open, onOpenChange }: DialogProps) {
  const reject = useRejectLoan(loan.id)
  const [reason, setReason] = useState("")
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const invalid = trimmed.length < 1 || trimmed.length > 500

  const close = (o: boolean) => {
    if (reject.isPending) return
    onOpenChange(o)
    if (!o) {
      setReason("")
      setTouched(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {loan.loanNumber}</DialogTitle>
          <DialogDescription>Not approved. No books will be released.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (invalid) return
            reject.mutate(
              { reason: trimmed },
              {
                onSuccess: (l) => {
                  toast.success(`${l.loanNumber} rejected.`)
                  close(false)
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }}
        >
          <FieldGroup>
            <Field data-invalid={touched && invalid}>
              <FieldLabel htmlFor="reject-reason">Reason</FieldLabel>
              <Textarea
                id="reject-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={touched && invalid}
              />
              {touched && invalid && <FieldError>Enter a reason.</FieldError>}
            </Field>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={reject.isPending}>
                {reject.isPending && <Spinner data-icon="inline-start" />}
                Reject request
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CancelDialog({ loan, open, onOpenChange }: DialogProps) {
  const cancel = useCancelLoan(loan.id)
  const [reason, setReason] = useState("")
  const tooLong = reason.trim().length > 500

  const close = (o: boolean) => {
    if (cancel.isPending) return
    onOpenChange(o)
    if (!o) setReason("")
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {loan.loanNumber}</DialogTitle>
          <DialogDescription>The borrower no longer wants the books.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (tooLong) return
            cancel.mutate(
              { reason: reason.trim() || undefined },
              {
                onSuccess: (l) => {
                  toast.success(`${l.loanNumber} cancelled.`)
                  close(false)
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }}
        >
          <FieldGroup>
            <Field data-invalid={tooLong}>
              <FieldLabel htmlFor="cancel-reason">Reason (optional)</FieldLabel>
              <Textarea
                id="cancel-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {tooLong && <FieldError>At most 500 characters.</FieldError>}
            </Field>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={cancel.isPending}>
                {cancel.isPending && <Spinner data-icon="inline-start" />}
                Cancel request
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ExtendDueDateDialog({ loan, open, onOpenChange }: DialogProps) {
  const update = useUpdateLoan(loan.id)
  const today = todayInManila()
  const [dueDate, setDueDate] = useState(loan.dueDate ?? "")
  const invalid = !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today

  const close = (o: boolean) => {
    if (update.isPending) return
    onOpenChange(o)
    if (!o) setDueDate(loan.dueDate ?? "")
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change due date</DialogTitle>
          <DialogDescription>Now due {loan.dueDate ?? "—"}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (invalid) return
            update.mutate(
              { dueDate },
              {
                onSuccess: (l) => {
                  toast.success(`Due date set to ${l.dueDate}.`)
                  close(false)
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }}
        >
          <FieldGroup>
            <Field data-invalid={!!dueDate && invalid}>
              <FieldLabel htmlFor="extend-due">New due date</FieldLabel>
              <Input
                id="extend-due"
                type="date"
                min={today}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-invalid={!!dueDate && invalid}
              />
              {!!dueDate && invalid && <FieldError>Choose today or a later date.</FieldError>}
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={update.isPending || invalid || dueDate === loan.dueDate}>
                {update.isPending && <Spinner data-icon="inline-start" />}
                Save due date
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditNotesDialog({ loan, open, onOpenChange }: DialogProps) {
  const update = useUpdateLoan(loan.id)
  const [notes, setNotes] = useState(loan.notes ?? "")
  const tooLong = notes.trim().length > 500

  const close = (o: boolean) => {
    if (update.isPending) return
    onOpenChange(o)
    if (!o) setNotes(loan.notes ?? "")
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit notes</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (tooLong) return
            update.mutate(
              { notes: notes.trim() || null },
              {
                onSuccess: () => {
                  toast.success("Notes saved.")
                  close(false)
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }}
        >
          <FieldGroup>
            <Field data-invalid={tooLong}>
              <FieldLabel htmlFor="loan-notes">Notes</FieldLabel>
              <Textarea id="loan-notes" rows={4} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
              {tooLong && <FieldError>At most 500 characters.</FieldError>}
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Spinner data-icon="inline-start" />}
                Save notes
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function linesFromLoan(loan: LoanDetail): ItemLine[] {
  return loan.items.map((i) => ({
    bookId: i.bookId,
    title: i.book.title,
    author: i.book.author,
    callNumber: i.book.callNumber,
    quantity: i.quantity,
    maxQuantity: 100,
    // Per spec, an archived book already on the request may stay in item edits; only approval rejects it.
    note: i.book.archived ? "Archived. Remove before approving." : null,
  }))
}

export function EditItemsDialog({ loan, open, onOpenChange }: DialogProps) {
  const update = useUpdateLoan(loan.id)
  const [lines, setLines] = useState<ItemLine[]>(() => linesFromLoan(loan))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const close = (o: boolean) => {
    if (update.isPending) return
    onOpenChange(o)
    if (!o) {
      setLines(linesFromLoan(loan))
      setIssues({})
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit requested books</DialogTitle>
        </DialogHeader>
        <LoanItemsEditor
          mode="staff"
          libraryId={loan.libraryId}
          lines={lines}
          onChange={(next) => {
            setLines(next)
            setIssues((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => next.some((l) => l.bookId === id))))
          }}
          issues={issues}
          maxBooks={50}
          disabled={update.isPending}
          invalid={lines.length === 0}
        />
        {lines.length === 0 && <p className="text-sm text-destructive">Keep at least one book.</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
        <DialogFooter>
          <Button
            disabled={update.isPending || lines.length === 0}
            onClick={() => {
              setError(null)
              update.mutate(
                { items: lines.map((l) => ({ bookId: l.bookId, quantity: l.quantity })) },
                {
                  onSuccess: () => {
                    toast.success("Books updated.")
                    close(false)
                  },
                  onError: (err) => {
                    const mapped = lineIssuesFromError(err, lines)
                    if (mapped) setIssues(mapped)
                    setError(errorMessage(err))
                  },
                },
              )
            }}
          >
            {update.isPending && <Spinner data-icon="inline-start" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
