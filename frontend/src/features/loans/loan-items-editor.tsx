import { useState } from "react"
import { BookIcon, CheckIcon, MinusIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useBooks } from "@/features/books/api"
import { usePublicBooks } from "@/features/public/api"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { errorMessage } from "@/lib/api"
import { plural } from "@/lib/format"

export type ItemLine = {
  bookId: string
  title: string
  author: string | null
  callNumber: string | null
  quantity: number
  /** Client-side cap: staff = available copies (≤ 100), public = 5. */
  maxQuantity: number
  /** Extra info shown under the title (e.g. "Currently out"). */
  note?: string | null
}

type PickerResult = {
  id: string
  title: string
  author: string | null
  callNumber: string | null
  category: string | null
  /** staff: exact available count; public: null (only a flag). */
  availableCopies: number | null
  totalCopies: number | null
  available: boolean
}

const PICKER_PAGE_SIZE = 8

/**
 * Quantity box that keeps the raw text while typing (so clearing it and typing "3" gives 3, not
 * "13" clamped to the max) and only clamps/commits on blur or Enter. Empty or invalid text reverts.
 */
function QuantityInput({
  line,
  disabled,
  invalid,
  onCommit,
}: {
  line: ItemLine
  disabled?: boolean
  invalid: boolean
  onCommit: (quantity: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() !== "" && Number.isFinite(n)) onCommit(n)
    setDraft(null)
  }
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      max={line.maxQuantity}
      value={draft ?? line.quantity}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft !== null) {
          // Commit instead of submitting the surrounding form with the old quantity.
          e.preventDefault()
          commit()
        }
      }}
      onFocus={(e) => e.target.select()}
      className="h-7 w-14 text-center tabular-nums"
      aria-label={`Quantity of ${line.title}`}
      aria-invalid={invalid}
    />
  )
}

function StaffResults({
  libraryId,
  q,
  render,
}: {
  libraryId: string
  q: string
  render: (state: { results: PickerResult[]; total: number; loading: boolean; error: unknown }) => React.ReactNode
}) {
  const books = useBooks({ libraryId, q, pageSize: PICKER_PAGE_SIZE, page: 1 })
  const results: PickerResult[] = (books.data?.data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    callNumber: b.callNumber,
    category: b.category?.name ?? null,
    availableCopies: b.availableCopies,
    totalCopies: b.totalCopies,
    available: b.availableCopies > 0,
  }))
  return render({ results, total: books.data?.total ?? 0, loading: books.isPending, error: books.error })
}

function PublicResults({
  slug,
  q,
  categoryId,
  render,
}: {
  slug: string
  q: string
  categoryId: string | null
  render: (state: { results: PickerResult[]; total: number; loading: boolean; error: unknown }) => React.ReactNode
}) {
  const books = usePublicBooks(slug, { q, categoryId, pageSize: PICKER_PAGE_SIZE, page: 1 })
  const results: PickerResult[] = (books.data?.data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    callNumber: b.callNumber,
    category: b.category?.name ?? null,
    availableCopies: null,
    totalCopies: null,
    available: b.available,
  }))
  return render({ results, total: books.data?.total ?? 0, loading: books.isPending, error: books.error })
}

/**
 * Book picker + selected lines with quantities. Shared by the staff borrow form,
 * the public borrow form and the "Edit items" dialog of a pending loan.
 */
export function LoanItemsEditor({
  mode,
  libraryId,
  slug,
  categories,
  lines,
  onChange,
  issues,
  maxBooks,
  disabled,
  invalid,
}: {
  mode: "staff" | "public"
  libraryId?: string | null
  slug?: string
  categories?: { id: string; name: string }[]
  lines: ItemLine[]
  onChange: (lines: ItemLine[]) => void
  /** Per-book problems to highlight (keyed by bookId). */
  issues?: Record<string, string>
  maxBooks: number
  disabled?: boolean
  invalid?: boolean
}) {
  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const q = useDebouncedValue(search, 250)
  const selected = new Set(lines.map((l) => l.bookId))
  const full = lines.length >= maxBooks

  const addResult = (r: PickerResult) => {
    if (selected.has(r.id) || full) return
    const maxQuantity = mode === "staff" ? Math.min(100, r.availableCopies ?? 100) : 5
    onChange([
      ...lines,
      {
        bookId: r.id,
        title: r.title,
        author: r.author,
        callNumber: r.callNumber,
        quantity: 1,
        maxQuantity: Math.max(1, maxQuantity),
        note:
          mode === "public" && !r.available
            ? "Currently out"
            : mode === "staff"
              ? `${r.availableCopies} of ${r.totalCopies} available`
              : null,
      },
    ])
  }

  const setQuantity = (bookId: string, quantity: number) => {
    onChange(
      lines.map((l) =>
        l.bookId === bookId
          ? { ...l, quantity: Math.min(l.maxQuantity, Math.max(1, Number.isFinite(quantity) ? Math.trunc(quantity) : 1)) }
          : l,
      ),
    )
  }

  const remove = (bookId: string) => onChange(lines.filter((l) => l.bookId !== bookId))

  const renderResults = ({
    results,
    total,
    loading,
    error,
  }: {
    results: PickerResult[]
    total: number
    loading: boolean
    error: unknown
  }) => {
    if (loading)
      return (
        <div className="flex flex-col gap-2 p-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )
    if (error) return <p className="p-3 text-sm text-destructive">{errorMessage(error)}</p>
    if (results.length === 0)
      return <p className="p-3 text-sm text-muted-foreground">No books found.</p>
    return (
      <>
        <ul className="divide-y">
          {results.map((r) => {
            const added = selected.has(r.id)
            const staffNone = mode === "staff" && (r.availableCopies ?? 0) <= 0
            const sub = [r.author, r.callNumber, r.category].filter(Boolean).join(" · ")
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
                </div>
                {mode === "staff" ? (
                  <Badge
                    variant="outline"
                    className={cn(staffNone && "border-destructive/40 text-destructive")}
                  >
                    {staffNone ? "None available" : `${r.availableCopies}/${r.totalCopies} available`}
                  </Badge>
                ) : (
                  <Badge
                    className={
                      r.available
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
                    }
                  >
                    {r.available ? "Available" : "Out now, you can still ask"}
                  </Badge>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={added ? "ghost" : "outline"}
                  disabled={disabled || added || staffNone || full}
                  onClick={() => addResult(r)}
                  aria-label={added ? `${r.title} added` : `Add ${r.title}`}
                >
                  {added ? <CheckIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                  {added ? "Added" : "Add"}
                </Button>
              </li>
            )
          })}
        </ul>
        {total > results.length && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Showing {results.length} of {total} books. Type more to find others.
          </p>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selected lines */}
      <div className={cn("rounded-lg border", invalid && "border-destructive")}>
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-6 text-center text-sm text-muted-foreground">
            <BookIcon className="size-5" />
            No books added yet.
          </div>
        ) : (
          <ul className="divide-y">
            {lines.map((line) => {
              const issue = issues?.[line.bookId]
              return (
                <li
                  key={line.bookId}
                  className={cn("flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center", issue && "bg-destructive/5")}
                  data-invalid={!!issue || undefined}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{line.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {[line.author, line.callNumber].filter(Boolean).join(" · ")}
                      {line.note && (
                        <span className="block text-amber-700 dark:text-amber-300">{line.note}</span>
                      )}
                    </p>
                    {issue && (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {issue}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={disabled || line.quantity <= 1}
                      onClick={() => setQuantity(line.bookId, line.quantity - 1)}
                      aria-label="Decrease quantity"
                    >
                      <MinusIcon />
                    </Button>
                    <QuantityInput
                      line={line}
                      disabled={disabled}
                      invalid={!!issue}
                      onCommit={(quantity) => setQuantity(line.bookId, quantity)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={disabled || line.quantity >= line.maxQuantity}
                      onClick={() => setQuantity(line.bookId, line.quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      <PlusIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      onClick={() => remove(line.bookId)}
                      aria-label={`Remove ${line.title}`}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex justify-between border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {plural(lines.length, "book")} · {plural(lines.reduce((s, l) => s + l.quantity, 0), "copy", "copies")}
          </span>
        </div>
      </div>

      {/* Picker */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder={mode === "staff" ? "Title, author or ISBN" : "Title or author"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={disabled || (mode === "staff" && !libraryId)}
              aria-label="Search books"
            />
          </InputGroup>
          {mode === "public" && categories && categories.length > 0 && (
            <Select
              items={[{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              value={categoryId ?? "all"}
              onValueChange={(v) => setCategoryId(!v || v === "all" ? null : v)}
            >
              <SelectTrigger className="w-full sm:w-48" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {full && <p className="text-xs text-muted-foreground">Maximum {maxBooks} books reached.</p>}
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {mode === "staff" ? (
            libraryId ? (
              <StaffResults libraryId={libraryId} q={q} render={renderResults} />
            ) : (
              <p className="p-3 text-sm text-muted-foreground">Choose a library first.</p>
            )
          ) : slug ? (
            <PublicResults slug={slug} q={q} categoryId={categoryId} render={renderResults} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
