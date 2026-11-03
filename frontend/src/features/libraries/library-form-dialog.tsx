import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useCreateLibrary, useUpdateLibrary } from "@/features/libraries/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import type { Library, LibraryInput } from "@/types/api"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "At most 120 characters"),
  slug: z
    .string()
    .trim()
    .refine((s) => s === "" || /^[a-z0-9-]{3,60}$/.test(s), "3–60 lowercase letters, numbers or dashes"),
  description: z.string().trim().max(1000, "At most 1000 characters"),
  location: z.string().trim().max(200, "At most 200 characters"),
  defaultLoanDays: z
    .string()
    .trim()
    .refine((s) => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 365, "Enter 1 to 365 days"),
  publicFormEnabled: z.boolean(),
})
type Values = z.input<typeof schema>
const KNOWN = ["name", "slug", "description", "location", "defaultLoanDays", "publicFormEnabled"] as const

function UpdateForm({ library, onDone }: { library: Library; onDone: () => void }) {
  const update = useUpdateLibrary(library.id)
  return <LibraryForm library={library} pending={update.isPending} submit={(body) => update.mutateAsync(body)} onDone={onDone} />
}

function CreateForm({ onDone }: { onDone: (lib?: Library) => void }) {
  const create = useCreateLibrary()
  return <LibraryForm pending={create.isPending} submit={(body) => create.mutateAsync(body as LibraryInput)} onDone={onDone} />
}

function LibraryForm({
  library,
  pending,
  submit,
  onDone,
}: {
  library?: Library
  pending: boolean
  submit: (body: Partial<LibraryInput>) => Promise<Library>
  onDone: (lib?: Library) => void
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: library?.name ?? "",
      slug: library?.slug ?? "",
      description: library?.description ?? "",
      location: library?.location ?? "",
      defaultLoanDays: String(library?.defaultLoanDays ?? 7),
      publicFormEnabled: library?.publicFormEnabled ?? false,
    },
  })
  const { errors } = form.formState
  const slug = useWatch({ control: form.control, name: "slug" })

  const onSubmit = form.handleSubmit(async (v) => {
    const t = (s: string) => (s.trim() === "" ? null : s.trim())
    const body: Partial<LibraryInput> = {
      name: v.name.trim(),
      description: t(v.description),
      location: t(v.location),
      defaultLoanDays: Number(v.defaultLoanDays),
      publicFormEnabled: v.publicFormEnabled,
    }
    if (v.slug.trim()) body.slug = v.slug.trim()
    try {
      const saved = await submit(body)
      toast.success(library ? "Library saved." : `${saved.name} created.`)
      onDone(saved)
    } catch (error) {
      if (error instanceof ApiError && error.code === "SLUG_TAKEN") {
        form.setError("slug", { message: "This link name is already used." })
      } else if (!applyServerErrors(error, form.setError, KNOWN)) {
        toast.error(errorMessage(error))
      }
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="lib-name">Name</FieldLabel>
          <Input id="lib-name" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.slug}>
          <FieldLabel htmlFor="lib-slug">Link name</FieldLabel>
          <Input id="lib-slug" placeholder={library ? undefined : "Leave blank to use the name"} aria-invalid={!!errors.slug} {...form.register("slug")} />
          <FieldDescription>
            /borrow/<span className="font-mono">{slug || "…"}</span>
            {library && " · Changing it breaks shared links."}
          </FieldDescription>
          <FieldError errors={[errors.slug]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.location}>
            <FieldLabel htmlFor="lib-location">Location</FieldLabel>
            <Input id="lib-location" aria-invalid={!!errors.location} {...form.register("location")} />
            <FieldError errors={[errors.location]} />
          </Field>
          <Field data-invalid={!!errors.defaultLoanDays}>
            <FieldLabel htmlFor="lib-days">Borrowing days</FieldLabel>
            <Input id="lib-days" type="number" min={1} max={365} inputMode="numeric" aria-invalid={!!errors.defaultLoanDays} {...form.register("defaultLoanDays")} />
            <FieldError errors={[errors.defaultLoanDays]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="lib-desc">Description</FieldLabel>
          <Textarea id="lib-desc" rows={2} maxLength={1000} aria-invalid={!!errors.description} {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>
        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="publicFormEnabled"
            render={({ field }) => (
              <Switch id="lib-public" checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
          <FieldContent>
            <FieldLabel htmlFor="lib-public">Public borrow form</FieldLabel>
            <FieldDescription>Anyone with the link can request books.</FieldDescription>
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {library ? "Save changes" : "Create library"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  )
}

/** Create / edit a library (admin). Mount only while open. */
export function LibraryFormDialog({
  open,
  onOpenChange,
  library,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  library?: Library
  onCreated?: (lib: Library) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{library ? "Edit library" : "New library"}</DialogTitle>
        </DialogHeader>
        {library ? (
          <UpdateForm library={library} onDone={() => onOpenChange(false)} />
        ) : (
          <CreateForm
            onDone={(lib) => {
              onOpenChange(false)
              if (lib) onCreated?.(lib)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
