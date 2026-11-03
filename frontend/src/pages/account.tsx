import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { useLocation } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { AppearanceSettings } from "@/components/theme-settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useChangePassword } from "@/features/auth/api"
import { useAuth } from "@/features/auth/use-auth"
import { ApiError, errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import { formatDate } from "@/lib/format"

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "At least 8 characters").max(72, "At most 72 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match" })
type Values = z.input<typeof schema>

export function AccountPage() {
  const { user } = useAuth()
  const change = useChangePassword()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  })
  const { errors } = form.formState

  // "Change colors…" in the profile menu links to #colors: scroll there (also when already on this page).
  // "Profile settings" (no hash) goes back to the top.
  const location = useLocation()
  const colorsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (location.hash === "#colors") colorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    else window.scrollTo({ top: 0 })
  }, [location.hash, location.key])

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await change.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword })
      toast.success("Password changed.")
      form.reset()
    } catch (e) {
      if (e instanceof ApiError && e.code === "WRONG_PASSWORD") {
        form.setError("currentPassword", { message: "Wrong password." })
      } else if (!applyServerErrors(e, form.setError, ["currentPassword", "newPassword"])) {
        toast.error(errorMessage(e))
      }
    }
  })

  return (
    <>
      <PageHeader title="Profile settings" />
      <div className="flex max-w-3xl flex-col gap-6">
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
                  <Badge variant={user?.role === "ADMIN" ? "default" : "secondary"}>{user?.role === "ADMIN" ? "Admin" : "Staff"}</Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-muted-foreground">Since</dt>
                <dd>{formatDate(user?.createdAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card id="colors" ref={colorsRef} className="scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-lg">Light or dark, and colors</CardTitle>
            <CardDescription className="text-base">Changes show right away and are kept on this computer.</CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceSettings />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup className="gap-4">
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
                  Change password
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
