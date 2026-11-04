import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { BookOpenIcon, ListPlusIcon, PlusIcon, SearchIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { useBooks } from "@/features/books/api"
import { AvailabilityBadge } from "@/features/books/availability-badge"
import { BookActionsMenu } from "@/features/books/book-actions"
import { BookCover } from "@/features/books/book-cover"
import { BookFormDialog } from "@/features/books/book-form-dialog"
import { useCategories } from "@/features/categories/api"
import { usePageParam, useUrlParam, useUrlSearch } from "@/hooks/use-url-search"
import { useLibraryScope } from "@/lib/library-scope"
import type { Book } from "@/types/api"

const PAGE_SIZE = 20
const ALL = "all"
/** The ways to add books are used by older staff: 44px tall with 16px text. */
const ADD_BUTTON = "h-11 px-4 text-base has-data-[icon=inline-start]:pl-3.5 [&_svg:not([class*='size-'])]:size-5"

export function BooksListPage() {
  const { libraryId, libraries } = useLibraryScope()
  const { can } = useAuth()
  const canCreate = can("books.create")
  const navigate = useNavigate()
  const search = useUrlSearch("q")
  const [categoryParam, setCategory] = useUrlParam("category")
  const [availableParam, setAvailable] = useUrlParam("available")
  const [archivedParam, setArchived] = useUrlParam("archived")
  const [page, setPage] = usePageParam()
  const categories = useCategories(libraryId)
  const [dialog, setDialog] = useState<{ type: "add" } | { type: "edit"; book: Book } | null>(null)

  const categoryId = libraryId && categoryParam ? categoryParam : null
  const books = useBooks({
    libraryId,
    categoryId,
    q: search.value,
    available: availableParam === "1",
    includeArchived: archivedParam === "1",
    page,
    pageSize: PAGE_SIZE,
  })
  const filtered = !!(search.value || categoryId || availableParam === "1")

  const categoryItems = [
    { value: ALL, label: libraryId ? "All categories" : "Pick a library first" },
    ...(categories.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.bookCount})` })),
  ]

  return (
    <>
      <PageHeader
        title="Books"
        actions={
          canCreate && (
            <>
              <Button variant="outline" className={ADD_BUTTON} nativeButton={false} render={<Link to="/books/add-many" />}>
                <ListPlusIcon data-icon="inline-start" />
                Add many books
              </Button>
              <Button className={ADD_BUTTON} onClick={() => setDialog({ type: "add" })} disabled={libraries.length === 0}>
                <PlusIcon data-icon="inline-start" />
                Add book
              </Button>
            </>
          )
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <InputGroup className="lg:max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Title, author, ISBN or call number"
            value={search.input}
            onChange={(e) => search.onChange(e.target.value)}
            aria-label="Search books"
          />
        </InputGroup>
        <Select
          items={categoryItems}
          value={categoryId ?? ALL}
          onValueChange={(v) => setCategory(!v || v === ALL ? null : String(v))}
          disabled={!libraryId}
        >
          <SelectTrigger className="w-full lg:w-56" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryItems.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-4">
          <Label className="gap-2 font-normal">
            <Switch checked={availableParam === "1"} onCheckedChange={(c) => setAvailable(c ? "1" : null)} />
            Available only
          </Label>
          <Label className="gap-2 font-normal">
            <Switch checked={archivedParam === "1"} onCheckedChange={(c) => setArchived(c ? "1" : null)} />
            Show archived
          </Label>
        </div>
      </div>

      <Card>
        <CardContent>
          {books.isPending ? (
            <TableSkeleton columns={7} />
          ) : books.isError ? (
            <ErrorState error={books.error} onRetry={() => void books.refetch()} />
          ) : books.data.data.length === 0 ? (
            libraries.length === 0 ? (
              <EmptyState
                icon={<BookOpenIcon />}
                title={canCreate ? "Create a library first" : "No libraries yet"}
                description={can("libraries.create") ? undefined : "Ask someone who manages libraries to add one."}
                action={
                  can("libraries.view") && (
                    <Button size="sm" nativeButton={false} render={<Link to="/libraries" />}>
                      Go to libraries
                    </Button>
                  )
                }
              />
            ) : (
              <EmptyState
                icon={<BookOpenIcon />}
                title={filtered ? "No matching books" : "No books yet"}
                action={
                  !filtered &&
                  canCreate && (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="outline" className={ADD_BUTTON} nativeButton={false} render={<Link to="/books/add-many" />}>
                        Add many books
                      </Button>
                      <Button className={ADD_BUTTON} onClick={() => setDialog({ type: "add" })}>
                        Add book
                      </Button>
                    </div>
                  )
                }
              />
            )
          ) : (
            <div className={books.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Picture</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    {!libraryId && <TableHead>Library</TableHead>}
                    <TableHead>Call no.</TableHead>
                    <TableHead>Copies</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {books.data.data.map((book) => (
                    <TableRow
                      key={book.id}
                      className="cursor-pointer"
                      onClick={() => void navigate(`/books/${book.id}`)}
                    >
                      <TableCell className="w-16 py-2">
                        <BookCover src={book.coverUrl} />
                      </TableCell>
                      {/* min-w keeps the title readable on a phone (the table scrolls sideways instead). */}
                      <TableCell className="min-w-40 max-w-80">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/books/${book.id}`}
                            className="truncate font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {book.title}
                          </Link>
                          {book.archived && <Badge variant="secondary">Archived</Badge>}
                        </div>
                        {book.author && <div className="truncate text-xs text-muted-foreground">{book.author}</div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{book.category?.name ?? "—"}</TableCell>
                      {!libraryId && <TableCell className="text-muted-foreground">{book.library.name}</TableCell>}
                      <TableCell className="font-mono text-xs">{book.callNumber ?? "—"}</TableCell>
                      <TableCell>
                        <AvailabilityBadge book={book} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <BookActionsMenu book={book} onEdit={() => setDialog({ type: "edit", book })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar
                page={page}
                pageSize={PAGE_SIZE}
                total={books.data.total}
                onPageChange={setPage}
                isFetching={books.isPlaceholderData}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <BookFormDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          book={dialog.type === "edit" ? dialog.book : undefined}
          libraries={libraries}
          defaultLibraryId={libraryId}
        />
      )}
    </>
  )
}
