import { useState } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import { SearchIcon } from "lucide-react"

import { PublicShell } from "@/components/public-shell"
import { ErrorState, PageSkeleton } from "@/components/states"
import { LoanStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { usePublicLibrary, usePublicRequestStatus } from "@/features/public/api"
import { ApiError, errorMessage } from "@/lib/api"
import { formatDateTime, formatDueDate, normalizeRefNumber } from "@/lib/format"
import { PUBLIC_STATUS_TEXT } from "@/lib/loan-status"
import { NotAvailable } from "@/pages/public-borrow"

export function PublicStatusPage() {
  const { slug = "" } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  // "?loan=" is the old name of "?ref="; links that were already shared keep working.
  const rawChecked = (searchParams.get("ref") ?? searchParams.get("loan"))?.trim()
  const checked = rawChecked ? normalizeRefNumber(rawChecked) : null
  const [input, setInput] = useState(checked ?? "")
  const info = usePublicLibrary(slug)
  const status = usePublicRequestStatus(slug, checked)

  if (info.isPending)
    return (
      <PublicShell>
        <PageSkeleton />
      </PublicShell>
    )
  if (info.isError) {
    if (info.error instanceof ApiError && info.error.status === 404) return <NotAvailable what="This status page" />
    return (
      <PublicShell>
        <ErrorState error={info.error} onRetry={() => void info.refetch()} />
      </PublicShell>
    )
  }

  const notFound = status.error instanceof ApiError && status.error.status === 404

  return (
    <PublicShell title={info.data.library.name}>
      <Card>
        <CardHeader>
          <CardTitle>Check your request</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              if (!input.trim()) return
              const v = normalizeRefNumber(input)
              setSearchParams({ ref: v }, { replace: true })
              if (v === checked) void status.refetch()
            }}
          >
            <Field className="flex-1">
              <FieldLabel htmlFor="ref-number">Request number</FieldLabel>
              <Input
                id="ref-number"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="BR-000123"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Button type="submit" disabled={!input.trim() || status.isFetching}>
              <SearchIcon data-icon="inline-start" />
              Check
            </Button>
          </form>
        </CardContent>
      </Card>

      {checked && (
        <Card aria-live="polite">
          <CardContent>
            {status.isPending ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : status.isError ? (
              <p className={notFound ? "text-sm" : "text-sm text-destructive"}>
                {notFound
                  ? `Request “${checked}” not found. Check the number.`
                  : errorMessage(status.error)}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xl font-bold">{status.data.loanNumber}</span>
                  <LoanStatusBadge status={status.data.status} />
                </div>
                <p className="text-sm">{PUBLIC_STATUS_TEXT[status.data.status]}</p>
                <dl className="grid gap-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Requested</dt>
                    <dd>{formatDateTime(status.data.requestedAt)}</dd>
                  </div>
                  {status.data.dueDate && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Due date</dt>
                      <dd className="font-medium">{formatDueDate(status.data.dueDate)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-center text-sm">
        <Link to={`/borrow/${encodeURIComponent(slug)}`} className="underline underline-offset-4">
          Back to borrow form
        </Link>
      </p>
    </PublicShell>
  )
}
