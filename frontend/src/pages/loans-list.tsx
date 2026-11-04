import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { PlusIcon, SearchIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { useAuth } from "@/features/auth/use-auth"
import { useDashboard } from "@/features/dashboard/api"
import { useLoans } from "@/features/loans/api"
import { LoansTable } from "@/features/loans/loans-table"
import { StatusFilter } from "@/features/loans/status-filter"
import { isDefaultStatusFilter, parseStatusFilter, writeStatusFilter, type StatusFilterValue } from "@/features/loans/status-filter-state"
import { QuickDecisionButtons, QuickDecisionDialogs, type QuickDecision } from "@/features/loans/quick-decision"
import { usePageParam, useUrlSearch } from "@/hooks/use-url-search"
import { useLibraryScope } from "@/lib/library-scope"

const PAGE_SIZE = 20

function emptyText(f: StatusFilterValue): string {
  if (isDefaultStatusFilter(f)) return "No books borrowed now."
  if (f.overdue) return "Nothing overdue."
  if (f.statuses.length === 1 && f.statuses[0] === "PENDING") return "No pending requests."
  if (f.statuses.length === 0) return "No borrow records yet."
  return "No borrow records with these statuses."
}

export function LoansListPage() {
  const { libraryId } = useLibraryScope()
  const { can } = useAuth()
  const canBorrow = can("loans.create")
  const [searchParams, setSearchParams] = useSearchParams()
  // ?status=PENDING,BORROWED (or all) + ?overdue=1; old ?tab= links (dashboard, bookmarks) still work.
  const filter = parseStatusFilter(searchParams)
  const setFilter = (next: StatusFilterValue) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      writeStatusFilter(params, next)
      params.delete("page")
      return params
    })
  const search = useUrlSearch("q")
  const [page, setPage] = usePageParam()
  // Counts in the status filter come from the dashboard numbers: only fetched with dashboard.view (no counts otherwise).
  const dashboard = useDashboard(libraryId, { enabled: can("dashboard.view") })

  const loans = useLoans({
    libraryId,
    q: search.value,
    page,
    pageSize: PAGE_SIZE,
    status: filter.statuses.length ? filter.statuses : undefined,
    overdue: filter.overdue || undefined,
  })
  // Pending records in the list: Accept / Reject right from the list (loans.approve), without opening each record.
  const quickDecide = can("loans.approve") && !filter.overdue && (filter.statuses.length === 0 || filter.statuses.includes("PENDING"))
  const [decision, setDecision] = useState<QuickDecision | null>(null)

  const counts = { pending: dashboard.data?.loans.pending, overdue: dashboard.data?.loans.overdue }

  return (
    <>
      <PageHeader
        title="Borrow Records"
        actions={
          canBorrow ? (
            <Button nativeButton={false} render={<Link to="/borrow-records/new" />}>
              <PlusIcon data-icon="inline-start" />
              Borrow Books
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <StatusFilter value={filter} onChange={setFilter} counts={counts} />
        <InputGroup className="md:max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Borrower, ID number or BR-000123"
            value={search.input}
            onChange={(e) => search.onChange(e.target.value)}
            aria-label="Search borrow records"
          />
        </InputGroup>
      </div>

      <Card>
        <CardContent>
          {loans.isPending ? (
            <TableSkeleton columns={7} />
          ) : loans.isError ? (
            <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />
          ) : loans.data.data.length === 0 ? (
            <EmptyState
              title={search.value ? "No matches found." : emptyText(filter)}
              action={
                isDefaultStatusFilter(filter) && !search.value && canBorrow ? (
                  <Button size="sm" nativeButton={false} render={<Link to="/borrow-records/new" />}>
                    <PlusIcon data-icon="inline-start" />
                    Borrow Books
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={loans.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
              <LoansTable
                loans={loans.data.data}
                showLibrary={!libraryId}
                rowActions={
                  quickDecide
                    ? (loan) => (loan.status === "PENDING" ? <QuickDecisionButtons loan={loan} onPick={setDecision} /> : null)
                    : undefined
                }
              />
              <PaginationBar
                page={page}
                pageSize={PAGE_SIZE}
                total={loans.data.total}
                onPageChange={setPage}
                isFetching={loans.isPlaceholderData}
              />
            </div>
          )}
          {loans.data && loans.data.data.length === 0 && page > 1 && (
            <div className="mt-2 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setPage(1)}>
                Back to page 1
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {quickDecide && <QuickDecisionDialogs decision={decision} onClose={() => setDecision(null)} />}
    </>
  )
}
