import { useState, type KeyboardEvent } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router"
import {
  ArrowRightIcon,
  ArrowUpIcon,
  BookOpenIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  MailCheckIcon,
  MailIcon,
  SearchIcon,
  SendIcon,
  TicketIcon,
} from "lucide-react"
import { cn } from "cn"
import { z } from "zod"

import { BrandMark } from "@/components/brand"
import { FullScreenSpinner } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { useLogin } from "@/features/auth/api"
import { useAuth } from "@/features/auth/use-auth"
import { useCompany } from "@/features/company/api"
import { companyContacts } from "@/features/company/contacts"
import { useDocumentTitle } from "@/features/company/use-document-title"
import { errorMessage } from "@/lib/api"
import { safeNextPath } from "@/lib/format"

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email"),
  password: z.string().min(1, "Enter your password"),
})
type Values = z.input<typeof schema>

const STEPS = [
  { icon: <SearchIcon />, title: "Browse the books", text: "See which books are on the shelf right now." },
  { icon: <SendIcon />, title: "Send a request", text: "Pick the books you want and leave your email." },
  { icon: <MailCheckIcon />, title: "Get an email", text: "We'll tell you when the library accepts it, with your sign-in details." },
]

export function LoginPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNextPath(params.get("next"))
  const login = useLogin()
  const company = useCompany()
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } })
  useDocumentTitle("Sign in")

  if (auth.status === "loading") return <FullScreenSpinner />
  // An account still on the default password is sent on to Profile settings by <RequireAuth>.
  if (auth.status === "authenticated") return <Navigate to={next} replace />

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(
      { email: values.email.trim(), password: values.password },
      {
        onSuccess: () => void navigate(next, { replace: true }),
        onError: () => {
          form.setValue("password", "")
          form.setFocus("password")
        },
      },
    )
  })

  // Caps Lock is only known from a key event; checked on every key in the password box.
  const trackCapsLock = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"))

  const { errors } = form.formState
  const passwordField = form.register("password")

  return (
    <div className="grid min-h-svh bg-muted/40 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:bg-background">
      {/* Brand panel (large screens) */}
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col">
        <Decoration />
        <div className="relative flex flex-1 flex-col justify-between gap-10 p-10 xl:p-14">
          <div className="flex items-center gap-4">
            <LogoTile />
            <div className="min-w-0">
              <p className="font-heading text-2xl font-semibold tracking-tight break-words">{company.name}</p>
              {company.tagline && <p className="mt-0.5 text-sm text-primary-foreground/80">{company.tagline}</p>}
            </div>
          </div>

          <div className="flex max-w-lg flex-col gap-8">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium tracking-wide text-primary-foreground/70 uppercase">Borrow books online</p>
              <h1 className="font-heading text-4xl leading-tight font-semibold tracking-tight text-balance xl:text-5xl">
                Find a book and ask to borrow it, from anywhere.
              </h1>
            </div>
            <ol className="flex flex-col gap-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 ring-1 ring-primary-foreground/20 [&_svg]:size-4">
                    {step.icon}
                  </span>
                  <span className="text-sm leading-snug">
                    <span className="block font-medium">
                      {i + 1}. {step.title}
                    </span>
                    <span className="text-primary-foreground/75">{step.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                nativeButton={false}
                className="h-11 gap-2 bg-background px-5 text-base text-foreground shadow-sm hover:bg-background/90"
                render={<Link to="/catalog" />}
              >
                <BookOpenIcon data-icon="inline-start" className="size-5" />
                Browse available books
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Link
                to="/catalog/status"
                className="inline-flex items-center gap-1.5 rounded-md px-1 text-sm font-medium text-primary-foreground/90 underline-offset-4 hover:text-primary-foreground hover:underline focus-visible:ring-3 focus-visible:ring-primary-foreground/40 focus-visible:outline-none"
              >
                <TicketIcon className="size-4" />
                Check a request
              </Link>
            </div>
          </div>

          <CompanyContacts />
        </div>
      </aside>

      {/* Sign-in side */}
      <main className="flex flex-col items-center justify-center gap-6 px-4 py-8 sm:py-12">
        {/* Small screens: brand + the catalog link come before the form, so visitors see it without scrolling. */}
        <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center lg:hidden">
          <LogoTile size="md" />
          <div>
            <p className="font-heading text-xl font-semibold tracking-tight break-words">{company.name}</p>
            {company.tagline && <p className="text-sm text-muted-foreground">{company.tagline}</p>}
          </div>
          <Link
            to="/catalog"
            className="group mt-1 flex w-full items-center gap-3 rounded-xl bg-primary p-3 text-left text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15">
              <BookOpenIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Browse available books</span>
              <span className="block text-xs text-primary-foreground/80">Ask to borrow them online, no account needed.</span>
            </span>
            <ArrowRightIcon className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <Card className="w-full max-w-sm shadow-sm lg:shadow-none lg:ring-0">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Sign in</CardTitle>
            <CardDescription>Sign in with your account's email and password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup className="gap-4">
                {login.isError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {errorMessage(login.error)}
                  </div>
                )}
                <Field data-invalid={!!errors.email}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <InputGroup className="h-10">
                    <InputGroupAddon>
                      <MailIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      placeholder="you@example.com"
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "email-error" : undefined}
                      {...form.register("email")}
                    />
                  </InputGroup>
                  <FieldError id="email-error" errors={[errors.email]} />
                </Field>
                <Field data-invalid={!!errors.password}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <InputGroup className="h-10">
                    <InputGroupInput
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      aria-invalid={!!errors.password}
                      aria-describedby={
                        [errors.password && "password-error", capsLock && "caps-lock-hint"].filter(Boolean).join(" ") || undefined
                      }
                      {...passwordField}
                      onKeyDown={trackCapsLock}
                      onKeyUp={trackCapsLock}
                      onBlur={(e) => {
                        setCapsLock(false)
                        void passwordField.onBlur(e)
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label="Show password"
                        aria-pressed={showPassword}
                        aria-controls="password"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  {capsLock && (
                    <FieldDescription id="caps-lock-hint" className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                      <ArrowUpIcon className="size-3.5" aria-hidden />
                      Caps Lock is on.
                    </FieldDescription>
                  )}
                  <FieldError id="password-error" errors={[errors.password]} />
                </Field>
                <Button type="submit" size="lg" className="h-10 w-full text-base" disabled={login.isPending}>
                  {login.isPending && <Spinner data-icon="inline-start" />}
                  Sign in
                </Button>
              </FieldGroup>
            </form>

            <div className="mt-5 flex gap-2.5 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <span className="font-medium text-foreground">Request accepted?</span> Sign in with the email from your
                request. Your first password is in the email we sent when your request was accepted.
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground lg:hidden">
          <Link to="/catalog/status" className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline">
            <TicketIcon className="size-4" />
            Check a request
          </Link>
        </p>
        <div className="w-full max-w-sm lg:hidden">
          <CompanyContacts className="text-muted-foreground" />
        </div>
      </main>
    </div>
  )
}

/** The logo on a light tile, so it stays visible on the main-color panel (and a see-through logo keeps its look). */
function LogoTile({ size = "lg" }: { size?: "md" | "lg" }) {
  return (
    <div className="shrink-0 rounded-2xl bg-background p-1.5 shadow-sm ring-1 ring-foreground/10">
      <BrandMark size={size} decorative />
    </div>
  )
}

function CompanyContacts({ className }: { className?: string }) {
  const items = companyContacts(useCompany())
  if (items.length === 0) return null
  return (
    <ul className={cn("flex flex-col gap-1.5 text-sm", className ?? "text-primary-foreground/80")}>
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
          {item.icon}
          <span className="min-w-0 break-words">{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** Soft shapes behind the brand panel; drawn in the main color's text color so they suit any main color. */
function Decoration() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-32 -right-24 size-96 rounded-full bg-primary-foreground/10 blur-3xl" />
      <div className="absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-primary-foreground/10 blur-3xl" />
      <BookOpenIcon className="absolute -right-10 -bottom-10 size-72 rotate-[-12deg] text-primary-foreground/5" strokeWidth={1} />
    </div>
  )
}
