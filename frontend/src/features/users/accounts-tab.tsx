import { useEffect, useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, useWatch } from "react-hook-form"
import { Link } from "react-router"
import { PencilIcon, PlusIcon, ShieldIcon, UserCogIcon, UserRoundIcon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Can } from "@/components/can"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/features/auth/use-auth"
import { MustChangePasswordBadge } from "@/features/users/account-badge"
import { useRoles } from "@/features/roles/api"
import { canGrantRole } from "@/features/roles/permission-graph"
import { useCreateUser, useUpdateUser, useUsers } from "@/features/users/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import { formatDate } from "@/lib/format"
import type { RoleDetail, User, UserPatchInput } from "@/types/api"

const LOCKED_HINT = "This account has permissions you don't have, so you can't change this."

/** Errors the API explains well enough to show as they are. */
const SHOW_AS_IS = new Set(["SELF_MODIFICATION", "ACCESS_LOCKOUT", "PERMISSION_ESCALATION", "FORBIDDEN"])

/**
 * Role picker. Roles holding permissions the signed-in user doesn't have can't be given (the API answers
 * PERMISSION_ESCALATION), so they are listed but disabled. The default role for new accounts is marked "(default)".
 */
function RoleSelect({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string
  value: string
  onChange: (roleId: string) => void
  disabled?: boolean
  invalid?: boolean
}) {
  const { can } = useAuth()
  const roles = useRoles({ enabled: can("roles.view") })
  const list = roles.data ?? []
  const items = list.map((r) => ({ value: r.id, label: r.isDefault ? `${r.name} (default)` : r.name }))
  const grantable = (r: RoleDetail) => canGrantRole(r, can)

  return (
    <Select
      items={items}
      value={value || null}
      onValueChange={(v) => v && onChange(String(v))}
      disabled={disabled || roles.isPending}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder={roles.isPending ? "Loading roles…" : "Choose a role"} />
      </SelectTrigger>
      <SelectContent>
        {list.map((r) => (
          <SelectItem key={r.id} value={r.id} disabled={!grantable(r) && r.id !== value}>
            <span className="flex min-w-0 flex-col">
              <span>
                {r.name}
                {r.isDefault && <span className="ml-1.5 text-muted-foreground">(default)</span>}
              </span>
              {!grantable(r) && <span className="text-xs text-muted-foreground">Has permissions you don't have</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Whether an account's role holds a permission the signed-in user lacks. Such an account can be renamed but not
 * given a new password, (de)activated or moved to another role (the API answers PERMISSION_ESCALATION). Needs the
 * role list (roles.view); without it nothing is known and the API has the last word.
 */
function useOutranksMe() {
  const { can } = useAuth()
  const roles = useRoles({ enabled: can("roles.view") })
  return (roleId: string) => {
    const role = roles.data?.find((r) => r.id === roleId)
    return !!role && !canGrantRole(role, can)
  }
}

/**
 * `requireRole`: whether a role must be picked here. Without roles.view there is no role list to pick from, so the
 * role is left out and the API gives the default role.
 */
const createSchema = (requireRole: boolean) =>
  z.object({
    // Local addresses like admin@localhost are allowed, so only check the basic name@host shape.
    email: z.string().trim().min(1, "Email is required").regex(/^[^\s@]+@[^\s@]+$/, "Enter a valid email address"),
    name: z.string().trim().min(1, "Name is required").max(120, "At most 120 characters"),
    password: z.string().min(8, "At least 8 characters").max(72, "At most 72 characters"),
    roleId: requireRole ? z.string().min(1, "Choose a role") : z.string(),
  })
type CreateValues = z.input<ReturnType<typeof createSchema>>

function CreateUserDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth()
  const canPickRole = can("roles.view")
  const roles = useRoles({ enabled: canPickRole })
  const defaultRole = roles.data?.find((r) => r.isDefault)
  const defaultGrantable = !!defaultRole && canGrantRole(defaultRole, can)
  // Start on the default role — unless it can do more than you, then a role has to be picked.
  const preselect = defaultRole && defaultGrantable ? defaultRole.id : ""
  const create = useCreateUser()
  const schema = useMemo(() => createSchema(canPickRole), [canPickRole])
  const form = useForm<CreateValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", name: "", password: "", roleId: preselect },
  })
  const { errors } = form.formState
  const roleId = useWatch({ control: form.control, name: "roleId" })
  // The role list may still be loading when the dialog opens: preselect once it arrives, if nothing was picked yet.
  // After a submit attempt, re-validate so an earlier "Choose a role" error clears.
  useEffect(() => {
    if (preselect && !form.getValues("roleId")) {
      form.setValue("roleId", preselect, { shouldValidate: form.formState.isSubmitted })
    }
  }, [preselect, form])
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const u = await create.mutateAsync({
        email: v.email.trim().toLowerCase(),
        name: v.name.trim(),
        password: v.password,
        roleId: v.roleId || undefined, // left out → the default role
      })
      toast.success(`Account created for ${u.name}.`)
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError && e.code === "EMAIL_TAKEN") form.setError("email", { message: "This email is already used." })
      else if (e instanceof ApiError && SHOW_AS_IS.has(e.code)) toast.error(e.message)
      else if (!applyServerErrors(e, form.setError, ["email", "name", "password", "roleId"])) toast.error(errorMessage(e))
    }
  })

  return (
    <Dialog open onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>The role decides what this person can see and do.</DialogDescription>
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
              <Input
                id="u-pass"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                {...form.register("password")}
              />
              <FieldError errors={[errors.password]} />
            </Field>
            <Field data-invalid={!!errors.roleId}>
              {canPickRole ? (
                <>
                  <FieldLabel htmlFor="u-role">Role</FieldLabel>
                  <Controller
                    control={form.control}
                    name="roleId"
                    render={({ field }) => (
                      <RoleSelect id="u-role" value={field.value} onChange={field.onChange} invalid={!!errors.roleId} />
                    )}
                  />
                  {defaultRole && !defaultGrantable && !roleId && (
                    <FieldDescription>
                      The default role, "{defaultRole.name}", has permissions you don't have, so pick another one.
                    </FieldDescription>
                  )}
                  {roles.isSuccess && !defaultRole && !roleId && (
                    <FieldDescription>No default role is set, so pick one.</FieldDescription>
                  )}
                </>
              ) : (
                <>
                  <FieldTitle>Role</FieldTitle>
                  <FieldDescription>New accounts get the default role.</FieldDescription>
                </>
              )}
              <FieldError errors={[errors.roleId]} />
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
  roleId: z.string().min(1, "Choose a role"),
  active: z.boolean(),
  password: z.string().refine((s) => s === "" || (s.length >= 8 && s.length <= 72), "8–72 characters (or leave blank)"),
})
type EditValues = z.input<typeof editSchema>

/**
 * Only shows what the signed-in user may change: name + role (users.update), active (users.deactivate),
 * new password (users.reset_password) — and only sends those fields.
 */
function EditUserDialog({ user, isSelf, onOpenChange }: { user: User; isSelf: boolean; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth()
  const outranksMe = useOutranksMe()
  // Password, active and role stay as they are for an account that can do more than you (your own never can).
  const locked = !isSelf && outranksMe(user.role.id)
  const canEdit = can("users.update")
  const canDeactivate = can("users.deactivate")
  const canResetPassword = can("users.reset_password") && !locked
  const update = useUpdateUser()
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: user.name, roleId: user.role.id, active: user.active, password: "" },
  })
  const { errors } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    const body: UserPatchInput = {}
    if (canEdit && v.name.trim() !== user.name) body.name = v.name.trim()
    if (canEdit && !isSelf && !locked && v.roleId !== user.role.id) body.roleId = v.roleId
    if (canDeactivate && !isSelf && !locked && v.active !== user.active) body.active = v.active
    if (canResetPassword && v.password) body.password = v.password
    if (Object.keys(body).length === 0) {
      onOpenChange(false)
      return
    }
    try {
      await update.mutateAsync({ id: user.id, ...body })
      toast.success("Account saved.")
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError && SHOW_AS_IS.has(e.code)) toast.error(e.message)
      else if (!applyServerErrors(e, form.setError, ["name", "roleId", "active", "password"])) toast.error(errorMessage(e))
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
            {canEdit && (
              <>
                <Field data-invalid={!!errors.name}>
                  <FieldLabel htmlFor="e-name">Name</FieldLabel>
                  <Input id="e-name" aria-invalid={!!errors.name} {...form.register("name")} />
                  <FieldError errors={[errors.name]} />
                </Field>
                <Field data-invalid={!!errors.roleId}>
                  <FieldLabel htmlFor="e-role">Role</FieldLabel>
                  <Controller
                    control={form.control}
                    name="roleId"
                    render={({ field }) => (
                      <RoleSelect
                        id="e-role"
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSelf || locked}
                        invalid={!!errors.roleId}
                      />
                    )}
                  />
                  {isSelf && <FieldDescription>You can't change your own role.</FieldDescription>}
                  {locked && <FieldDescription>{LOCKED_HINT}</FieldDescription>}
                  <FieldError errors={[errors.roleId]} />
                </Field>
              </>
            )}
            {canDeactivate && (
              <Field orientation="horizontal">
                <Controller
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <Switch id="e-active" checked={field.value} onCheckedChange={field.onChange} disabled={isSelf || locked} />
                  )}
                />
                <FieldContent>
                  <FieldLabel htmlFor="e-active">Active</FieldLabel>
                  <FieldDescription>
                    {isSelf ? "You can't deactivate yourself." : locked ? LOCKED_HINT : "Inactive accounts can't log in."}
                  </FieldDescription>
                </FieldContent>
              </Field>
            )}
            {canResetPassword && (
              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="e-pass">New password (optional)</FieldLabel>
                <Input
                  id="e-pass"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Leave blank to keep"
                  aria-invalid={!!errors.password}
                  {...form.register("password")}
                />
                {/* Setting a password leaves the forced change in place (the given password is still not their own). */}
                {user.mustChangePassword && (
                  <FieldDescription>They'll still be asked to choose their own password when they sign in.</FieldDescription>
                )}
                <FieldError errors={[errors.password]} />
              </Field>
            )}
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

/** "Borrower: <name>" under an account linked to a borrower (a link to the borrower for borrowers.view holders). */
function LinkedBorrower({ borrower }: { borrower: NonNullable<User["borrower"]> }) {
  const { can } = useAuth()
  return (
    <div className="mt-0.5 flex items-center gap-1 text-xs font-normal text-muted-foreground">
      <UserRoundIcon className="size-3.5 shrink-0" aria-hidden />
      <span>Borrower:</span>
      {can("borrowers.view") ? (
        <Link to={`/borrowers/${borrower.id}`} className="truncate text-foreground underline-offset-4 hover:underline">
          {borrower.name}
        </Link>
      ) : (
        <span className="truncate">{borrower.name}</span>
      )}
    </div>
  )
}

/**
 * "Accounts" tab of the Users page (users.view): every account that can sign in. Accounts made when a borrower's
 * request was accepted are ordinary accounts (default role) that show the linked borrower.
 */
export function AccountsTab() {
  const { user: me, can, canAny } = useAuth()
  const users = useUsers({ enabled: can("users.view") })
  const canEditSomething = canAny("users.update", "users.deactivate", "users.reset_password")
  const outranksMe = useOutranksMe()
  // Renaming (users.update) is always possible; the rest only for accounts that can't do more than you.
  const canEditRow = (u: User) => can("users.update") || u.id === me?.id || !outranksMe(u.role.id)
  const [dialog, setDialog] = useState<"new" | User | null>(null)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {users.data ? `${users.data.length} ${users.data.length === 1 ? "account" : "accounts"}` : " "}
        </p>
        <Can perm="users.create">
          <Button onClick={() => setDialog("new")}>
            <PlusIcon data-icon="inline-start" />
            Add account
          </Button>
        </Can>
      </div>
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
                  {canEditSomething && (
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.map((u) => (
                  <TableRow key={u.id} className={u.active ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">
                      {u.name}
                      {u.id === me?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      {u.borrower && <LinkedBorrower borrower={u.borrower} />}
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        <ShieldIcon data-icon="inline-start" />
                        {u.role.name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.active ? (
                          <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">Active</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                        {u.mustChangePassword && <MustChangePasswordBadge />}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(u.createdAt)}</TableCell>
                    {canEditSomething && (
                      <TableCell>
                        {canEditRow(u) && (
                          <Button variant="ghost" size="icon-sm" onClick={() => setDialog(u)} aria-label={`Edit ${u.name}`}>
                            <PencilIcon />
                          </Button>
                        )}
                      </TableCell>
                    )}
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
