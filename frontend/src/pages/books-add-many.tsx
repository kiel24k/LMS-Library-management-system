import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react"
import { flushSync } from "react-dom"
import { Link, useBlocker } from "react-router"
import {
  AlertCircleIcon,
  BuildingIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  InfoIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { EmptyState } from "@/components/states"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/features/auth/use-auth"
import { useBulkCreateBooks } from "@/features/books/api"
import {
  BIG_BUTTON,
  BIG_INPUT,
  BIG_ITEM,
  BIG_LABEL,
  BIG_SELECT,
  copiesCount,
  ERROR_TEXT,
  HINT,
} from "@/features/books/big-controls"
import { CopiesStepper } from "@/features/books/copies-stepper"
import {
  isMultiCellPaste,
  MAX_COPIES,
  parsePastedBooks,
  parsePastedColumn,
  type PastedBook,
} from "@/features/books/paste-books"
import { useCategories } from "@/features/categories/api"
import { ApiError, errorMessage } from "@/lib/api"
import { useLibraryScope } from "@/lib/library-scope"
import type { BookInput } from "@/types/api"

/** Same limits as POST /books/bulk. */
const MAX_BOOKS = 500
const MAX_TITLE = 300
const MAX_AUTHOR = 200
const MAX_SECTION = 80
const START_ROWS = 5

const NO_SECTION = "none"
const NEW_SECTION = "__new"

type Row = { id: number; title: string; author: string; copies: string }
type Problem = { field: "title" | "author" | "copies"; message: string }
type Saved = { count: number; libraryId: string; library: string; section: string | null }
/** A removed row that can be brought back; shown in its old place, before the row `beforeId` (null = at the end). */
type Removed = { row: Row; number: number; beforeId: number | null }

let lastRowId = 0
const newRow = (values: Partial<Omit<Row, "id">> = {}): Row => ({ id: ++lastRowId, title: "", author: "", copies: "1", ...values })
const startRows = () => Array.from({ length: START_ROWS }, () => newRow())

/** Copies as a number: blank or 0 counts as 1, anything above the limit as the limit. */
const copiesOf = (row: Row): number => copiesCount(row.copies)

const isEmptyRow = (row: Row) => !row.title.trim() && !row.author.trim() && copiesOf(row) === 1

function rowProblem(row: Row): Problem | null {
  const title = row.title.trim()
  if (!title) return { field: "title", message: "Please type the book title." }
  if (title.length > MAX_TITLE)
    return { field: "title", message: `Title is too long. Use ${MAX_TITLE} letters or fewer.` }
  if (row.author.trim().length > MAX_AUTHOR)
    return { field: "author", message: `Author is too long. Use ${MAX_AUTHOR} letters or fewer.` }
  return null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const theBooks = (n: number) => (n === 1 ? "the book" : `the ${n} books`)

/** Server row error (`["books", i, field]`) in plain words, on the box it belongs to. */
function serverRowProblem(field: unknown): Problem {
  if (field === "author")
    return { field: "author", message: "Please check the author's name." }
  if (field === "totalCopies") return { field: "copies", message: `Copies must be a number from 1 to ${MAX_COPIES}.` }
  return { field: "title", message: "Please check the title." }
}

/** Puts pasted books into the list, starting at `rowId`; later books fill empty rows or get new ones. */
function fillRows(rows: Row[], rowId: number, books: PastedBook[]): Row[] {
  const next = [...rows]
  let at = next.findIndex((r) => r.id === rowId)
  books.forEach((book, k) => {
    if (k > 0) at++
    const current = k === 0 ? next[at] : next[at] && isEmptyRow(next[at]) ? next[at] : undefined
    const row = current ?? newRow()
    const filled: Row = {
      ...row,
      title: book.title || (k === 0 ? row.title : ""),
      author: book.author || (k === 0 ? row.author : ""),
      copies: book.copies !== null ? String(book.copies) : row.copies,
    }
    if (current) next[at] = filled
    else next.splice(at, 0, filled) // never overwrite a row the user already typed
  })
  return next
}

/** Puts a pasted column of authors into this row and the rows below it, in order (like a spreadsheet). */
function fillAuthors(rows: Row[], rowId: number, authors: string[]): Row[] {
  const next = [...rows]
  const start = next.findIndex((r) => r.id === rowId)
  authors.forEach((author, k) => {
    const row = next[start + k]
    if (row) next[start + k] = { ...row, author }
    else next.push(newRow({ author }))
  })
  return next
}

/** "Add many books": choose library + category once, then type (or paste) one book per row. */
export function BooksAddManyPage() {
  const scope = useLibraryScope()
  const { can } = useAuth()
  const bulk = useBulkCreateBooks()

  // The page keeps its own library: it takes the switcher's library once (when it is known) and then changes
  // only through "Which library?", so a change in the sidebar cannot move the books typed here.
  const switcherLibraryId = scope.libraryId ?? (scope.libraries.length === 1 ? (scope.libraries[0]?.id ?? null) : null)
  const [pickedLibraryId, setPickedLibraryId] = useState(switcherLibraryId)
  if (pickedLibraryId === null && switcherLibraryId !== null) setPickedLibraryId(switcherLibraryId)
  const library = scope.libraries.find((l) => l.id === pickedLibraryId) ?? null
  const libraryId = library?.id ?? null
  const categories = useCategories(libraryId)

  const [section, setSection] = useState(NO_SECTION)
  const [newSectionName, setNewSectionName] = useState("")
  const [rows, setRows] = useState(startRows)
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<number, Problem>>({})
  /** A save failure that is not about one book (no connection, category problem…); cleared by any change. */
  const [failure, setFailure] = useState<string | null>(null)
  const [removed, setRemoved] = useState<Removed | null>(null)
  const [cappedRowId, setCappedRowId] = useState<number | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)

  const titleRefs = useRef(new Map<number, HTMLInputElement>())
  const authorRefs = useRef(new Map<number, HTMLInputElement>())
  const copiesRefs = useRef(new Map<number, HTMLInputElement>())
  const newSectionRef = useRef<HTMLInputElement>(null)
  const savedHeadingRef = useRef<HTMLHeadingElement>(null)
  const bringBackRef = useRef<HTMLButtonElement>(null)
  // Set at once on Save (before React re-renders) so a quick double-click cannot send the books twice.
  const savingRef = useRef(false)
  // The box to focus after a failed save; the boxes are disabled while saving, so this waits for the save to end.
  const focusAfterSaveRef = useRef<HTMLElement | null>(null)

  const filled = rows.filter((r) => !isEmptyRow(r))
  const totalCopies = filled.reduce((sum, r) => sum + copiesOf(r), 0)
  const dirty = filled.length > 0

  const sectionProblem =
    section !== NEW_SECTION
      ? null
      : !newSectionName.trim()
        ? "Please type the category name."
        : newSectionName.trim().length > MAX_SECTION
          ? `Category name is too long. Use ${MAX_SECTION} letters or fewer.`
          : null

  // Why Save is off (an empty list says so in the line above it instead).
  const disabledReason = !libraryId
    ? "Choose a library first."
    : filled.length > MAX_BOOKS
      ? `Too many books. Save up to ${MAX_BOOKS} at a time.`
      : null
  const canSave = !disabledReason && filled.length > 0

  // The red line in the save bar is worked out from what is on the page now, so it goes away once fixed.
  const badRows = attempted ? filled.filter((r) => rowProblem(r)).length : 0
  const serverBadRows = Object.keys(serverErrors).length
  const saveError =
    badRows > 0
      ? `Nothing was saved. Please fix ${theBooks(badRows)} marked in red.`
      : attempted && sectionProblem
        ? "Nothing was saved. Please type the category name."
        : serverBadRows > 0
          ? `Nothing was saved. Please fix ${theBooks(serverBadRows)} marked in red.`
          : failure

  // Ask before leaving the page (links, Back, sidebar) while typed books are unsaved, and hold the page while saving.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (dirty || bulk.isPending) && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    // The save finished while "Please wait" was showing: stay so the result can be seen.
    if (blocker.state === "blocked" && !dirty && !bulk.isPending) blocker.reset()
  }, [blocker, dirty, bulk.isPending])
  useEffect(() => {
    if (!dirty && !bulk.isPending) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty, bulk.isPending])

  useEffect(() => {
    if (saved) savedHeadingRef.current?.focus()
  }, [saved])

  useEffect(() => {
    const el = focusAfterSaveRef.current
    if (bulk.isPending || !el) return
    focusAfterSaveRef.current = null
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: "nearest" })
  }, [bulk.isPending])

  /** Focus a box and scroll only as far as needed to show it (never a jump when it is already in view). */
  const focusInput = (el: HTMLElement | null | undefined) => {
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: "nearest" })
  }

  /** Any change by the user: old save messages about this row (or the whole save) no longer apply. */
  const changed = (rowId?: number) => {
    setFailure(null)
    if (rowId === undefined) return
    if (cappedRowId === rowId) setCappedRowId(null)
    if (serverErrors[rowId] === undefined) return
    setServerErrors((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  const updateRow = (rowId: number, values: Partial<Omit<Row, "id">>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...values } : r)))
    changed(rowId)
  }

  const addRow = () => {
    const row = newRow()
    flushSync(() => setRows((prev) => [...prev, row]))
    focusInput(titleRefs.current.get(row.id))
  }

  const removeRow = (rowId: number, e: MouseEvent<HTMLButtonElement>) => {
    const index = rows.findIndex((r) => r.id === rowId)
    const row = rows[index]
    if (!row) return
    const rest = rows.filter((r) => r.id !== rowId)
    const next = rest.length > 0 ? rest : [newRow()]
    const nextId = rest[index]?.id ?? null
    const keep = !isEmptyRow(row)
    flushSync(() => {
      setRows(next)
      if (keep) setRemoved({ row, number: index + 1, beforeId: nextId })
      else if (removed?.beforeId === rowId) setRemoved({ ...removed, beforeId: nextId })
    })
    changed(rowId)
    // A mouse click keeps the page still; a keyboard press scrolls if the next box is out of view.
    const target = keep ? bringBackRef.current : titleRefs.current.get(next[Math.min(index, next.length - 1)]!.id)
    if (e.detail > 0) target?.focus({ preventScroll: true })
    else focusInput(target)
  }

  const bringBack = () => {
    if (!removed) return
    const { row, beforeId } = removed
    flushSync(() => {
      setRows((prev) => {
        const at = beforeId === null ? -1 : prev.findIndex((r) => r.id === beforeId)
        return at < 0 ? [...prev, row] : [...prev.slice(0, at), row, ...prev.slice(at)]
      })
      setRemoved(null)
    })
    changed()
    focusInput(titleRefs.current.get(row.id))
  }

  const onEnter = (rowId: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    const next = rows[rows.findIndex((r) => r.id === rowId) + 1]
    if (next) focusInput(titleRefs.current.get(next.id))
    else addRow()
  }

  /** Several lines (or spreadsheet columns) pasted into a Title or Author box fill the rows from here down. */
  const onPaste = (rowId: number, box: "title" | "author", e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain")
    if (!isMultiCellPaste(text)) return // one plain line: normal paste
    e.preventDefault()
    // Columns from a spreadsheet are read as title, author, copies in either box; a plain list pasted into an
    // Author box is a list of authors.
    const authors = box === "author" && !text.includes("\t") ? parsePastedColumn(text) : null
    const books = authors ? [] : parsePastedBooks(text)
    const count = authors ? authors.length : books.length
    if (count === 0) {
      toast("Nothing to add was found.")
      return
    }
    setRows(authors ? fillAuthors(rows, rowId, authors) : fillRows(rows, rowId, books))
    setServerErrors({})
    setFailure(null)
    if (count > 1) toast.success(authors ? `${plural(count, "author", "authors")} pasted.` : `${plural(count, "book", "books")} pasted.`)
  }

  const chooseLibrary = (id: string) => {
    if (id === libraryId) return
    setPickedLibraryId(id)
    setSection(NO_SECTION)
    setNewSectionName("")
    setServerErrors({})
    setFailure(null)
  }

  const sectionLabel = () =>
    section === NEW_SECTION
      ? newSectionName.trim()
      : section === NO_SECTION
        ? null
        : (categories.data?.find((c) => c.id === section)?.name ?? null)

  const save = () => {
    if (savingRef.current) return
    setAttempted(true)
    setFailure(null)
    if (!libraryId || !canSave) return

    if (sectionProblem) {
      focusInput(newSectionRef.current)
      return
    }
    const firstBad = filled.find((r) => rowProblem(r))
    if (firstBad) {
      const problem = rowProblem(firstBad)
      focusInput((problem?.field === "author" ? authorRefs : titleRefs).current.get(firstBad.id))
      return
    }

    const sectionFields: Pick<BookInput, "categoryId" | "categoryName"> =
      section === NEW_SECTION ? { categoryName: newSectionName.trim() } : section === NO_SECTION ? {} : { categoryId: section }
    const books: BookInput[] = filled.map((r) => ({
      title: r.title.trim(),
      ...(r.author.trim() ? { author: r.author.trim() } : {}),
      totalCopies: copiesOf(r),
      ...sectionFields,
    }))

    savingRef.current = true
    setRemoved(null)
    bulk.mutate(
      { libraryId, books },
      {
        onSettled: () => {
          savingRef.current = false
        },
        onSuccess: (res) => {
          const result: Saved = {
            count: res.created,
            libraryId,
            library: library?.name ?? "the library",
            section: sectionLabel(),
          }
          setRows(startRows())
          setAttempted(false)
          setServerErrors({})
          setCappedRowId(null)
          setSaved(result)
        },
        onError: (error) => {
          const rowErrors: Record<number, Problem> = {}
          let sectionIssue = false
          if (error instanceof ApiError) {
            for (const issue of error.issues) {
              const [root, index, field] = issue.path
              if (root !== "books" || typeof index !== "number") continue
              if (field === "categoryName" || field === "categoryId") sectionIssue = true
              else {
                const row = filled[index]
                if (row && !rowErrors[row.id]) rowErrors[row.id] = serverRowProblem(field)
              }
            }
          }
          setServerErrors(rowErrors)
          const count = Object.keys(rowErrors).length
          if (count > 0) {
            toast.error(`Nothing was saved. Please fix ${theBooks(count)} marked in red.`)
            const first = filled.find((r) => rowErrors[r.id])
            const field = first && rowErrors[first.id]?.field
            if (first)
              focusAfterSaveRef.current =
                (field === "author" ? authorRefs : field === "copies" ? copiesRefs : titleRefs).current.get(first.id) ?? null
            return
          }
          const message =
            sectionIssue || (error instanceof ApiError && error.code === "INVALID_CATEGORY")
              ? "Nothing was saved. Please choose the category again."
              : `Nothing was saved. ${errorMessage(error)}`
          if (sectionIssue || (error instanceof ApiError && error.code === "INVALID_CATEGORY")) void categories.refetch()
          setFailure(message)
          toast.error(message)
        },
      },
    )
  }

  const addMore = () => {
    // A category created by the last save now exists: select it instead of "+ New category…".
    if (section === NEW_SECTION) {
      const name = newSectionName.trim().toLowerCase()
      const created = categories.data?.find((c) => c.name.toLowerCase() === name)
      if (created) {
        setSection(created.id)
        setNewSectionName("")
      }
    }
    flushSync(() => setSaved(null))
    focusInput(titleRefs.current.get(rows[0]!.id))
  }

  /** On the way to Books after a save, show the library the books went into (the switcher may show another). */
  const showSavedLibrary = () => {
    if (saved && scope.libraryId !== null && scope.libraryId !== saved.libraryId) scope.setLibraryId(saved.libraryId)
  }

  const sectionItems = [
    { value: NO_SECTION, label: "No category" },
    ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    // "+ New category…" creates a grouping: only with categories.create.
    ...(can("categories.create") ? [{ value: NEW_SECTION, label: "+ New category…" }] : []),
  ]
  const libraryItems = scope.libraries.map((l) => ({ value: l.id, label: l.name }))
  const sectionsLoading = !!libraryId && categories.isPending && !categories.isError

  // Where the "removed" bar goes: before the row that followed the removed one, or at the end.
  const removedBefore = removed && rows.some((r) => r.id === removed.beforeId) ? removed.beforeId : null
  const removedBar = removed && (
    <li
      key="removed"
      className="flex flex-col gap-3 rounded-xl border-2 border-dashed border-foreground/30 bg-muted/60 p-4 sm:flex-row sm:items-center sm:gap-5"
    >
      <p id="add-many-removed" className="flex items-center gap-2 text-lg">
        <Trash2Icon className="size-5 shrink-0" aria-hidden />
        {removed.row.title.trim() ? `“${removed.row.title.trim()}”` : `Book ${removed.number}`} removed.
      </p>
      <Button
        ref={bringBackRef}
        type="button"
        variant="outline"
        className={cn(BIG_BUTTON, "w-full sm:w-fit")}
        onClick={bringBack}
        disabled={bulk.isPending}
        aria-describedby="add-many-removed"
      >
        <Undo2Icon data-icon="inline-start" />
        Bring it back
      </Button>
    </li>
  )

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 text-[17px] leading-relaxed">
      <div className="flex flex-col gap-3">
        <Button
          variant="outline"
          className={cn(BIG_BUTTON, "h-11 w-fit text-base")}
          nativeButton={false}
          render={<Link to="/books" onClick={showSavedLibrary} />}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          Back to Books
        </Button>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Add many books</h1>
      </div>

      {scope.libraries.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon />}
          title="No libraries yet"
          description={can("libraries.create") ? undefined : "Ask someone who manages libraries to add one."}
          action={
            can("libraries.view") && (
              <Button className={BIG_BUTTON} nativeButton={false} render={<Link to="/libraries" />}>
                Go to libraries
              </Button>
            )
          }
        />
      ) : saved ? (
        <section
          role="status"
          className="flex flex-col items-start gap-5 rounded-2xl border-2 border-emerald-600/40 bg-emerald-50 p-6 sm:p-8 dark:bg-emerald-950/40"
        >
          <CheckCircle2Icon className="size-12 text-emerald-700 dark:text-emerald-400" aria-hidden />
          <h2 ref={savedHeadingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
            {plural(saved.count, "book", "books")} added to {saved.library}
            {saved.section ? ` (${saved.section})` : ""}.
          </h2>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button className={BIG_BUTTON} onClick={addMore}>
              <PlusIcon data-icon="inline-start" />
              Add more books
            </Button>
            <Button
              variant="outline"
              className={BIG_BUTTON}
              nativeButton={false}
              render={<Link to="/books" onClick={showSavedLibrary} />}
            >
              Go to Books
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby="step-1" className="flex flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-6">
            <StepHeading id="step-1" step={1}>
              Where do these books go?
            </StepHeading>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-many-library" className={BIG_LABEL}>
                  Which library?
                </Label>
                <Select
                  items={libraryItems}
                  value={libraryId}
                  onValueChange={(v) => {
                    if (typeof v === "string" && v) chooseLibrary(v)
                  }}
                  disabled={bulk.isPending}
                >
                  <SelectTrigger id="add-many-library" className={BIG_SELECT}>
                    <SelectValue placeholder="Choose a library" />
                  </SelectTrigger>
                  <SelectContent>
                    {libraryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value} className={BIG_ITEM}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-many-section" className={BIG_LABEL}>
                  Which category?
                </Label>
                <Select
                  items={sectionItems}
                  value={section}
                  onValueChange={(v) => {
                    setSection(typeof v === "string" && v ? v : NO_SECTION)
                    changed()
                  }}
                  disabled={!libraryId || sectionsLoading || bulk.isPending}
                >
                  <SelectTrigger
                    id="add-many-section"
                    className={BIG_SELECT}
                    aria-describedby={libraryId && categories.isError ? "add-many-section-hint" : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SECTION} className={BIG_ITEM}>
                      No category
                    </SelectItem>
                    {(categories.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id} className={BIG_ITEM}>
                        {c.name}
                      </SelectItem>
                    ))}
                    {can("categories.create") && (
                      <>
                        <SelectSeparator />
                        <SelectItem value={NEW_SECTION} className={BIG_ITEM}>
                          + New category…
                        </SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
                {libraryId && categories.isError && (
                  <div id="add-many-section-hint" className="flex flex-wrap items-center gap-3">
                    <p className={ERROR_TEXT}>Could not load the categories.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(BIG_BUTTON, "h-11 text-base")}
                      onClick={() => void categories.refetch()}
                    >
                      <RotateCwIcon data-icon="inline-start" />
                      Try again
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {section === NEW_SECTION && (
              <div className="flex flex-col gap-2 md:max-w-[calc(50%-0.625rem)] md:self-end md:w-full">
                <Label htmlFor="add-many-new-section" className={BIG_LABEL}>
                  New category name
                </Label>
                <Input
                  id="add-many-new-section"
                  ref={newSectionRef}
                  className={BIG_INPUT}
                  value={newSectionName}
                  onChange={(e) => {
                    setNewSectionName(e.target.value)
                    changed()
                  }}
                  aria-invalid={attempted && !!sectionProblem}
                  aria-describedby={attempted && sectionProblem ? "add-many-new-section-error" : undefined}
                  disabled={bulk.isPending}
                  autoComplete="off"
                />
                {attempted && sectionProblem && (
                  <p id="add-many-new-section-error" className={ERROR_TEXT}>
                    {sectionProblem}
                  </p>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="step-2" className="flex flex-col gap-4 rounded-2xl border bg-card p-3 sm:p-6">
            <StepHeading id="step-2" step={2}>
              Type the books
            </StepHeading>
            <ol className="flex flex-col gap-3">
              {rows.map((row, index) => {
                const problem = (attempted && !isEmptyRow(row) ? rowProblem(row) : null) ?? serverErrors[row.id] ?? null
                const errorId = `book-${row.id}-error`
                const noteId = `book-${row.id}-note`
                const capped = cappedRowId === row.id
                const describedBy = (field: Problem["field"]) =>
                  [problem?.field === field && errorId, field === "copies" && capped && noteId].filter(Boolean).join(" ") || undefined
                const n = index + 1
                const fieldId = (name: string) => `book-${row.id}-${name}`
                return (
                  <Fragment key={row.id}>
                    {removedBefore === row.id && removedBar}
                    <li
                      className={cn(
                        "flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:gap-4 sm:p-4",
                        problem && "border-red-700/60 bg-destructive/5 dark:border-red-400/60",
                      )}
                    >
                      <span
                        aria-hidden
                        className="flex h-9 w-fit shrink-0 items-center justify-center rounded-full bg-muted px-3 text-lg font-semibold tabular-nums sm:mt-9 sm:size-10 sm:px-0"
                      >
                        <span className="sm:hidden">Book&nbsp;</span>
                        {n}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto_auto] md:items-end">
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={fieldId("title")} className={BIG_LABEL}>
                              Title<span className="sr-only"> of book {n}</span>
                            </Label>
                            <Input
                              id={fieldId("title")}
                              ref={(el) => {
                                if (el) titleRefs.current.set(row.id, el)
                                else titleRefs.current.delete(row.id)
                              }}
                              className={BIG_INPUT}
                              value={row.title}
                              onChange={(e) => updateRow(row.id, { title: e.target.value })}
                              onKeyDown={(e) => onEnter(row.id, e)}
                              onPaste={(e) => onPaste(row.id, "title", e)}
                              aria-invalid={problem?.field === "title"}
                              aria-describedby={describedBy("title")}
                              disabled={bulk.isPending}
                              autoComplete="off"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={fieldId("author")} className={BIG_LABEL}>
                              Author <span className="font-normal text-foreground/80">(optional)</span>
                              <span className="sr-only"> of book {n}</span>
                            </Label>
                            <Input
                              id={fieldId("author")}
                              ref={(el) => {
                                if (el) authorRefs.current.set(row.id, el)
                                else authorRefs.current.delete(row.id)
                              }}
                              className={BIG_INPUT}
                              value={row.author}
                              onChange={(e) => updateRow(row.id, { author: e.target.value })}
                              onKeyDown={(e) => onEnter(row.id, e)}
                              onPaste={(e) => onPaste(row.id, "author", e)}
                              aria-invalid={problem?.field === "author"}
                              aria-describedby={describedBy("author")}
                              disabled={bulk.isPending}
                              autoComplete="off"
                            />
                          </div>
                          <div className="flex flex-wrap items-end justify-between gap-3 md:contents">
                            <CopiesStepper
                              id={fieldId("copies")}
                              inputRef={(el) => {
                                if (el) copiesRefs.current.set(row.id, el)
                                else copiesRefs.current.delete(row.id)
                              }}
                              bookNumber={n}
                              value={row.copies}
                              count={copiesOf(row)}
                              invalid={problem?.field === "copies"}
                              describedBy={describedBy("copies")}
                              disabled={bulk.isPending}
                              onChange={(copies) => updateRow(row.id, { copies })}
                              onCapped={() => setCappedRowId(row.id)}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                BIG_BUTTON,
                                "border-red-700/40 px-3 text-base text-red-700 hover:bg-red-50 hover:text-red-800 has-data-[icon=inline-start]:pl-3 sm:px-5 sm:has-data-[icon=inline-start]:pl-4 md:ml-6 dark:border-red-400/40 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300",
                              )}
                              onClick={(e) => removeRow(row.id, e)}
                              disabled={bulk.isPending}
                            >
                              <Trash2Icon data-icon="inline-start" />
                              Remove<span className="sr-only"> book {n}</span>
                            </Button>
                          </div>
                        </div>
                        {problem && (
                          <p id={errorId} className={cn("flex items-center gap-2", ERROR_TEXT)}>
                            <AlertCircleIcon className="size-5 shrink-0" aria-hidden />
                            {problem.message}
                          </p>
                        )}
                        {capped && (
                          <p id={noteId} className="flex items-center gap-2 text-base">
                            <InfoIcon className="size-5 shrink-0" aria-hidden />
                            Set to {MAX_COPIES}, the most allowed.
                          </p>
                        )}
                      </div>
                    </li>
                  </Fragment>
                )
              })}
              {removed && removedBefore === null && removedBar}
            </ol>

            <Button
              type="button"
              variant="outline"
              className={cn(BIG_BUTTON, "w-full border-2 border-dashed sm:w-fit")}
              onClick={addRow}
              disabled={bulk.isPending}
            >
              <PlusIcon data-icon="inline-start" />
              Add another book
            </Button>
          </section>

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t bg-background/95 px-4 py-4 backdrop-blur supports-backdrop-filter:bg-background/85 sm:bottom-4 sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:border sm:px-6 sm:shadow-lg">
            <div className="flex flex-col gap-1">
              <p className="text-lg font-medium" aria-live="polite">
                {filled.length === 0
                  ? "No books typed yet."
                  : `${plural(filled.length, "book", "books")}, ${plural(totalCopies, "copy", "copies")}`}
              </p>
              {saveError && (
                <p role="alert" className={ERROR_TEXT}>
                  {saveError}
                </p>
              )}
              {disabledReason && (
                <p id="add-many-save-reason" className={HINT}>
                  {disabledReason}
                </p>
              )}
            </div>
            <Button
              className={cn(BIG_BUTTON, "w-full text-xl sm:w-auto")}
              onClick={save}
              disabled={!canSave || bulk.isPending}
              aria-describedby={disabledReason ? "add-many-save-reason" : undefined}
            >
              {bulk.isPending && <Spinner data-icon="inline-start" />}
              {bulk.isPending
                ? "Saving…"
                : filled.length > 0
                  ? `Save ${plural(filled.length, "book", "books")}`
                  : "Save books"}
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={blocker.state === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent className="gap-5 p-6 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
          {bulk.isPending ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-xl font-semibold">Please wait</AlertDialogTitle>
                <AlertDialogDescription className="text-lg text-foreground/80">
                  Your books are still being saved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="-mx-6 -mb-6 p-6">
                <AlertDialogCancel className={BIG_BUTTON}>OK</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-xl font-semibold">Leave without saving?</AlertDialogTitle>
                <AlertDialogDescription className="text-lg text-foreground/80">
                  The books you typed will be lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="-mx-6 -mb-6 p-6">
                <AlertDialogCancel className={BIG_BUTTON}>Stay on this page</AlertDialogCancel>
                <Button variant="destructive" className={BIG_BUTTON} onClick={() => blocker.proceed?.()}>
                  Leave without saving
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StepHeading({ id, step, children }: { id: string; step: number; children: string }) {
  return (
    <h2 id={id} className="flex items-center gap-3 text-xl font-semibold">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-lg text-primary-foreground"
      >
        {step}
      </span>
      <span>
        <span className="sr-only">Step {step}: </span>
        {children}
      </span>
    </h2>
  )
}
