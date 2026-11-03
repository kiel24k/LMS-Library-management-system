import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { PencilIcon, PlusIcon, UserCogIcon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { useCreateUser, useUpdateUser, useUsers } from "@/features/users/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import { formatDate } from "@/lib/format"
import type { Role, User } from "@/types/api"

const ROLE_ITEMS = [
  { value: "STAFF", label: "Staff" },
  { value: "ADMIN", label: "Admin" },
]

function RoleSelect({ id, value, onChange, disabled }: { id: string; value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <Select items={ROLE_ITEMS} value={value} onValueChange={(v) => v && onChange(v as Role)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_ITEMS.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const createSchema = z.object({
  // Local addresses like admin@localhost are allowed, so only check the basic name@host shape.
  email: z.string().trim().min(1, "Email is required").regex(/^[^\s@]+@[^\s@]+$/, "Enter a valid email address"),
  name: z.string().trim().min(1, "Name is required").max(120, "At most 120 characters"),
  password: z.string().min(8, "At least 8 characters").max(72, "At most 72 characters"),
  role: z.enum(["ADMIN", "STAFF"]),
})
type CreateValues = z.input<typeof createSchema>

function CreateUserDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const create = useCreateUser()
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: "", name: "", password: "", role: "STAFF" },
  })
  const { errors } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const u = await create.mutateAsync({ email: v.email.trim().toLowerCase(), name: v.name.trim(), password: v.password, role: v.role })
      toast.success(`Account created for ${u.name}.`)
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError && e.code === "EMAIL_TAKEN") form.setError("email", { message: "This email is already used." })
      else if (!applyServerErrors(e, form.setError, ["email", "name", "password", "role"])) toast.error(errorMessage(e))
    }
  })

  return (
    <Dialog open onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="u-name">Name</FieldLabel>
              <Input id="u-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="u-email">Email</FieldLabel>
              <Input id="u-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="u-pass">Initial password</FieldLabel>
              <Input id="u-pass" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register("password")} />
              <FieldError errors={[errors.password]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-role">Role</FieldLabel>
              <Controller control={form.control} name="role" render={({ field }) => <RoleSelect id="u-role" value={field.value} onChange={field.onChange} />} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Spinner data-icon="inline-start" />}
                Create account
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const editSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "At most 120 characters"),
  role: z.enum(["ADMIN", "STAFF"]),
  active: z.boolean(),
  password: z.string().refine((s) => s === "" || (s.length >= 8 && s.length <= 72), "8–72 characters (or leave blank)"),
})
type EditValues = z.input<typeof editSchema>

function EditUserDialog({ user, isSelf, onOpenChange }: { user: User; isSelf: boolean; onOpenChange: (o: boolean) => void }) {
  const update = useUpdateUser()
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: user.name, role: user.role, active: user.active, password: "" },
  })
  const { errors } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    const body: { name?: string; role?: Role; active?: boolean; password?: string } = { name: v.name.trim() }
    if (v.role !== user.role) body.role = v.role
    if (v.active !== user.active) body.active = v.active
    if (v.password) body.password = v.password
    try {
      await update.mutateAsync({ id: user.id, ...body })
      toast.success("Account saved.")
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError && (e.code === "LAST_ADMIN" || e.code === "SELF_MODIFICATION")) toast.error(e.message)
      else if (!applyServerErrors(e, form.setError, ["name", "role", "active", "password"])) toast.error(errorMessage(e))
    }
  })

  return (
    <Dialog open onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="e-name">Name</FieldLabel>
              <Input id="e-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="e-role">Role</FieldLabel>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => <RoleSelect id="e-role" value={field.value} onChange={field.onChange} disabled={isSelf} />}
              />
              {isSelf && <FieldDescription>You can't change your own role.</FieldDescription>}
            </Field>
            <Field orientation="horizontal">
              <Controller
                control={form.control}
                name="active"
                render={({ field }) => <Switch id="e-active" checked={field.value} onCheckedChange={field.onChange} disabled={isSelf} />}
              />
              <FieldContent>
                <FieldLabel htmlFor="e-active">Active</FieldLabel>
                <FieldDescription>
                  {isSelf ? "You can't deactivate yourself." : "Inactive accounts can't log in."}
                </FieldDescription>
              </FieldContent>
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="e-pass">New password (optional)</FieldLabel>
              <Input id="e-pass" type="password" autoComplete="new-password" placeholder="Leave blank to keep" aria-invalid={!!errors.password} {...form.register("password")} />
              <FieldError errors={[errors.password]} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Spinner data-icon="inline-start" />}
                Save
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function UsersPage() {
  const { user: me } = useAuth()
  const users = useUsers()
  const [dialog, setDialog] = useState<"new" | User | null>(null)

  return (
    <>
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setDialog("new")}>
            <PlusIcon data-icon="inline-start" />
            Add account
          </Button>
        }
      />
      <Card>
        <CardContent>
          {users.isPending ? (
            <TableSkeleton columns={5} />
          ) : users.isError ? (
            <ErrorState error={users.error} onRetry={() => void users.refetch()} />
          ) : users.data.length === 0 ? (
            <EmptyState icon={<UserCogIcon />} title="No accounts" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.map((u) => (
                  <TableRow key={u.id} className={u.active ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">
                      {u.name}
                      {u.id === me?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role === "ADMIN" ? "Admin" : "Staff"}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.active ? (
                        <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(u.createdAt)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDialog(u)} aria-label={`Edit ${u.name}`}>
                        <PencilIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {dialog === "new" && <CreateUserDialog onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog && dialog !== "new" && (
        <EditUserDialog user={dialog} isSelf={dialog.id === me?.id} onOpenChange={(o) => !o && setDialog(null)} />
      )}
    </>
  )
}
