import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Navigate, useNavigate, useSearchParams } from "react-router"
import { LibraryIcon } from "lucide-react"
import { z } from "zod"

import { FullScreenSpinner } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useLogin } from "@/features/auth/api"
import { useAuth } from "@/features/auth/use-auth"
import { errorMessage } from "@/lib/api"
import { safeNextPath } from "@/lib/format"

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email"),
  password: z.string().min(1, "Enter your password"),
})
type Values = z.input<typeof schema>

export function LoginPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNextPath(params.get("next"))
  const login = useLogin()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } })

  if (auth.status === "loading") return <FullScreenSpinner />
  if (auth.status === "authenticated") return <Navigate to={next} replace />

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(
      { email: values.email.trim(), password: values.password },
      {
        onSuccess: () => void navigate(next, { replace: true }),
        onError: () => form.setValue("password", ""),
      },
    )
  })

  const { errors } = form.formState

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LibraryIcon className="size-5" />
          </div>
          <CardTitle className="text-lg">Library System</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              {login.isError && (
                <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {errorMessage(login.error)}
                </div>
              )}
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  aria-invalid={!!errors.email}
                  {...form.register("email")}
                />
                <FieldError errors={[errors.email]} />
              </Field>
              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  {...form.register("password")}
                />
                <FieldError errors={[errors.password]} />
              </Field>
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending && <Spinner data-icon="inline-start" />}
                Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
