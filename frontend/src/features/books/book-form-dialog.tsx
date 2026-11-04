import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, useWatch } from "react-hook-form"
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ImageIcon,
  InfoIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { z } from "zod"

import { LibrarySelect } from "@/components/library-select"
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/features/auth/use-auth"
import { useCreateBook, useRemoveBookCover, useSetBookCover, useUpdateBook } from "@/features/books/api"
import {
  BIG_BUTTON,
  BIG_INPUT,
  BIG_ITEM,
  BIG_LABEL,
  BIG_SELECT,
  copiesCount,
  ERROR_TEXT,
  FOCUS,
  HINT,
} from "@/features/books/big-controls"
import { BookCover } from "@/features/books/book-cover"
import { CopiesStepper } from "@/features/books/copies-stepper"
import { coverDataUrl, NotAPictureError } from "@/features/books/cover-image"
import { MAX_COPIES } from "@/features/books/paste-books"
import { useCategories } from "@/features/categories/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import type { Book, BookInput, BookPatchInput, Library } from "@/types/api"

const NONE = "none"
const NEW = "__new"

const tooLong = (what: string, max: number) => `${what} is too long. Use ${max} letters or fewer.`

const intText = (min: number, max: number, message: string, optional: boolean) =>
  z
    .string()
    .trim()
    .refine((s) => (optional && s === "") || (/^\d+$/.test(s) && Number(s) >= min && Number(s) <= max), { message })

function makeSchema(minCopies: number, maxCopies: number) {
  return z
    .object({
      libraryId: z.string().min(1, "Please choose a library."),
      title: z.string().trim().min(1, "Please type the book title.").max(300, tooLong("Title", 300)),
      author: z.string().trim().max(200, tooLong("Author", 200)),
      isbn: z.string().trim().max(40, tooLong("ISBN", 40)),
      publisher: z.string().trim().max(200, tooLong("Publisher", 200)),
      publicationYear: intText(1000, 9999, "Please type the year with 4 numbers, like 1998.", true),
      callNumber: z.string().trim().max(100, tooLong("Shelf number", 100)),
      totalCopies: intText(minCopies, maxCopies, `Copies must be a number from ${minCopies} to ${maxCopies}.`, false),
      categoryChoice: z.string(),
      newCategoryName: z.string().trim(),
      notes: z.string().trim().max(1000, tooLong("Notes", 1000)),
    })
    .superRefine((v, ctx) => {
      if (v.categoryChoice === NEW) {
        if (v.newCategoryName.length < 1)
          ctx.addIssue({ code: "custom", path: ["newCategoryName"], message: "Please type the category name." })
        else if (v.newCategoryName.length > 80)
          ctx.addIssue({ code: "custom", path: ["newCategoryName"], message: tooLong("Category name", 80) })
      }
    })
}
type Values = z.input<ReturnType<typeof makeSchema>>

const KNOWN = ["libraryId", "title", "author", "isbn", "publisher", "publicationYear", "callNumber", "totalCopies", "categoryChoice", "newCategoryName", "notes"] as const
const FIELD_MAP = { categoryId: "categoryChoice", categoryName: "newCategoryName" }
/** The fields behind "More details" (Edit only; a new book gets them later, like on "Add many books"). */
const DETAIL_FIELDS = ["callNumber", "isbn", "publisher", "publicationYear", "notes"] as const
/** The boxes from top to bottom, to focus the first one with a problem. */
const FOCUS_ORDER: (keyof Values)[] = ["libraryId", "categoryChoice", "newCategoryName", "title", "author", "totalCopies", ...DETAIL_FIELDS]

function defaults(book: Book | undefined, libraryId: string | null): Values {
  return {
    libraryId: book?.libraryId ?? libraryId ?? "",
    title: book?.title ?? "",
    author: book?.author ?? "",
    isbn: book?.isbn ?? "",
    publisher: book?.publisher ?? "",
    publicationYear: book?.publicationYear?.toString() ?? "",
    callNumber: book?.callNumber ?? "",
    totalCopies: book ? String(book.totalCopies) : "1",
    categoryChoice: book?.categoryId ?? NONE,
    newCategoryName: "",
    notes: book?.notes ?? "",
  }
}

/** The picture is saved by its own request after the book, so it lives outside the form. */
type Picture = { kind: "keep" } | { kind: "new"; dataUrl: string } | { kind: "remove" }

const PLAIN_FIELDS =["title", "author", "isbn", "publisher", "publicationYear", "callNumber", "totalCopies", "notes"] as const

/**
 * PATCH is partial, so on edit send only what the user changed. Re-sending an untouched value from
 * the (possibly stale) cached book would overwrite newer data — e.g. a stale totalCopies would bring
 * back a copy another device just recorded as lost.
 */
function changedFields(body: BookInput, book: Book): BookPatchInput {
  const patch: Record<string, unknown> = {}
  for (const key of PLAIN_FIELDS) if (body[key] !== book[key]) patch[key] = body[key]
  if (body.categoryName !== undefined) patch.categoryName = body.categoryName
  else if (body.categoryId !== book.categoryId) patch.categoryId = body.categoryId
  return patch as BookPatchInput
}

/**
 * Add / edit a single book, with the same large, plain controls as "Add many books": library, category, title,
 * author, copies and an optional picture. Editing also offers the other details (shelf number, ISBN, …) under
 * "More details".
 * Mount it only while open so the form starts fresh.
 */
export function BookFormDialog({
  open,
  onOpenChange,
  book,
  libraries,
  defaultLibraryId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  book?: Book
  libraries: Library[]
  defaultLibraryId: string | null
}) {
  const isEdit = !!book
  // The picture is saved with PUT/DELETE /books/:id/cover, which needs books.update even right after adding a book.
  // Without it, "Add a book" leaves the picture out (and doesn't promise that details can be added later with Edit).
  const { can } = useAuth()
  const canEditBooks = can("books.update")
  // "+ New category…" creates a grouping (categories.create); without it only existing ones can be picked.
  const canAddCategory = can("categories.create")
  // A new book has 1 to 999 copies, as on "Add many books". On edit 0 is allowed (all copies lost), and a book
  // that already has more than 999 keeps its number.
  const minCopies = isEdit ? 0 : 1
  const maxCopies = Math.max(MAX_COPIES, book?.totalCopies ?? 0)
  const create = useCreateBook()
  const update = useUpdateBook()
  const setCover = useSetBookCover()
  const removeCover = useRemoveBookCover()
  // Like "Add many books": the switcher's library, or the only library there is.
  const startLibraryId = defaultLibraryId ?? (libraries.length === 1 ? (libraries[0]?.id ?? null) : null)
  const form = useForm<Values>({
    resolver: zodResolver(makeSchema(minCopies, maxCopies)),
    defaultValues: defaults(book, startLibraryId),
    // Focus is moved by showProblems, which can first open "More details".
    shouldFocusError: false,
  })
  const { errors, isDirty } = form.formState
  const libraryId = useWatch({ control: form.control, name: "libraryId" })
  const categoryChoice = useWatch({ control: form.control, name: "categoryChoice" })
  const categories = useCategories(libraryId || null)
  const pending = create.isPending || update.isPending || setCover.isPending || removeCover.isPending

  const [picture, setPicture] = useState<Picture>({ kind: "keep" })
  const [preparingPicture, setPreparingPicture] = useState(false)
  const [pictureError, setPictureError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chooseButtonRef = useRef<HTMLButtonElement>(null)
  // Counts the files chosen, so a slow picture that is still being shrunk can't replace one chosen after it.
  const pictureRequestRef = useRef(0)
  const pictureChanged = picture.kind !== "keep" || preparingPicture
  const previewSrc = picture.kind === "new" ? picture.dataUrl : picture.kind === "remove" ? null : (book?.coverUrl ?? null)

  const hasDetails = !!book && DETAIL_FIELDS.some((key) => !!defaults(book, null)[key])
  const [showDetails, setShowDetails] = useState(hasDetails)
  const detailsOpen = isEdit && showDetails
  const [capped, setCapped] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  // The box to focus after a failed save. It waits for the next render, so a box inside "More details" that was
  // just opened is there, and for the save to end (the boxes are disabled while saving).
  const [focusRequest, setFocusRequest] = useState(0)
  const focusNameRef = useRef<keyof Values | null>(null)

  useEffect(() => {
    const name = focusNameRef.current
    if (pending || !name) return
    focusNameRef.current = null
    form.setFocus(name)
  }, [pending, focusRequest, form])

  /** Opens "More details" when a problem is in there (it stays open once fixed), then focuses the first problem. */
  const showProblems = (names: readonly string[]) => {
    const first = FOCUS_ORDER.find((name) => names.includes(name))
    if (!first) return
    if (names.some((name) => (DETAIL_FIELDS as readonly string[]).includes(name))) setShowDetails(true)
    focusNameRef.current = first
    setFocusRequest((n) => n + 1)
  }

  /** Close, but ask first when something was typed or a picture changed (Esc, a click outside, ✕ or Cancel). */
  const requestClose = () => {
    if (pending) return
    if (isDirty || pictureChanged) setConfirmClose(true)
    else onOpenChange(false)
  }

  const onPictureChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared so choosing the same file again still counts as a choice.
    e.target.value = ""
    if (!file) return
    const request = ++pictureRequestRef.current
    setPictureError(null)
    setPreparingPicture(true)
    try {
      const dataUrl = await coverDataUrl(file)
      if (request === pictureRequestRef.current) setPicture({ kind: "new", dataUrl })
    } catch (error) {
      if (request === pictureRequestRef.current)
        setPictureError(error instanceof NotAPictureError ? error.message : errorMessage(error))
    } finally {
      if (request === pictureRequestRef.current) setPreparingPicture(false)
    }
  }

  const removePicture = () => {
    // Also drops a picture that is still being got ready.
    pictureRequestRef.current++
    setPreparingPicture(false)
    setPictureError(null)
    // A picture chosen for a book that had none is simply dropped; a saved one is removed on Save.
    setPicture(book?.coverUrl ? { kind: "remove" } : { kind: "keep" })
    // The Remove button goes away, so focus moves to the one next to it instead of getting lost.
    chooseButtonRef.current?.focus()
  }

  /** Saves the picture after the book. False when that failed (the book itself is saved by then). */
  const savePicture = async (bookId: string) => {
    try {
      if (picture.kind === "new") await setCover.mutateAsync({ id: bookId, image: picture.dataUrl })
      else if (picture.kind === "remove") await removeCover.mutateAsync(bookId)
      return true
    } catch {
      return false
    }
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    // Save waits for a picture still being got ready (the Save button is disabled meanwhile, too).
    if (preparingPicture) return e.preventDefault()
    return saveForm(e)
  }

  const saveForm = (e: FormEvent<HTMLFormElement>) => form.handleSubmit(async (v) => {
    const text = (s: string) => (s.trim() === "" ? null : s.trim())
    const body: BookInput = {
      title: v.title.trim(),
      author: text(v.author),
      isbn: text(v.isbn),
      publisher: text(v.publisher),
      publicationYear: v.publicationYear.trim() ? Number(v.publicationYear) : null,
      callNumber: text(v.callNumber),
      totalCopies: Number(v.totalCopies),
      notes: text(v.notes),
      ...(v.categoryChoice === NEW
        ? { categoryName: v.newCategoryName.trim() }
        : { categoryId: v.categoryChoice === NONE ? null : v.categoryChoice }),
    }
    try {
      const saved = book
        ? await update.mutateAsync({ id: book.id, ...changedFields(body, book) })
        : await create.mutateAsync({ ...body, libraryId: v.libraryId })
      if (await savePicture(saved.id)) toast.success(`“${saved.title}” ${book ? "saved" : "added"}.`)
      else toast.error("The book was saved, but the picture was not. Open Edit to try again.")
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError && error.code === "COPIES_IN_USE") {
        form.setError("totalCopies", {
          message: book?.onLoan
            ? `Copies can't be less than ${book.onLoan}, because ${book.onLoan} ${book.onLoan === 1 ? "is" : "are"} borrowed now.`
            : "Too low: some copies are borrowed now.",
        })
      } else if (error instanceof ApiError && error.code === "INVALID_CATEGORY") {
        form.setError("categoryChoice", { message: "Please choose the category again." })
        void categories.refetch()
      } else if (!applyServerErrors(error, form.setError, KNOWN, FIELD_MAP)) {
        toast.error(errorMessage(error))
        return
      }
      // getFieldState reads the live errors (formState is this render's snapshot and misses later setError calls).
      showProblems(FOCUS_ORDER.filter((name) => form.getFieldState(name).error))
    }
  }, (problems) => showProblems(Object.keys(problems)))(e)

  // The book's own category is listed even before the library's categories load (or if they fail to), so the box
  // shows its name and never a raw id.
  const categoryList = [
    ...(book?.category && !categories.data?.some((c) => c.id === book.category?.id) ? [book.category] : []),
    ...(categories.data ?? []),
  ]
  const categoryItems = [
    { value: NONE, label: "No category" },
    ...categoryList.map((c) => ({ value: c.id, label: c.name })),
    ...(canAddCategory ? [{ value: NEW, label: "+ New category…" }] : []),
  ]
  const categoriesLoading = !!libraryId && categories.isPending && !categories.isError

  const textBox = (name: (typeof DETAIL_FIELDS)[number] | "title" | "author" | "newCategoryName", id: string) => ({
    id,
    className: BIG_INPUT,
    autoComplete: "off",
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `${id}-error` : undefined,
    ...form.register(name),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}>
      <DialogContent className="max-h-[90svh] gap-6 overflow-y-auto p-6 text-[17px] leading-relaxed sm:max-w-xl [&>button]:top-3 [&>button]:right-3 [&>button]:size-12 [&>button_svg:not([class*='size-'])]:size-6">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">{isEdit ? "Edit book" : "Add a book"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <fieldset disabled={pending} className="flex flex-col gap-5">
            {!isEdit && (
              <BigField id="book-library" label="Which library?" error={errors.libraryId?.message}>
                <Controller
                  control={form.control}
                  name="libraryId"
                  render={({ field }) => (
                    <LibrarySelect
                      id="book-library"
                      libraries={libraries}
                      value={field.value || null}
                      onChange={(id) => {
                        field.onChange(id)
                        form.setValue("categoryChoice", NONE)
                      }}
                      triggerRef={field.ref}
                      invalid={!!errors.libraryId}
                      describedBy={errors.libraryId ? "book-library-error" : undefined}
                      className={BIG_SELECT}
                      itemClassName={BIG_ITEM}
                    />
                  )}
                />
              </BigField>
            )}

            <BigField id="book-category" label="Which category?" error={errors.categoryChoice?.message}>
              <Controller
                control={form.control}
                name="categoryChoice"
                render={({ field }) => (
                  <Select
                    items={categoryItems}
                    value={field.value}
                    onValueChange={(v) => field.onChange(typeof v === "string" && v ? v : NONE)}
                    disabled={!libraryId || categoriesLoading}
                  >
                    <SelectTrigger
                      id="book-category"
                      ref={field.ref}
                      className={BIG_SELECT}
                      aria-invalid={!!errors.categoryChoice}
                      aria-describedby={
                        [errors.categoryChoice && "book-category-error", libraryId && categories.isError && "book-category-hint"]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE} className={BIG_ITEM}>
                        No category
                      </SelectItem>
                      {categoryList.map((c) => (
                        <SelectItem key={c.id} value={c.id} className={BIG_ITEM}>
                          {c.name}
                        </SelectItem>
                      ))}
                      {canAddCategory && (
                        <>
                          <SelectSeparator />
                          <SelectItem value={NEW} className={BIG_ITEM}>
                            + New category…
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
              {libraryId && categories.isError && (
                <div id="book-category-hint" className="flex flex-wrap items-center gap-3">
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
            </BigField>
            {categoryChoice === NEW && (
              <BigField id="book-newcat" label="New category name" error={errors.newCategoryName?.message}>
                <Input {...textBox("newCategoryName", "book-newcat")} />
              </BigField>
            )}

            <BigField id="book-title" label="Title" error={errors.title?.message}>
              <Input {...textBox("title", "book-title")} />
            </BigField>
            <BigField id="book-author" label="Author" optional error={errors.author?.message}>
              <Input {...textBox("author", "book-author")} />
            </BigField>

            <div className="flex flex-col gap-1.5">
              <Controller
                control={form.control}
                name="totalCopies"
                render={({ field }) => {
                  const describedBy =
                    [errors.totalCopies && "book-copies-error", capped && "book-copies-note", isEdit && book.onLoan > 0 && "book-copies-hint"]
                      .filter(Boolean)
                      .join(" ") || undefined
                  return (
                    <CopiesStepper
                      id="book-copies"
                      inputRef={field.ref}
                      value={field.value}
                      count={copiesCount(field.value, { min: minCopies, max: maxCopies, fallback: book?.totalCopies ?? 1 })}
                      min={minCopies}
                      max={maxCopies}
                      invalid={!!errors.totalCopies}
                      describedBy={describedBy}
                      disabled={pending}
                      onChange={(value) => {
                        field.onChange(value)
                        setCapped(false)
                      }}
                      onCapped={() => setCapped(true)}
                    />
                  )
                }}
              />
              {isEdit && book.onLoan > 0 && (
                <p id="book-copies-hint" className={HINT}>
                  {book.onLoan} borrowed now.
                </p>
              )}
              {capped && (
                <p id="book-copies-note" className="flex items-center gap-2 text-base">
                  <InfoIcon className="size-5 shrink-0" aria-hidden />
                  Set to {maxCopies}, the most allowed.
                </p>
              )}
              <Problem id="book-copies-error" message={errors.totalCopies?.message} />
            </div>

            {canEditBooks && (
              <div role="group" aria-labelledby="book-picture-label" className="flex flex-col gap-1.5">
                <p id="book-picture-label" className={cn("flex items-center gap-2 leading-none", BIG_LABEL)}>
                  Picture <span className="font-normal text-foreground/80">(optional)</span>
                </p>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <BookCover src={previewSrc} size="lg" />
                  <div className="flex flex-col gap-3">
                    {/* Hidden: the big button below opens it. accept="image/*" lets phones offer the camera too. */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => void onPictureChosen(e)}
                    />
                    <Button
                      ref={chooseButtonRef}
                      type="button"
                      variant="outline"
                      className={cn(BIG_BUTTON, "w-full sm:w-fit")}
                      aria-describedby={pictureError ? "book-picture-error" : undefined}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon data-icon="inline-start" />
                      {previewSrc ? "Change picture" : "Choose a picture"}
                    </Button>
                    {previewSrc && (
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(BIG_BUTTON, "w-full sm:w-fit")}
                        onClick={removePicture}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Remove picture
                      </Button>
                    )}
                    {/* Both lines appear a moment after the choice, so they are read out when they do. */}
                    <div aria-live="polite">
                      {preparingPicture && (
                        <p className={cn("flex items-center gap-2", HINT)}>
                          <Spinner className="size-5" aria-hidden role={undefined} />
                          Getting the picture ready…
                        </p>
                      )}
                      <Problem id="book-picture-error" message={pictureError ?? undefined} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isEdit ? (
              <div className="flex flex-col gap-5 border-t pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className={cn(BIG_BUTTON, "w-full justify-between sm:w-fit")}
                  aria-expanded={detailsOpen}
                  aria-controls={detailsOpen ? "book-details" : undefined}
                  onClick={() => setShowDetails(!detailsOpen)}
                >
                  More details <span className="font-normal text-foreground/80">(optional)</span>
                  {detailsOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </Button>
                {detailsOpen && (
                  <div id="book-details" className="flex flex-col gap-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <BigField id="book-call" label="Shelf number" optional error={errors.callNumber?.message}>
                        <Input {...textBox("callNumber", "book-call")} />
                      </BigField>
                      <BigField id="book-isbn" label="ISBN" optional error={errors.isbn?.message}>
                        <Input {...textBox("isbn", "book-isbn")} />
                      </BigField>
                      <BigField id="book-publisher" label="Publisher" optional error={errors.publisher?.message}>
                        <Input {...textBox("publisher", "book-publisher")} />
                      </BigField>
                      <BigField id="book-year" label="Year published" optional error={errors.publicationYear?.message}>
                        <Input inputMode="numeric" {...textBox("publicationYear", "book-year")} />
                      </BigField>
                    </div>
                    <BigField id="book-notes" label="Notes" optional error={errors.notes?.message}>
                      <Textarea
                        rows={3}
                        maxLength={1000}
                        {...textBox("notes", "book-notes")}
                        className={cn("min-h-24 px-3 py-2.5 text-lg md:text-lg", FOCUS)}
                      />
                    </BigField>
                  </div>
                )}
              </div>
            ) : (
              canEditBooks && (
                <p className={cn("flex items-start gap-2", HINT)}>
                  <InfoIcon className="mt-1 size-5 shrink-0" aria-hidden />
                  The shelf number, ISBN and other details can be added later with Edit.
                </p>
              )
            )}

            <DialogFooter className="-mx-6 -mb-6 p-6">
              <Button type="button" variant="outline" className={BIG_BUTTON} onClick={requestClose}>
                Cancel
              </Button>
              <Button type="submit" className={cn(BIG_BUTTON, "text-xl")} disabled={preparingPicture}>
                {pending && <Spinner data-icon="inline-start" />}
                {pending ? "Saving…" : isEdit ? "Save changes" : "Add book"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>

        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent className="gap-5 p-6 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-semibold">Close without saving?</AlertDialogTitle>
              <AlertDialogDescription className="text-lg text-foreground/80">
                {isDirty ? "What you typed will be lost." : "The picture change will be lost."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="-mx-6 -mb-6 p-6">
              <AlertDialogCancel className={BIG_BUTTON}>{isDirty ? "Keep typing" : "Go back"}</AlertDialogCancel>
              <Button variant="destructive" className={BIG_BUTTON} onClick={() => onOpenChange(false)}>
                Close without saving
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

/** A big label, its box, and the problem with it (if any) in red underneath. */
function BigField({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  error: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className={BIG_LABEL}>
        {label}
        {optional && <span className="font-normal text-foreground/80">(optional)</span>}
      </Label>
      {children}
      <Problem id={`${id}-error`} message={error} />
    </div>
  )
}

function Problem({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} className={cn("flex items-center gap-2", ERROR_TEXT)}>
      <AlertCircleIcon className="size-5 shrink-0" aria-hidden />
      {message}
    </p>
  )
}
