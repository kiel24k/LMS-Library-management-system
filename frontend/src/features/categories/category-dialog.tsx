import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useCreateCategory, useUpdateCategory } from "@/features/categories/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import type { Category } from "@/types/api"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "At most 80 characters"),
  description: z.string().trim().max(500, "At most 500 characters"),
})
type Values = z.input<typeof schema>

/** Add / rename a category inside a library. Mount only while open. */
export function CategoryDialog({
  libraryId,
  category,
  open,
  onOpenChange,
}: {
  libraryId: string
  category?: Category
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateCategory(libraryId)
  const update = useUpdateCategory()
  const pending = create.isPending || update.isPending
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: category?.name ?? "", description: category?.description ?? "" },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    const body = { name: v.name.trim(), description: v.description.trim() || null }
    try {
      if (category) await update.mutateAsync({ id: category.id, ...body })
      else await create.mutateAsync(body)
      toast.success(category ? "Category saved." : `Category “${body.name}” added.`)
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError && error.code === "CATEGORY_EXISTS") {
        form.setError("name", { message: "This category already exists." })
      } else if (!applyServerErrors(error, form.setError, ["name", "description"])) {
        toast.error(errorMessage(error))
      }
    }
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "Add category"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="cat-name">Name</FieldLabel>
              <Input id="cat-name" placeholder="e.g. Filipiniana, Fiction, Reference" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor="cat-desc">Description (optional)</FieldLabel>
              <Textarea id="cat-desc" rows={2} maxLength={500} aria-invalid={!!errors.description} {...form.register("description")} />
              <FieldError errors={[errors.description]} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {category ? "Save" : "Add category"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
