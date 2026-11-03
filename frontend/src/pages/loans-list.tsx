import { Link } from "react-router"
import { PlusIcon, SearchIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDashboard } from "@/features/dashboard/api"
import { useLoans, type LoanListParams } from "@/features/loans/api"
import { LoansTable } from "@/features/loans/loans-table"
import { usePageParam, useUrlParam, useUrlSearch } from "@/hooks/use-url-search"
import { useLibraryScope } from "@/lib/library-scope"

const PAGE_SIZE = 20

const TABS = [
  { value: "pending", label: "Pending" },
  { value: "borrowed", label: "Borrowed" },
  { value: "overdue", label: "Overdue" },
  { value: "returned", label: "Returned" },
  { value: "all", label: "All" },
] as const
type Tab = (typeof TABS)[number]["value"]

function tabFilter(tab: Tab): Pick<LoanListParams, "status" | "overdue"> {
  switch (tab) {
    case "pending":
      return { status: "PENDING" }
    case "borrowed":
      return { status: ["BORROWED", "PARTIALLY_RETURNED"] }
    case "overdue":
      return { overdue: true }
    case "returned":
      return { status: "RETURNED" }
    default:
      return {}
  }
}

const EMPTY_TEXT: Record<Tab, string> = {
  pending: "No pending requests.",
  borrowed: "No books borrowed now.",
  overdue: "Nothing overdue.",
  returned: "No returned records yet.",
  all: "No borrow records yet.",
}

export function LoansListPage() {
  const { libraryId } = useLibraryScope()
  const [rawTab, setTab] = useUrlParam("tab")
  // "active" was the old name of the Borrowed tab; keep old links working.
  const tab: Tab = TABS.some((t) => t.value === rawTab) ? (rawTab as Tab) : "borrowed"
  const search = useUrlSearch("q")
  const [page, setPage] = usePageParam()
  const dashboard = useDashboard(libraryId)

  const loans = useLoans({ libraryId, q: search.value, page, pageSize: PAGE_SIZE, ...tabFilter(tab) })

  const counts: Partial<Record<Tab, number>> = {
    pending: dashboard.data?.loans.pending,
    borrowed: dashboard.data?.loans.active,
    overdue: dashboard.data?.loans.overdue,
  }

  return (
    <>
      <PageHeader
        title="Borrow Records"
        actions={
          <Button nativeButton={false} render={<Link to="/borrow-records/new" />}>
            <PlusIcon data-icon="inline-start" />
            Borrow Books
          </Button>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="-mx-1 overflow-x-auto px-1">
          <Tabs value={tab} onValueChange={(v) => setTab(v === "borrowed" ? null : String(v))}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="px-2.5">
                  {t.label}
                  {!!counts[t.value] && (
                    <Badge
                      variant="secondary"
                      className={
                        t.value === "pending"
                          ? "bg-amber-500 text-amber-950"
                          : t.value === "overdue"
                            ? "bg-red-600 text-white"
                            : undefined
                      }
                    >
                      {counts[t.value]}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
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
              title={search.value ? "No matches found." : EMPTY_TEXT[tab]}
              action={
                tab === "borrowed" && !search.value ? (
                  <Button size="sm" nativeButton={false} render={<Link to="/borrow-records/new" />}>
                    <PlusIcon data-icon="inline-start" />
                    Borrow Books
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={loans.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
              <LoansTable loans={loans.data.data} showLibrary={!libraryId} />
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
    </>
  )
}
