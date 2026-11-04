import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { useLocation, useNavigate } from "react-router"
import { CheckIcon, KeyRoundIcon, ShieldIcon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { ErrorState } from "@/components/states"
import { AppearanceSettings } from "@/components/theme-settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useChangePassword } from "@/features/auth/api"
import { useAuth } from "@/features/auth/use-auth"
import { usePermissionCatalog } from "@/features/roles/api"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import { formatDate } from "@/lib/format"

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "At least 8 characters").max(72, "At most 72 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one",
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match" })
type Values = z.input<typeof schema>

/**
 * Profile settings (/account). An account still on the default password (`mustChangePassword`) is held here by
 * <RequireAuth> (/account?change-password=1) with a prominent alert above the password card until it changes it.
 */
export function AccountPage() {
  const { user } = useAuth()
  const forced = !!user?.mustChangePassword
  const change = useChangePassword()
  const navigate = useNavigate()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  })
  const { errors } = form.formState

  // "Change colors…" in the profile menu links to #colors: scroll there (also when already on this page).
  // A forced password change (?change-password=1) scrolls to the password card and focuses it.
  // "Profile settings" (no hash) goes back to the top.
  const location = useLocation()
  const colorsRef = useRef<HTMLDivElement>(null)
  const passwordRef = useRef<HTMLDivElement>(null)
  const toPassword = forced || new URLSearchParams(location.search).has("change-password")
  const { setFocus } = form
  useEffect(() => {
    if (toPassword) {
      passwordRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      setFocus("currentPassword")
    } else if (location.hash === "#colors") colorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    else window.scrollTo({ top: 0 })
  }, [location.hash, location.key, toPassword, setFocus])

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await change.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword })
      toast.success("Password changed.")
      form.reset()
      // Held here until now: go on to the home page (or just drop ?change-password=1).
      if (forced) void navigate("/", { replace: true })
      else if (location.search) void navigate("/account", { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === "WRONG_PASSWORD") {
        form.setError("currentPassword", { message: "Wrong password." }, { shouldFocus: true })
      } else if (!applyServerErrors(e, form.setError, ["currentPassword", "newPassword"])) {
        toast.error(errorMessage(e))
      }
    }
  })

  // While the default password must be changed, the password card comes first.
  const passwordSection = (
    <div ref={passwordRef} className="flex scroll-mt-20 flex-col gap-3">
      {forced && (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <KeyRoundIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Change the default password before you continue</p>
            <p className="text-sm">
              Enter the password you signed in with as the current password, then choose your own. The other pages
              open once it's changed.
            </p>
          </div>
        </div>
      )}
      <Card className={forced ? "ring-amber-500/50" : undefined}>
        <CardHeader>
          <CardTitle className="text-lg">Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup className="gap-4">
              {/* Lets password managers save the new password under the right account. */}
              {user && <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />}
              <Field data-invalid={!!errors.currentPassword}>
                <FieldLabel htmlFor="cur">Current password</FieldLabel>
                <Input id="cur" type="password" autoComplete="current-password" aria-invalid={!!errors.currentPassword} {...form.register("currentPassword")} />
                <FieldError errors={[errors.currentPassword]} />
              </Field>
              <Field data-invalid={!!errors.newPassword}>
                <FieldLabel htmlFor="new">New password</FieldLabel>
                <Input id="new" type="password" autoComplete="new-password" aria-invalid={!!errors.newPassword} {...form.register("newPassword")} />
                <FieldError errors={[errors.newPassword]} />
              </Field>
              <Field data-invalid={!!errors.confirmPassword}>
                <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
                <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} {...form.register("confirmPassword")} />
                <FieldError errors={[errors.confirmPassword]} />
              </Field>
              <Button type="submit" disabled={change.isPending} className="w-fit">
                {change.isPending && <Spinner data-icon="inline-start" />}
                {forced ? "Save and continue" : "Change password"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )

  return (
    <>
      <PageHeader title="Profile settings" />
      <div className="flex max-w-3xl flex-col gap-6">
        {forced && passwordSection}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{user?.name}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{user?.email}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-muted-foreground">Role</dt>
                <dd>
                  <Badge variant="secondary">
                    <ShieldIcon data-icon="inline-start" />
                    {user?.role.name}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-muted-foreground">Since</dt>
                <dd>{formatDate(user?.createdAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        {/* GET /permissions answers 403 PASSWORD_CHANGE_REQUIRED until the default password is changed. */}
        {!user?.mustChangePassword && <YourPermissionsCard />}
        <Card id="colors" ref={colorsRef} className="scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-lg">Light or dark, and colors</CardTitle>
            <CardDescription className="text-base">Changes show right away and are kept on this computer.</CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceSettings />
          </CardContent>
        </Card>
        {!forced && passwordSection}
      </div>
    </>
  )
}

/** Read-only list of what the signed-in user's role allows, grouped like the permission tree. */
function YourPermissionsCard() {
  const { user, can, permissions } = useAuth()
  const catalog = usePermissionCatalog()
  const groups = (catalog.data ?? [])
    .map((m) => ({ key: m.key, label: m.label, held: m.permissions.filter((p) => can(p.key)), total: m.permissions.length }))
    .filter((m) => m.held.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your permissions</CardTitle>
        <CardDescription className="text-base">
          What the {user?.role.name ?? ""} role lets you see and do. Ask someone who manages accounts if you need more.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {catalog.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-5 w-52" />
          </div>
        ) : catalog.isError ? (
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : permissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your role has no permissions yet.</p>
        ) : (
          <dl className="divide-y text-sm">
            {groups.map((m) => (
              <div key={m.key} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:gap-4">
                <dt className="flex shrink-0 items-baseline justify-between gap-2 font-medium sm:w-48 sm:justify-start">
                  {m.label}
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {m.held.length} / {m.total}
                  </span>
                </dt>
                <dd>
                  <ul className="flex flex-wrap gap-1.5">
                    {m.held.map((p) => (
                      <li key={p.key}>
                        <Badge variant="outline" title={p.description ?? undefined}>
                          <CheckIcon data-icon="inline-start" className="text-emerald-600 dark:text-emerald-400" />
                          {p.label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
