import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCheckIcon, CheckIcon, ClipboardCheckIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { loanKeys, useRecordReturn } from "@/features/loans/api"
import { ApiError, errorMessage } from "@/lib/api"
import { plural } from "@/lib/format"
import type { LoanDetail, LoanItem, ReturnExceedsDetails } from "@/types/api"

type Counts = { good: number; damaged: number; lost: number }
type CountKey = keyof Counts
const ZERO: Counts = { good: 0, damaged: 0, lost: 0 }
const KEYS: { key: CountKey; label: string }[] = [
  { key: "good", label: "Good" },
  { key: "damaged", label: "Damaged" },
  { key: "lost", label: "Lost" },
]

const sum = (c: Counts) => c.good + c.damaged + c.lost
const alreadyReturned = (item: LoanItem) => item.returnedGood + item.returnedDamaged + item.lost

function rowStatus(item: LoanItem, c: Counts): { tone: "done" | "ok" | "partial" | "none"; text: string } {
  const counted = sum(c)
  if (item.outstanding === 0) return { tone: "done", text: "" }
  if (counted === 0) return { tone: "none", text: "" }
  if (counted < item.outstanding) return { tone: "partial", text: `${counted} of ${item.outstanding} counted` }
  const extras = [c.damaged && `${c.damaged} damaged`, c.lost && `${c.lost} lost`].filter(Boolean).join(", ")
  return { tone: "ok", text: `All counted${extras ? ` (${extras})` : ""}` }
}

/** Return check for an open loan: count what was handed back, then confirm. */
export function ReturnCheck({ loan }: { loan: LoanDetail }) {
  const qc = useQueryClient()
  const recordReturn = useRecordReturn(loan.id)
  const [counts, setCounts] = useState<Record<string, Counts>>({})
  const [returnedByName, setReturnedByName] = useState("")
  const [notes, setNotes] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const get = (id: string) => counts[id] ?? ZERO
  const openItems = loan.items.filter((i) => i.outstanding > 0)
  const totalOutstanding = openItems.reduce((s, i) => s + i.outstanding, 0)
  const totals = loan.items.reduce(
    (acc, i) => {
      const c = get(i.id)
      return { good: acc.good + c.good, damaged: acc.damaged + c.damaged, lost: acc.lost + c.lost }
    },
    { ...ZERO },
  )
  const counted = sum(totals)
  const remaining = totalOutstanding - counted
  const mismatches = openItems.filter((i) => sum(get(i.id)) < i.outstanding)
  const tooLong = returnedByName.trim().length > 120 || notes.trim().length > 500

  const setCount = (item: LoanItem, key: CountKey, raw: number) => {
    const current = get(item.id)
    const others = sum(current) - current[key]
    // Inputs can never exceed what is still outstanding.
    const value = Math.max(0, Math.min(item.outstanding - others, Number.isFinite(raw) ? Math.trunc(raw) : 0))
    setCounts((prev) => ({ ...prev, [item.id]: { ...current, [key]: value } }))
    setRowErrors((prev) => {
      if (!prev[item.id]) return prev
      const next = { ...prev }
      delete next[item.id]
      return next
    })
  }

  const fillGood = (item: LoanItem) =>
    setCounts((prev) => ({ ...prev, [item.id]: { good: item.outstanding, damaged: 0, lost: 0 } }))

  const fillAllGood = () =>
    setCounts(Object.fromEntries(openItems.map((i) => [i.id, { good: i.outstanding, damaged: 0, lost: 0 }])))

  const reset = () => {
    setCounts({})
    setRowErrors({})
    setFormError(null)
  }

  const submit = () => {
    setFormError(null)
    const items = openItems
      .map((i) => ({ loanItemId: i.id, ...get(i.id) }))
      .filter((i) => i.good + i.damaged + i.lost > 0)
    recordReturn.mutate(
      {
        items,
        returnedByName: returnedByName.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (updated) => {
          setConfirmOpen(false)
          setCounts({})
          setReturnedByName("")
          setNotes("")
          setRowErrors({})
          toast.success(
            updated.status === "RETURNED"
              ? "Return saved. Record closed."
              : `Return saved. ${plural(updated.outstandingTotal, "copy", "copies")} still out.`,
          )
        },
        onError: (error) => {
          setConfirmOpen(false)
          const message = errorMessage(error)
          setFormError(message)
          toast.error(message)
          if (error instanceof ApiError && error.code === "RETURN_EXCEEDS_OUTSTANDING") {
            const ids = (error.details as ReturnExceedsDetails | undefined)?.loanItemIds ?? []
            setRowErrors(
              Object.fromEntries(ids.map((id) => [id, "Too many. Please count again."])),
            )
          }
          if (error instanceof ApiError && (error.code === "RETURN_EXCEEDS_OUTSTANDING" || error.code === "INVALID_STATUS")) {
            void qc.invalidateQueries({ queryKey: loanKeys.detail(loan.id) })
          }
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheckIcon className="size-4" />
          Return check
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={fillAllGood} disabled={recordReturn.isPending}>
            <CheckCheckIcon data-icon="inline-start" />
            All returned in good condition
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={recordReturn.isPending || counted === 0}>
            <RotateCcwIcon data-icon="inline-start" />
            Reset counts
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {loan.items.map((item) => {
            const c = get(item.id)
            const status = rowStatus(item, c)
            const rowError = rowErrors[item.id]
            const done = item.outstanding === 0
            return (
              <li
                key={item.id}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-center",
                  done && "bg-muted/40 opacity-75",
                  !done && status.tone === "partial" && "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10",
                  !done && status.tone === "ok" && "border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/10",
                  rowError && "border-destructive bg-destructive/5",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{item.book.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[item.book.author, item.book.callNumber].filter(Boolean).join(" · ")}
                  </p>
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <div className="flex gap-1">
                      <dt className="text-muted-foreground">Borrowed</dt>
                      <dd className="font-medium tabular-nums">{item.quantity}</dd>
                    </div>
                    <div className="flex gap-1" title={`${item.returnedGood} good, ${item.returnedDamaged} damaged, ${item.lost} lost`}>
                      <dt className="text-muted-foreground">Already returned</dt>
                      <dd className="font-medium tabular-nums">
                        {alreadyReturned(item)}
                        {(item.returnedDamaged > 0 || item.lost > 0) && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            ({[item.returnedDamaged && `${item.returnedDamaged} damaged`, item.lost && `${item.lost} lost`].filter(Boolean).join(", ")})
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-muted-foreground">Still out</dt>
                      <dd className={cn("font-medium tabular-nums", item.outstanding > 0 && "text-amber-700 dark:text-amber-300")}>
                        {item.outstanding}
                      </dd>
                    </div>
                  </dl>
                  {status.text && (
                    <p
                      className={cn(
                        "mt-1 text-xs font-medium",
                        status.tone === "partial" && "text-amber-800 dark:text-amber-200",
                        status.tone === "ok" && "text-emerald-800 dark:text-emerald-200",
                      )}
                    >
                      {status.text}
                    </p>
                  )}
                  {rowError && (
                    <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                      {rowError}
                    </p>
                  )}
                </div>
                {done ? (
                  <Badge variant="outline" className="self-start lg:self-center">
                    <CheckIcon data-icon="inline-start" />
                    Done
                  </Badge>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    {KEYS.map(({ key, label }) => (
                      <div key={key} className="flex flex-col gap-1">
                        <label htmlFor={`ret-${item.id}-${key}`} className="text-xs text-muted-foreground">
                          {label}
                        </label>
                        <Input
                          id={`ret-${item.id}-${key}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={item.outstanding - (sum(c) - c[key])}
                          value={c[key]}
                          onChange={(e) => setCount(item, key, e.target.valueAsNumber)}
                          onFocus={(e) => e.target.select()}
                          disabled={recordReturn.isPending}
                          className={cn(
                            "h-8 w-16 text-center tabular-nums",
                            key === "damaged" && c.damaged > 0 && "border-amber-500",
                            key === "lost" && c.lost > 0 && "border-destructive",
                          )}
                          aria-label={`${label} copies of ${item.book.title}`}
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => fillGood(item)}
                      disabled={recordReturn.isPending}
                    >
                      <CheckIcon data-icon="inline-start" />
                      All good
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={returnedByName.trim().length > 120}>
            <FieldLabel htmlFor="returnedByName">Returned by (optional)</FieldLabel>
            <Input
              id="returnedByName"
              value={returnedByName}
              onChange={(e) => setReturnedByName(e.target.value)}
              placeholder={loan.borrower.name}
              maxLength={120}
              disabled={recordReturn.isPending}
            />
            {returnedByName.trim().length > 120 && <FieldError>At most 120 characters.</FieldError>}
          </Field>
          <Field data-invalid={notes.trim().length > 500}>
            <FieldLabel htmlFor="returnNotes">Notes (optional)</FieldLabel>
            <Textarea
              id="returnNotes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              disabled={recordReturn.isPending}
            />
            {notes.trim().length > 500 && <FieldError>At most 500 characters.</FieldError>}
          </Field>
        </div>

        {/* Live summary */}
        <div
          aria-live="polite"
          className={cn(
            "rounded-lg border p-3 text-sm",
            counted === 0 && "bg-muted/40",
            counted > 0 && remaining > 0 && "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10",
            counted > 0 && remaining === 0 && "border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/10",
          )}
        >
          {counted === 0 ? (
            <p className="text-muted-foreground">Nothing counted yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                Counted {counted} of {totalOutstanding}: {totals.good} good, {totals.damaged} damaged, {totals.lost} lost.
              </p>
              {remaining > 0 ? (
                <p className="text-amber-800 dark:text-amber-200">
                  {plural(remaining, "copy", "copies")} still out
                  {mismatches.length > 0 && `: ${mismatches.map((m) => m.book.title).join(", ")}`}.
                </p>
              ) : (
                <p className="text-emerald-800 dark:text-emerald-200">All copies counted. Record will close.</p>
              )}
              {totals.lost > 0 && <p className="text-destructive">Lost copies are removed from stock.</p>}
            </div>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={counted === 0 || tooLong || recordReturn.isPending}
          >
            {recordReturn.isPending && <Spinner data-icon="inline-start" />}
            Record return…
          </Button>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={(open) => !recordReturn.isPending && setConfirmOpen(open)}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Record this return?</AlertDialogTitle>
              <AlertDialogDescription>
                {remaining === 0
                  ? "The record will be closed."
                  : `${plural(remaining, "copy", "copies")} will still be out.`}
                {totals.lost > 0 && " Lost copies are removed from stock."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex flex-col gap-1 text-sm">
              {openItems
                .filter((i) => sum(get(i.id)) > 0)
                .map((i) => {
                  const c = get(i.id)
                  return (
                    <li key={i.id} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{i.book.title}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {[c.good && `${c.good} good`, c.damaged && `${c.damaged} damaged`, c.lost && `${c.lost} lost`]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </li>
                  )
                })}
              {returnedByName.trim() && (
                <li className="pt-1 text-muted-foreground">Returned by: {returnedByName.trim()}</li>
              )}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={recordReturn.isPending}>Back</AlertDialogCancel>
              <Button onClick={submit} disabled={recordReturn.isPending}>
                {recordReturn.isPending && <Spinner data-icon="inline-start" />}
                Confirm return
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
