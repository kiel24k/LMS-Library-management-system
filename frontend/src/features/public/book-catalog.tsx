import { useRef } from "react"
import { CheckIcon, PlusIcon, SearchIcon, SearchXIcon } from "lucide-react"
import { cn } from "cn"

import { PaginationBar } from "@/components/pagination-bar"
import { EmptyState, ErrorState } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { BookCover } from "@/features/books/book-cover"
import { usePublicBooks } from "@/features/public/api"
import { useUrlParam, usePageParam, useUrlSearch } from "@/hooks/use-url-search"
import { plural } from "@/lib/format"
import type { PublicBook } from "@/types/api"

const PAGE_SIZE = 24
const ALL = "all"

/**
 * The public book grid: search, grouping filter and "Available only" (on unless the URL says `show=all`), with an
 * Add button per book. Filters live in the query string so Back/Forward and shared links keep them.
 */
export function BookCatalog({
  slug,
  categories,
  selected,
  full,
  onToggle,
}: {
  slug: string
  categories: { id: string; name: string }[]
  /** bookIds already in the request list. */
  selected: ReadonlySet<string>
  /** True when the request list can't take another book. */
  full: boolean
  onToggle: (book: PublicBook) => void
}) {
  const search = useUrlSearch("q", 300)
  const [categoryParam, setCategory] = useUrlParam("group")
  const [show, setShow] = useUrlParam("show")
  const [page, setPage] = usePageParam()
  const availableOnly = show !== ALL
  const categoryId = categoryParam && categories.some((c) => c.id === categoryParam) ? categoryParam : null
  const books = usePublicBooks(slug, { q: search.value, categoryId, available: availableOnly, page, pageSize: PAGE_SIZE })
  const topRef = useRef<HTMLElement>(null)
  const filtered = !!search.value.trim() || !!categoryId

  const clearFilters = () => {
    search.onChange("")
    setCategory(null)
  }

  return (
    <section ref={topRef} aria-label="Books" className="flex min-w-0 scroll-mt-20 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:flex-row sm:items-center">
        <InputGroup className="h-9 flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Search by title or author"
            value={search.input}
            onChange={(e) => search.onChange(e.target.value)}
            aria-label="Search books"
          />
        </InputGroup>
        {categories.length > 0 && (
          <Select
            items={[{ value: ALL, label: "All groupings" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            value={categoryId ?? ALL}
            onValueChange={(v) => setCategory(!v || v === ALL ? null : String(v))}
          >
            <SelectTrigger className="h-9 w-full sm:w-48" aria-label="Grouping">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All groupings</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 px-1 sm:pl-2">
          <Switch id="available-only" checked={availableOnly} onCheckedChange={(on) => setShow(on ? null : ALL)} />
          <Label htmlFor="available-only" className="cursor-pointer text-sm whitespace-nowrap">
            Available only
          </Label>
        </div>
      </div>

      <div className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {books.data && (
          <span>
            {plural(books.data.total, availableOnly ? "book on the shelf" : "book", availableOnly ? "books on the shelf" : "books")}
          </span>
        )}
        {books.isFetching && !books.isPending && <Spinner className="size-3.5" aria-hidden role={undefined} />}
      </div>

      {books.isPending ? (
        <ul className={GRID} aria-busy="true" aria-label="Loading books">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <Skeleton className="aspect-[3/4] rounded-none" />
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="mt-1 h-7" />
              </div>
            </li>
          ))}
        </ul>
      ) : books.isError ? (
        <ErrorState className="bg-background" error={books.error} onRetry={() => void books.refetch()} title="Couldn't load the books" />
      ) : books.data.data.length === 0 ? (
        <EmptyState
          className="bg-background py-12"
          icon={<SearchXIcon />}
          title={filtered ? "No books match" : availableOnly ? "No books on the shelf right now" : "No books yet"}
          description={
            availableOnly
              ? "Books that are borrowed right now are hidden. You can still ask for them."
              : filtered
                ? "Try other words or another grouping."
                : undefined
          }
          action={
            availableOnly || filtered ? (
              <div className="flex flex-wrap justify-center gap-2">
                {availableOnly && (
                  <Button size="sm" variant="outline" onClick={() => setShow(ALL)}>
                    Show books that are out too
                  </Button>
                )}
                {filtered && (
                  <Button size="sm" variant="ghost" onClick={clearFilters}>
                    Clear search
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className={cn(GRID, books.isPlaceholderData && "opacity-60 transition-opacity")}>
            {books.data.data.map((book) => (
              <li key={book.id}>
                <BookCard book={book} added={selected.has(book.id)} full={full} onToggle={() => onToggle(book)} />
              </li>
            ))}
          </ul>
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={books.data.total}
            isFetching={books.isFetching}
            onPageChange={(p) => {
              setPage(p)
              topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}
          />
        </>
      )}
    </section>
  )
}

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"

function BookCard({ book, added, full, onToggle }: { book: PublicBook; added: boolean; full: boolean; onToggle: () => void }) {
  return (
    <article
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-shadow hover:shadow-md",
        added && "ring-2 ring-primary",
      )}
    >
      <div className="relative">
        <BookCover src={book.coverUrl} className="w-full rounded-none border-0 border-b [&_svg]:size-10" />
        <Badge
          className={cn(
            "absolute top-2 left-2 shadow-sm",
            book.available
              ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950"
              : "bg-amber-100 text-amber-900 dark:bg-amber-400 dark:text-amber-950",
          )}
        >
          {book.available ? "Available" : "Out now"}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium break-words" title={book.title}>
          {book.title}
        </h3>
        {book.author && <p className="truncate text-xs text-muted-foreground">{book.author}</p>}
        {book.category && <p className="truncate text-xs text-muted-foreground/80">{book.category.name}</p>}
        <div className="mt-auto pt-2">
          <Button
            type="button"
            size="sm"
            variant={added ? "secondary" : "default"}
            className="w-full"
            disabled={!added && full}
            aria-pressed={added}
            aria-label={`Add “${book.title}” to your request`}
            onClick={onToggle}
          >
            {added ? <CheckIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
            {added ? "Added" : "Add"}
          </Button>
        </div>
      </div>
    </article>
  )
}
