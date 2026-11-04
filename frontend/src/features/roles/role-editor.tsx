import { useEffect, useMemo, useState } from "react"
import { useBlocker } from "react-router"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, useWatch } from "react-hook-form"
import { EyeIcon, SaveIcon, ShieldIcon, StarIcon, Trash2Icon, UndoIcon, UserPlusIcon, UserRoundCheckIcon } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/features/auth/use-auth"
import { useCreateRole, useDeleteRole, useUpdateRole } from "@/features/roles/api"
import { DEFAULT_ROLE_HINT } from "@/features/roles/default-role"
import { PermissionEditor } from "@/features/roles/permission-editor"
import { canGrantRole, type CatalogIndex } from "@/features/roles/permission-graph"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import { PERMISSIONS, type Permission } from "@/lib/permissions"
import type { RoleDetail, RolePatchInput } from "@/types/api"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "At most 60 characters"),
  description: z.string().trim().max(200, "At most 200 characters"),
  permissions: z.array(z.enum(PERMISSIONS)),
})
type Values = z.input<typeof schema>

/**
 * Navigation state that skips the "Discard unsaved changes?" question — for the navigation that follows our
 * own create / delete (the form is still marked dirty in that render).
 */
export const LEAVE_WITHOUT_ASKING = "leaveWithoutAsking"

/** Errors the API explains well enough to show as they are. */
const SHOW_AS_IS = new Set(["ROLE_IN_USE", "ROLE_IS_DEFAULT", "ACCESS_LOCKOUT", "PERMISSION_ESCALATION", "FORBIDDEN"])

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

const toValues = (role: RoleDetail | null): Values => ({
  name: role?.name ?? "",
  description: role?.description ?? "",
  permissions: role?.permissions ?? [],
})

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p) => b.includes(p))

/**
 * Right side of "Roles & permissions": name, description, whether new accounts get it, and the permission tree of
 * one role (or a new one). Read-only without roles.update (roles.create for a new role). Asks before leaving with
 * unsaved changes.
 */
export function RoleEditor({
  role,
  index,
  defaultRole,
  onMakeDefault,
  makingDefault,
  onCreated,
  onDeleted,
}: {
  /** null = new role */
  role: RoleDetail | null
  index: CatalogIndex
  /** The role new accounts get, if any. */
  defaultRole: RoleDetail | null
  /** Asks to make the (saved) role the default — see useMakeDefaultRole. */
  onMakeDefault: (role: RoleDetail) => void
  makingDefault?: boolean
  /** Called after creating; navigate with state `{ [LEAVE_WITHOUT_ASKING]: true }`. */
  onCreated: (role: RoleDetail) => void
  /** Called after deleting; navigate with state `{ [LEAVE_WITHOUT_ASKING]: true }`. */
  onDeleted: () => void
}) {
  const { can, user: me } = useAuth()
  const isNew = role === null
  const editable = isNew ? can("roles.create") : can("roles.update")
  const create = useCreateRole()
  const update = useUpdateRole()
  const del = useDeleteRole()
  const pending = create.isPending || update.isPending
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** New role only: send `isDefault: true` on create. */
  const [createAsDefault, setCreateAsDefault] = useState(false)

  // `values` follows the role whenever the role list is refetched (another admin's change, window focus): fields
  // not edited here show the new data right away, fields being edited keep their input (keepDirtyValues), and the
  // saved state compared against for "Unsaved changes" / Discard becomes the new data.
  const values = useMemo(() => toValues(role), [role])
  const form = useForm<Values>({ resolver: zodResolver(schema), values, resetOptions: { keepDirtyValues: true } })
  const { errors, isDirty } = form.formState
  const permissions = useWatch({ control: form.control, name: "permissions" })

  // Mirrors the API's PERMISSION_ESCALATION rule: you can only turn on what you hold yourself
  // (or what the role already had when it was loaded).
  const original = new Set<Permission>(role?.permissions ?? [])
  const canAdd = (p: Permission) => can(p) || original.has(p)

  // Ask before switching role / tab / page with unsaved changes.
  const dirty = editable && isDirty
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !(nextLocation.state as Record<string, unknown> | null)?.[LEAVE_WITHOUT_ASKING] &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  )
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  const onSubmit = form.handleSubmit(async (v) => {
    const description = v.description.trim() || null
    try {
      if (isNew) {
        const created = await create.mutateAsync({
          name: v.name.trim(),
          description,
          permissions: v.permissions,
          ...(createAsDefault && { isDefault: true as const }),
        })
        toast.success(
          created.isDefault
            ? `Role "${created.name}" created. New accounts will get it.`
            : `Role "${created.name}" created.`,
        )
        form.reset({ name: created.name, description: created.description ?? "", permissions: created.permissions })
        onCreated(created)
      } else {
        // Only what was changed here is sent (compared with the latest role data, see `values`), so a save never
        // brings back what someone else changed meanwhile (e.g. a description edit re-sending a permission another
        // admin had just turned off).
        const base = { ...toValues(null), ...form.formState.defaultValues }
        const body: RolePatchInput = {}
        if (v.name.trim() !== base.name.trim()) body.name = v.name.trim()
        if (description !== (base.description?.trim() || null)) body.description = description
        if (!sameSet(v.permissions, (base.permissions ?? []).filter((p): p is Permission => !!p))) {
          body.permissions = v.permissions
        }
        const saved = Object.keys(body).length > 0 ? await update.mutateAsync({ id: role.id, ...body }) : role
        toast.success("Role saved.")
        form.reset(toValues(saved))
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "ROLE_NAME_TAKEN") {
        form.setError("name", { message: "Another role already has this name." })
      } else if (e instanceof ApiError && SHOW_AS_IS.has(e.code)) {
        toast.error(e.message)
      } else if (!applyServerErrors(e, form.setError, ["name", "description", "permissions"])) {
        toast.error(errorMessage(e))
      }
    }
  })

  const onDelete = () => {
    if (!role) return
    del.mutate(role.id, {
      onSuccess: () => {
        toast.success(`Role "${role.name}" deleted.`)
        setConfirmDelete(false)
        onDeleted()
      },
      onError: (e) => {
        setConfirmDelete(false)
        toast.error(e instanceof ApiError && SHOW_AS_IS.has(e.code) ? e.message : errorMessage(e))
      },
    })
  }

  const inUse = (role?.userCount ?? 0) > 0
  const isMyRole = !!role && me?.role.id === role.id
  // Why the role can't be deleted (the API answers ROLE_IS_DEFAULT / ROLE_IN_USE).
  const deleteBlockers = role
    ? [
        role.isDefault && "Make another role the default first.",
        inUse && `Move its ${plural(role.userCount, "account", "accounts")} to another role first.`,
      ].filter((r): r is string => !!r)
    : []
  // Who may change the default: roles.update, and only for a role holding nothing more than you (PERMISSION_ESCALATION).
  const canSetDefault = can("roles.update")
  const makeDefaultBlocker = !role
    ? null
    : !canGrantRole(role, can)
      ? "It has permissions you don't have, so you can't make it the default."
      : dirty
        ? "Save or discard your changes first."
        : null

  return (
    // overflow-visible: lets the Save bar stick to the bottom of the window while scrolling the permission tree.
    <Card className="overflow-visible">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <ShieldIcon className="size-5 text-muted-foreground" />
          {isNew ? "New role" : role.name}
          {isMyRole && (
            <Badge variant="outline">
              <UserRoundCheckIcon data-icon="inline-start" />
              Your role
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {isNew
            ? "Pick what people with this role can see and do."
            : `${plural(role.userCount, "account uses", "accounts use")} this role · ${plural(role.permissions.length, "permission", "permissions")}`}
        </CardDescription>
        {!isNew && can("roles.delete") && (
          <CardAction>
            {deleteBlockers.length > 0 ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  {/* pointer-events-none: a disabled button gets no hover, so the tooltip listens on the wrapper. */}
                  <Button variant="outline" size="sm" disabled className="pointer-events-none">
                    <Trash2Icon data-icon="inline-start" />
                    Delete
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="flex-col items-start gap-0.5">
                  {deleteBlockers.map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-(--card-spacing)">
        <CardContent className="flex flex-col gap-5">
          {!editable && (
            <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <EyeIcon className="size-4 shrink-0" />
              You can view this role but not change it.
            </p>
          )}
          {editable && isMyRole && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
              This is your own role: changes apply to you right away.
            </p>
          )}
          <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="role-name">Name</FieldLabel>
              <Input id="role-name" disabled={!editable} aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.description} className="sm:col-span-2 sm:row-start-2">
              <FieldLabel htmlFor="role-description">Description (optional)</FieldLabel>
              <Textarea
                id="role-description"
                rows={2}
                disabled={!editable}
                placeholder="What is this role for?"
                aria-invalid={!!errors.description}
                {...form.register("description")}
              />
              <FieldError errors={[errors.description]} />
            </Field>
          </FieldGroup>

          {isNew ? (
            canSetDefault && (
              <Field orientation="horizontal" className="rounded-lg border p-3">
                <Checkbox
                  id="role-default"
                  checked={createAsDefault}
                  onCheckedChange={setCreateAsDefault}
                  disabled={pending}
                />
                <FieldContent>
                  <FieldLabel htmlFor="role-default">Make this the default role</FieldLabel>
                  <FieldDescription>
                    New accounts will get this role
                    {defaultRole ? ` instead of "${defaultRole.name}"` : ""}.
                  </FieldDescription>
                </FieldContent>
              </Field>
            )
          ) : (
            <section
              aria-labelledby="role-default-title"
              className={cn(
                "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center",
                role.isDefault && "border-primary/30 bg-primary/5 dark:bg-primary/10",
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md",
                    role.isDefault ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  <UserPlusIcon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h3 id="role-default-title" className="text-sm font-medium">
                    Default role for new accounts
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {role.isDefault
                      ? `${DEFAULT_ROLE_HINT}.`
                      : defaultRole
                        ? `New accounts get "${defaultRole.name}".`
                        : "No default role is set, so a role has to be picked for every new account."}
                  </p>
                </div>
              </div>
              {role.isDefault ? (
                <Badge className="self-start bg-primary/10 text-primary sm:self-auto dark:bg-primary/20">
                  <StarIcon data-icon="inline-start" className="fill-current" />
                  Default
                </Badge>
              ) : (
                canSetDefault &&
                (makeDefaultBlocker ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex self-start sm:self-auto" />}>
                      <Button type="button" variant="outline" size="sm" disabled className="pointer-events-none">
                        <StarIcon data-icon="inline-start" />
                        Make default
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{makeDefaultBlocker}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start sm:self-auto"
                    disabled={makingDefault || pending}
                    onClick={() => onMakeDefault(role)}
                  >
                    {makingDefault ? <Spinner data-icon="inline-start" /> : <StarIcon data-icon="inline-start" />}
                    Make default
                  </Button>
                ))
              )}
            </section>
          )}

          <Separator />

          <section aria-labelledby="role-permissions" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="role-permissions" className="font-heading text-base font-medium">
                Permissions
              </h3>
              <span className="text-sm text-muted-foreground tabular-nums">
                {permissions.length} of {index.all.length} on
              </span>
            </div>
            {editable && (
              <FieldDescription>
                Turning one on also turns on what it needs. You can only give permissions you have yourself.
              </FieldDescription>
            )}
            <Controller
              control={form.control}
              name="permissions"
              render={({ field }) => (
                <PermissionEditor
                  index={index}
                  value={field.value}
                  onChange={field.onChange}
                  editable={editable && !pending}
                  canAdd={canAdd}
                />
              )}
            />
            <FieldError errors={[errors.permissions as { message?: string } | undefined]} />
          </section>
        </CardContent>

        {editable && (
          <CardFooter className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-card/95 py-3 backdrop-blur supports-backdrop-filter:bg-card/80">
            <span className="mr-auto text-sm text-muted-foreground" aria-live="polite">
              {dirty ? "Unsaved changes" : isNew ? "" : "All changes saved"}
            </span>
            {!isNew && (
              <Button type="button" variant="ghost" disabled={!dirty || pending} onClick={() => form.reset()}>
                <UndoIcon data-icon="inline-start" />
                Discard
              </Button>
            )}
            <Button type="submit" disabled={pending || (!isNew && !dirty)}>
              {pending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
              {isNew ? "Create role" : "Save changes"}
            </Button>
          </CardFooter>
        )}
      </form>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title="Discard unsaved changes?"
        description={`Your changes to ${isNew ? "the new role" : `"${role.name}"`} haven't been saved.`}
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => blocker.proceed?.()}
      />
      {role && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete the role "${role.name}"?`}
          description="This can't be undone."
          confirmLabel="Delete role"
          destructive
          pending={del.isPending}
          onConfirm={onDelete}
        />
      )}
    </Card>
  )
}
