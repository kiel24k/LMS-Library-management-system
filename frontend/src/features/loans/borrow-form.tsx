import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { LibrarySelect } from "@/components/library-select"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { BorrowerPicker } from "@/features/borrowers/borrower-picker"
import { useCreateLoan } from "@/features/loans/api"
import { lineIssuesFromError } from "@/features/loans/loan-errors"
import { LoanItemsEditor, type ItemLine } from "@/features/loans/loan-items-editor"
import { useSubmitPublicRequest } from "@/features/public/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import { todayInManila } from "@/lib/format"
import type { Borrower, InsufficientCopiesDetails, Library, LoanDetail, PublicRequestResult } from "@/types/api"

const LIMITS = {
  staff: { maxBooks: 50, maxQuantity: 100 },
  public: { maxBooks: 20, maxQuantity: 5 },
} as const

const lineSchema = z.object({
  bookId: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  callNumber: z.string().nullable(),
  quantity: z.number(),
  maxQuantity: z.number(),
  note: z.string().nullable().optional(),
})

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be at most ${max} characters`)

function makeSchema(mode: "staff" | "public") {
  const { maxBooks, maxQuantity } = LIMITS[mode]
  return z
    .object({
      libraryId: z.string(),
      borrowerMode: z.enum(["existing", "new"]),
      existingBorrower: z.custom<Borrower>().nullable(),
      borrower: z.object({
        name: z.string().trim(),
        idNumber: optionalText(50, "ID number"),
        contact: optionalText(120, "Contact"),
        affiliation: optionalText(120, "Affiliation"),
      }),
      items: z.array(lineSchema),
      dueDate: z.string(),
      notes: optionalText(500, "Notes"),
      website: z.string(),
    })
    .superRefine((v, ctx) => {
      if (mode === "staff" && !v.libraryId) {
        ctx.addIssue({ code: "custom", path: ["libraryId"], message: "Choose a library" })
      }
      const needsNew = mode === "public" || v.borrowerMode === "new"
      if (needsNew) {
        const len = v.borrower.name.trim().length
        if (len < 2) ctx.addIssue({ code: "custom", path: ["borrower", "name"], message: "Enter the full name" })
        if (len > 120) ctx.addIssue({ code: "custom", path: ["borrower", "name"], message: "Name must be at most 120 characters" })
      } else if (!v.existingBorrower) {
        ctx.addIssue({ code: "custom", path: ["existingBorrower"], message: "Choose a borrower" })
      }
      if (v.items.length === 0) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Add at least one book" })
      } else if (v.items.length > maxBooks) {
        ctx.addIssue({ code: "custom", path: ["items"], message: `Up to ${maxBooks} books only` })
      }
      if (v.items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > Math.min(maxQuantity, i.maxQuantity))) {
        ctx.addIssue({ code: "custom", path: ["items"], message: `Copies must be 1 to ${maxQuantity}, not more than available` })
      }
      if (mode === "staff" && v.dueDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate)) {
          ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Enter a valid date" })
        } else if (v.dueDate < todayInManila()) {
          ctx.addIssue({ code: "custom", path: ["dueDate"], message: "The due date can't be in the past" })
        }
      }
    })
}

type Values = z.input<ReturnType<typeof makeSchema>>

const KNOWN_FIELDS = [
  "libraryId",
  "existingBorrower",
  "borrower.name",
  "borrower.idNumber",
  "borrower.contact",
  "borrower.affiliation",
  "items",
  "dueDate",
  "notes",
] as const

const SERVER_FIELD_MAP: Record<string, string> = { borrowerId: "existingBorrower", website: "notes" }

type StaffProps = {
  mode: "staff"
  libraries: Library[]
  initialLibraryId: string | null
  onCreated: (loan: LoanDetail) => void
  slug?: never
  categories?: never
  onSubmitted?: never
}

type PublicProps = {
  mode: "public"
  slug: string
  categories: { id: string; name: string }[]
  onSubmitted: (result: PublicRequestResult) => void
  libraries?: never
  initialLibraryId?: never
  onCreated?: never
}

const emptyOrUndefined = (s: string) => (s.trim() === "" ? undefined : s.trim())

/** The borrow form shared by staff (/loans/new) and the public form (/borrow/:slug). */
export function BorrowForm(props: StaffProps | PublicProps) {
  const { mode } = props
  const limits = LIMITS[mode]
  const createLoan = useCreateLoan()
  const submitPublic = useSubmitPublicRequest(props.slug ?? "")
  const [lineIssues, setLineIssues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<Values>({
    resolver: zodResolver(makeSchema(mode)),
    defaultValues: {
      libraryId: mode === "staff" ? (props.initialLibraryId ?? (props.libraries.length === 1 ? props.libraries[0]!.id : "")) : "",
      borrowerMode: "existing",
      existingBorrower: null,
      borrower: { name: "", idNumber: "", contact: "", affiliation: "" },
      items: [],
      dueDate: "",
      notes: "",
      website: "",
    },
  })
  const { errors, isSubmitting } = form.formState
  const libraryId = useWatch({ control: form.control, name: "libraryId" })
  const borrowerMode = useWatch({ control: form.control, name: "borrowerMode" })
  const library = mode === "staff" ? props.libraries.find((l) => l.id === libraryId) : undefined
  const pending = isSubmitting || createLoan.isPending || submitPublic.isPending

  const handleError = (error: unknown, lines: ItemLine[]) => {
    const issues = lineIssuesFromError(error, lines)
    if (issues) setLineIssues(issues)
    // The server's stock numbers are newer than what the picker showed: refresh the affected lines
    // so they don't keep saying e.g. "1 of 1 available" next to "No copies available".
    if (mode === "staff" && error instanceof ApiError && error.code === "INSUFFICIENT_COPIES") {
      const short = new Map(
        ((error.details as InsufficientCopiesDetails | undefined)?.books ?? []).map((b) => [b.bookId, b.available]),
      )
      if (short.size > 0) {
        form.setValue(
          "items",
          lines.map((l) => {
            const available = short.get(l.bookId)
            return available === undefined
              ? l
              : { ...l, maxQuantity: Math.max(1, Math.min(available, l.maxQuantity)), note: `${available} available now` }
          }),
        )
      }
    }
    applyServerErrors(error, form.setError, KNOWN_FIELDS, SERVER_FIELD_MAP)
    let message = errorMessage(error)
    if (error instanceof ApiError) {
      if (error.code === "INSUFFICIENT_COPIES") message = "Not enough copies. See the marked books."
      if (error.code === "INVALID_BOOKS") message = "Some books can't be borrowed. See the marked books."
      if (mode === "public" && error.status === 404) message = "This borrow form is closed."
    }
    setFormError(message)
    toast.error(message)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    setLineIssues({})
    const items = values.items.map((l) => ({ bookId: l.bookId, quantity: l.quantity }))
    const notes = emptyOrUndefined(values.notes)
    const borrower = {
      name: values.borrower.name.trim(),
      idNumber: emptyOrUndefined(values.borrower.idNumber),
      contact: emptyOrUndefined(values.borrower.contact),
      affiliation: emptyOrUndefined(values.borrower.affiliation),
    }
    try {
      if (props.mode === "staff") {
        const loan = await createLoan.mutateAsync({
          libraryId: values.libraryId,
          ...(values.borrowerMode === "existing" && values.existingBorrower
            ? { borrowerId: values.existingBorrower.id }
            : { borrower }),
          items,
          dueDate: values.dueDate || undefined,
          notes,
        })
        props.onCreated(loan)
      } else {
        const result = await submitPublic.mutateAsync({ borrower, items, notes, website: values.website })
        props.onSubmitted(result)
      }
    } catch (error) {
      handleError(error, values.items)
    }
  })

  const borrowerFields = (
    <FieldGroup className="gap-4">
      <Field data-invalid={!!errors.borrower?.name}>
        <FieldLabel htmlFor="borrower-name">Full name</FieldLabel>
        <Input
          id="borrower-name"
          autoComplete={mode === "public" ? "name" : "off"}
          aria-invalid={!!errors.borrower?.name}
          {...form.register("borrower.name")}
        />
        <FieldError errors={[errors.borrower?.name]} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!errors.borrower?.idNumber}>
          <FieldLabel htmlFor="borrower-id">ID number (optional)</FieldLabel>
          <Input id="borrower-id" autoComplete="off" aria-invalid={!!errors.borrower?.idNumber} {...form.register("borrower.idNumber")} />
          <FieldError errors={[errors.borrower?.idNumber]} />
        </Field>
        <Field data-invalid={!!errors.borrower?.contact}>
          <FieldLabel htmlFor="borrower-contact">Contact (optional)</FieldLabel>
          <Input id="borrower-contact" autoComplete={mode === "public" ? "tel" : "off"} placeholder="Phone or email" aria-invalid={!!errors.borrower?.contact} {...form.register("borrower.contact")} />
          <FieldError errors={[errors.borrower?.contact]} />
        </Field>
      </div>
      <Field data-invalid={!!errors.borrower?.affiliation}>
        <FieldLabel htmlFor="borrower-affiliation">Affiliation (optional)</FieldLabel>
        <Input id="borrower-affiliation" placeholder="e.g. Grade 10, Faculty" aria-invalid={!!errors.borrower?.affiliation} {...form.register("borrower.affiliation")} />
        <FieldError errors={[errors.borrower?.affiliation]} />
      </Field>
    </FieldGroup>
  )

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {mode === "staff" && (
        <Card>
          <CardHeader>
            <CardTitle>Library</CardTitle>
          </CardHeader>
          <CardContent>
            <Field data-invalid={!!errors.libraryId}>
              <FieldLabel htmlFor="library" className="sr-only">
                Library
              </FieldLabel>
              <Controller
                control={form.control}
                name="libraryId"
                render={({ field }) => (
                  <LibrarySelect
                    id="library"
                    libraries={props.libraries}
                    value={field.value || null}
                    onChange={(id) => {
                      if (id !== field.value) {
                        field.onChange(id)
                        // Books belong to one library: clear the lines when it changes.
                        form.setValue("items", [])
                        setLineIssues({})
                      }
                    }}
                    invalid={!!errors.libraryId}
                    disabled={pending}
                  />
                )}
              />
              <FieldError errors={[errors.libraryId]} />
            </Field>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{mode === "staff" ? "Borrower" : "Your details"}</CardTitle>
        </CardHeader>
        <CardContent>
          {mode === "staff" ? (
            <Tabs
              value={borrowerMode}
              onValueChange={(v) => form.setValue("borrowerMode", v === "new" ? "new" : "existing")}
            >
              <TabsList>
                <TabsTrigger value="existing">Existing borrower</TabsTrigger>
                <TabsTrigger value="new">New borrower</TabsTrigger>
              </TabsList>
              <TabsContent value="existing" className="pt-2">
                <Field data-invalid={!!errors.existingBorrower}>
                  <Controller
                    control={form.control}
                    name="existingBorrower"
                    render={({ field }) => (
                      <BorrowerPicker
                        value={field.value ?? null}
                        onChange={(b) => {
                          field.onChange(b)
                          if (b) form.clearErrors("existingBorrower")
                        }}
                        invalid={!!errors.existingBorrower}
                        disabled={pending}
                      />
                    )}
                  />
                  <FieldError errors={[errors.existingBorrower]} />
                </Field>
              </TabsContent>
              <TabsContent value="new" className="pt-2">
                {borrowerFields}
              </TabsContent>
            </Tabs>
          ) : (
            borrowerFields
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Books</CardTitle>
        </CardHeader>
        <CardContent>
          <Field data-invalid={!!errors.items}>
            <Controller
              control={form.control}
              name="items"
              render={({ field }) => (
                <LoanItemsEditor
                  mode={mode}
                  libraryId={mode === "staff" ? libraryId || null : null}
                  slug={props.slug}
                  categories={props.categories}
                  lines={field.value as ItemLine[]}
                  onChange={(lines) => {
                    field.onChange(lines)
                    // Clear highlights for lines that were changed or removed.
                    setLineIssues((prev) => {
                      const next: Record<string, string> = {}
                      for (const [bookId, msg] of Object.entries(prev)) {
                        const before = (field.value as ItemLine[]).find((l) => l.bookId === bookId)
                        const after = lines.find((l) => l.bookId === bookId)
                        if (after && before && after.quantity === before.quantity) next[bookId] = msg
                      }
                      return next
                    })
                    if (lines.length > 0) form.clearErrors("items")
                  }}
                  issues={lineIssues}
                  maxBooks={limits.maxBooks}
                  disabled={pending}
                  invalid={!!errors.items}
                />
              )}
            />
            <FieldError errors={[errors.items as { message?: string } | undefined]} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{mode === "staff" ? "Due date & notes" : "Notes (optional)"}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-4">
            {mode === "staff" && (
              <Field data-invalid={!!errors.dueDate}>
                <FieldLabel htmlFor="dueDate">Due date (optional)</FieldLabel>
                <Input
                  id="dueDate"
                  type="date"
                  min={todayInManila()}
                  className="w-full sm:w-52"
                  aria-invalid={!!errors.dueDate}
                  {...form.register("dueDate")}
                />
                {library && <FieldDescription>Default: {library.defaultLoanDays} days.</FieldDescription>}
                <FieldError errors={[errors.dueDate]} />
              </Field>
            )}
            <Field data-invalid={!!errors.notes}>
              <FieldLabel htmlFor="notes" className={mode === "public" ? "sr-only" : undefined}>
                Notes (optional)
              </FieldLabel>
              <Textarea
                id="notes"
                rows={3}
                maxLength={500}
                aria-invalid={!!errors.notes}
                {...form.register("notes")}
              />
              <FieldError errors={[errors.notes]} />
            </Field>
          </FieldGroup>
          {mode === "public" && (
            // Honeypot: visually hidden, never filled by real people.
            <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] h-px w-px overflow-hidden opacity-0">
              <label htmlFor="website">Website</label>
              <input id="website" type="text" tabIndex={-1} autoComplete="off" {...form.register("website")} />
            </div>
          )}
        </CardContent>
      </Card>

      {formError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" size="lg" disabled={pending} className="sm:min-w-40">
          {pending && <Spinner data-icon="inline-start" />}
          {mode === "staff" ? "Confirm Borrow" : "Submit request"}
        </Button>
      </div>
    </form>
  )
}
