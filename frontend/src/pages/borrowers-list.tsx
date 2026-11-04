import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { useBorrowers } from "@/features/borrowers/api"
import { BorrowerFormDialog } from "@/features/borrowers/borrower-form-dialog"
import { usePageParam, useUrlSearch } from "@/hooks/use-url-search"

const PAGE_SIZE = 20

export function BorrowersListPage() {
  const navigate = useNavigate()
  const search = useUrlSearch("q")
  const [page, setPage] = usePageParam()
  const [adding, setAdding] = useState(false)
  const canAdd = useAuth().can("borrowers.create")
  const borrowers = useBorrowers({ q: search.value, page, pageSize: PAGE_SIZE })

  return (
    <>
      <PageHeader
        title="Borrowers"
        actions={
          canAdd ? (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon data-icon="inline-start" />
              Add borrower
            </Button>
          ) : undefined
        }
      />
      <InputGroup className="sm:max-w-sm">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="Name, ID number, contact or email"
          value={search.input}
          onChange={(e) => search.onChange(e.target.value)}
          aria-label="Search borrowers"
        />
      </InputGroup>

      <Card>
        <CardContent>
          {borrowers.isPending ? (
            <TableSkeleton columns={5} />
          ) : borrowers.isError ? (
            <ErrorState error={borrowers.error} onRetry={() => void borrowers.refetch()} />
          ) : borrowers.data.data.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title={search.value ? "No matching borrowers" : "No borrowers yet"}
              action={
                !search.value && canAdd ? (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <PlusIcon data-icon="inline-start" />
                    Add borrower
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={borrowers.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>ID number</TableHead>
                    <TableHead>Affiliation</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Current borrows</TableHead>
                    <TableHead className="text-right">Copies out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {borrowers.data.data.map((b) => (
                    <TableRow key={b.id} className="cursor-pointer" onClick={() => void navigate(`/borrowers/${b.id}`)}>
                      <TableCell className="font-medium">
                        <Link to={`/borrowers/${b.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {b.name}
                        </Link>
                        {b.email && (
                          <div className="max-w-64 truncate text-xs font-normal text-muted-foreground" title={b.email}>
                            {b.email}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{b.idNumber ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{b.affiliation ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{b.contact ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.activeLoans}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${b.outstandingCopies > 0 ? "font-medium text-amber-700 dark:text-amber-300" : ""}`}
                      >
                        {b.outstandingCopies}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar
                page={page}
                pageSize={PAGE_SIZE}
                total={borrowers.data.total}
                onPageChange={setPage}
                isFetching={borrowers.isPlaceholderData}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {canAdd && adding && (
        <BorrowerFormDialog open onOpenChange={setAdding} onSaved={(b) => void navigate(`/borrowers/${b.id}`)} />
      )}
    </>
  )
}
