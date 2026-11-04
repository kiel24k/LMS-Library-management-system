import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useCreateBorrower, useUpdateBorrower } from "@/features/borrowers/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import type { Borrower } from "@/types/api"

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  // Optional. Same loose check as the API (name@host); accept/reject emails and their sign-in use it.
  email: z
    .string()
    .trim()
    .max(254, "At most 254 characters")
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+$/.test(v), "Enter a valid email address"),
  idNumber: z.string().trim().max(50, "At most 50 characters"),
  contact: z.string().trim().max(120, "At most 120 characters"),
  affiliation: z.string().trim().max(120, "At most 120 characters"),
})
type Values = z.input<typeof schema>
const KNOWN = ["name", "email", "idNumber", "contact", "affiliation"] as const

/** Create / edit a borrower. Mount only while open. */
export function BorrowerFormDialog({
  open,
  onOpenChange,
  borrower,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  borrower?: Pick<Borrower, "id" | "name" | "email" | "hasAccount" | "idNumber" | "contact" | "affiliation">
  onSaved?: (b: Borrower) => void
}) {
  const create = useCreateBorrower()
  const update = useUpdateBorrower()
  const pending = create.isPending || update.isPending
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: borrower?.name ?? "",
      email: borrower?.email ?? "",
      idNumber: borrower?.idNumber ?? "",
      contact: borrower?.contact ?? "",
      affiliation: borrower?.affiliation ?? "",
    },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    const t = (s: string) => (s.trim() === "" ? null : s.trim())
    const body = {
      name: v.name.trim(),
      email: t(v.email)?.toLowerCase() ?? null,
      idNumber: t(v.idNumber),
      contact: t(v.contact),
      affiliation: t(v.affiliation),
    }
    try {
      const saved = borrower ? await update.mutateAsync({ id: borrower.id, ...body }) : await create.mutateAsync(body)
      toast.success(borrower ? "Borrower saved." : `${saved.name} added.`)
      onSaved?.(saved)
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError && error.code === "ID_NUMBER_TAKEN") {
        form.setError("idNumber", { message: "This ID number is already used." })
      } else if (error instanceof ApiError && error.code === "EMAIL_TAKEN") {
        form.setError("email", { message: "Another borrower already has this email." }, { shouldFocus: true })
      } else if (!applyServerErrors(error, form.setError, KNOWN)) {
        toast.error(errorMessage(error))
      }
    }
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{borrower ? "Edit borrower" : "Add borrower"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="b-name">Full name</FieldLabel>
              <Input id="b-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="b-email">Email (optional)</FieldLabel>
              <Input
                id="b-email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!errors.email}
                aria-describedby="b-email-hint"
                {...form.register("email")}
              />
              {errors.email ? (
                <FieldError errors={[errors.email]} />
              ) : (
                <FieldDescription id="b-email-hint">
                  {borrower?.hasAccount
                    ? "Used for accept / reject emails. Changing it doesn't change the email their account signs in with."
                    : "Used for accept / reject emails and the account made when a request is accepted."}
                </FieldDescription>
              )}
            </Field>
            <Field data-invalid={!!errors.idNumber}>
              <FieldLabel htmlFor="b-id">ID number</FieldLabel>
              <Input id="b-id" aria-invalid={!!errors.idNumber} {...form.register("idNumber")} />
              <FieldError errors={[errors.idNumber]} />
            </Field>
            <Field data-invalid={!!errors.contact}>
              <FieldLabel htmlFor="b-contact">Contact</FieldLabel>
              <Input id="b-contact" placeholder="Phone or email" aria-invalid={!!errors.contact} {...form.register("contact")} />
              <FieldError errors={[errors.contact]} />
            </Field>
            <Field data-invalid={!!errors.affiliation}>
              <FieldLabel htmlFor="b-aff">Affiliation</FieldLabel>
              <Input id="b-aff" placeholder="e.g. Grade 10" aria-invalid={!!errors.affiliation} {...form.register("affiliation")} />
              <FieldError errors={[errors.affiliation]} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {borrower ? "Save changes" : "Add borrower"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
