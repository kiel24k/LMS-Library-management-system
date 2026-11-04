import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { SendIcon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { lineIssuesFromError } from "@/features/loans/loan-errors"
import { useSubmitPublicRequest } from "@/features/public/api"
import type { RequestLine } from "@/features/public/request-lines"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import type { PublicRequestResult } from "@/types/api"

/** Same rule as the API for public requests: name@host.tld (a dot in the domain). */
const PUBLIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label} must be at most ${max} characters`)

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .max(254, "Email must be at most 254 characters")
    .regex(PUBLIC_EMAIL, "Enter a valid email, e.g. name@example.com"),
  name: z.string().trim().min(2, "Enter your full name").max(120, "Name must be at most 120 characters"),
  idNumber: optionalText(50, "ID number"),
  contact: optionalText(120, "Contact"),
  affiliation: optionalText(120, "Affiliation"),
  notes: optionalText(500, "Notes"),
  website: z.string(),
})
type Values = z.input<typeof schema>

const KNOWN = ["email", "name", "idNumber", "contact", "affiliation", "notes"] as const
const SERVER_FIELDS: Record<string, string> = {
  "borrower.email": "email",
  "borrower.name": "name",
  "borrower.idNumber": "idNumber",
  "borrower.contact": "contact",
  "borrower.affiliation": "affiliation",
  website: "notes",
}

const orUndefined = (s: string) => (s.trim() === "" ? undefined : s.trim())

/**
 * "Your details" step of the public borrow form: email (required, the library's answer is sent there), name and the
 * optional details, then sends the request for `lines`. Problems with single books are passed to `onLineIssues`.
 */
export function RequestForm({
  slug,
  lines,
  onLineIssues,
  onSubmitted,
}: {
  slug: string
  lines: RequestLine[]
  onLineIssues: (issues: Record<string, string>) => void
  onSubmitted: (result: PublicRequestResult, email: string) => void
}) {
  const submit = useSubmitPublicRequest(slug)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", name: "", idNumber: "", contact: "", affiliation: "", notes: "", website: "" },
  })
  const { errors, isSubmitting } = form.formState
  const pending = isSubmitting || submit.isPending

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null)
    onLineIssues({})
    if (lines.length === 0) {
      setFormError("Add at least one book.")
      return
    }
    const email = v.email.trim().toLowerCase()
    try {
      const result = await submit.mutateAsync({
        borrower: {
          name: v.name.trim(),
          email,
          idNumber: orUndefined(v.idNumber),
          contact: orUndefined(v.contact),
          affiliation: orUndefined(v.affiliation),
        },
        items: lines.map((l) => ({ bookId: l.bookId, quantity: l.quantity })),
        notes: orUndefined(v.notes),
        website: v.website,
      })
      // Errors from earlier tries no longer apply.
      toast.dismiss()
      onSubmitted(result, email)
    } catch (error) {
      const issues = lineIssuesFromError(error, lines)
      if (issues) onLineIssues(issues)
      let message = errorMessage(error)
      if (error instanceof ApiError) {
        if (error.code === "EMAIL_MISMATCH") form.setError("email", { message: error.message }, { shouldFocus: true })
        else applyServerErrors(error, form.setError, KNOWN, SERVER_FIELDS)
        if (error.code === "INSUFFICIENT_COPIES") message = "Not enough copies of some books. See the marked books."
        if (error.code === "INVALID_BOOKS") message = "Some books can't be borrowed. Remove the marked books."
        if (error.status === 404) message = "This borrow form is closed. Please ask the library staff."
      }
      setFormError(message)
      toast.error(message)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Your details</CardTitle>
        <CardDescription>We'll email you when the library accepts or declines your request.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="relative">
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="req-email">Email</FieldLabel>
              <Input
                id="req-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="name@example.com"
                className="h-10"
                aria-invalid={!!errors.email}
                aria-required
                aria-describedby="req-email-hint"
                {...form.register("email")}
              />
              <FieldDescription id="req-email-hint">
                If the request is accepted, this email also becomes your sign-in for checking your books.
              </FieldDescription>
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="req-name">Full name</FieldLabel>
              <Input
                id="req-name"
                autoComplete="name"
                className="h-10"
                aria-invalid={!!errors.name}
                aria-required
                {...form.register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.idNumber}>
                <FieldLabel htmlFor="req-id">
                  ID number <span className="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Input id="req-id" autoComplete="off" className="h-10" aria-invalid={!!errors.idNumber} {...form.register("idNumber")} />
                <FieldError errors={[errors.idNumber]} />
              </Field>
              <Field data-invalid={!!errors.contact}>
                <FieldLabel htmlFor="req-contact">
                  Phone <span className="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Input
                  id="req-contact"
                  type="tel"
                  autoComplete="tel"
                  className="h-10"
                  aria-invalid={!!errors.contact}
                  {...form.register("contact")}
                />
                <FieldError errors={[errors.contact]} />
              </Field>
            </div>
            <Field data-invalid={!!errors.affiliation}>
              <FieldLabel htmlFor="req-affiliation">
                Affiliation <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="req-affiliation"
                autoComplete="organization"
                placeholder="e.g. Grade 10, Faculty"
                className="h-10"
                aria-invalid={!!errors.affiliation}
                {...form.register("affiliation")}
              />
              <FieldError errors={[errors.affiliation]} />
            </Field>
            <Field data-invalid={!!errors.notes}>
              <FieldLabel htmlFor="req-notes">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Textarea
                id="req-notes"
                rows={3}
                maxLength={500}
                placeholder="Anything the library should know"
                aria-invalid={!!errors.notes}
                {...form.register("notes")}
              />
              <FieldError errors={[errors.notes]} />
            </Field>

            {/* Honeypot: visually hidden, never filled by real people. */}
            <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] h-px w-px overflow-hidden opacity-0">
              <label htmlFor="req-website">Website</label>
              <input id="req-website" type="text" tabIndex={-1} autoComplete="off" {...form.register("website")} />
            </div>

            {formError && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={pending || lines.length === 0}>
              {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
              Send request
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
