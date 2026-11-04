import { useRef, useState, type ChangeEvent } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useWatch } from "react-hook-form"
import { ImageIcon, ImageUpIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { BrandMark } from "@/components/brand"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { PageHeader } from "@/components/page-header"
import { ErrorState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { NotAPictureError } from "@/features/books/cover-image"
import {
  useCompanyProfile,
  useRemoveCompanyLogo,
  useSetCompanyLogo,
  useUpdateCompanyProfile,
} from "@/features/company/api"
import { companyContacts } from "@/features/company/contacts"
import { prepareLogo, type PreparedLogo } from "@/features/company/logo-image"
import { errorMessage } from "@/lib/api"
import { applyServerErrors } from "@/lib/form-errors"
import type { CompanyProfile, CompanyProfileInput } from "@/types/api"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const schema = z.object({
  name: z.string().trim().min(1, "Enter the name").max(120, "At most 120 characters"),
  tagline: z.string().trim().max(200, "At most 200 characters"),
  address: z.string().trim().max(300, "At most 300 characters"),
  contactEmail: z
    .string()
    .trim()
    .max(254, "At most 254 characters")
    .refine((s) => s === "" || EMAIL.test(s), "Enter a valid email, e.g. library@example.com"),
  contactPhone: z.string().trim().max(60, "At most 60 characters"),
})
type Values = z.input<typeof schema>
const KNOWN = ["name", "tagline", "address", "contactEmail", "contactPhone"] as const

const toValues = (p: CompanyProfile): Values => ({
  name: p.name,
  tagline: p.tagline ?? "",
  address: p.address ?? "",
  contactEmail: p.contactEmail ?? "",
  contactPhone: p.contactPhone ?? "",
})

/** Company Profile (company.update): the name, logo and contact details shown on every page and in emails. */
export function CompanyProfilePage() {
  const profile = useCompanyProfile()

  return (
    <>
      <PageHeader
        title="Company Profile"
        description="The name, logo and contact details shown on the sign-in page, on every page and in the emails to borrowers."
      />
      {/* The copy remembered from an earlier visit isn't edited: wait for the saved profile. */}
      {profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : !profile.data || profile.isPlaceholderData ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <CompanyProfileEditor profile={profile.data} />
      )}
    </>
  )
}

function CompanyProfileEditor({ profile }: { profile: CompanyProfile }) {
  const update = useUpdateCompanyProfile()
  const [pendingLogo, setPendingLogo] = useState<PreparedLogo | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(profile) })
  const { errors, isDirty } = form.formState
  const watched = useWatch({ control: form.control })

  const onSubmit = form.handleSubmit(async (v) => {
    const t = (s: string) => (s.trim() === "" ? null : s.trim())
    const body: CompanyProfileInput = {
      name: v.name.trim(),
      tagline: t(v.tagline),
      address: t(v.address),
      contactEmail: t(v.contactEmail)?.toLowerCase() ?? null,
      contactPhone: t(v.contactPhone),
    }
    try {
      const saved = await update.mutateAsync(body)
      form.reset(toValues(saved))
      toast.success("Company profile saved.")
    } catch (error) {
      if (!applyServerErrors(error, form.setError, KNOWN)) toast.error(errorMessage(error))
    }
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        <LogoCard profile={profile} pendingLogo={pendingLogo} onPendingLogo={setPendingLogo} />

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Contact details are shown at the bottom of the public pages and in emails.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup className="gap-4">
                <Field data-invalid={!!errors.name}>
                  <FieldLabel htmlFor="company-name">Name</FieldLabel>
                  <Input id="company-name" maxLength={120} aria-invalid={!!errors.name} {...form.register("name")} />
                  <FieldDescription>Shown in the menu, on the sign-in page, in the browser tab and in emails.</FieldDescription>
                  <FieldError errors={[errors.name]} />
                </Field>
                <Field data-invalid={!!errors.tagline}>
                  <FieldLabel htmlFor="company-tagline">Tagline (optional)</FieldLabel>
                  <Input
                    id="company-tagline"
                    maxLength={200}
                    placeholder="e.g. Serving our students since 1985"
                    aria-invalid={!!errors.tagline}
                    {...form.register("tagline")}
                  />
                  <FieldError errors={[errors.tagline]} />
                </Field>
                <Field data-invalid={!!errors.address}>
                  <FieldLabel htmlFor="company-address">Address (optional)</FieldLabel>
                  <Textarea id="company-address" rows={2} maxLength={300} aria-invalid={!!errors.address} {...form.register("address")} />
                  <FieldError errors={[errors.address]} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={!!errors.contactEmail}>
                    <FieldLabel htmlFor="company-email">Contact email (optional)</FieldLabel>
                    <Input
                      id="company-email"
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-invalid={!!errors.contactEmail}
                      {...form.register("contactEmail")}
                    />
                    <FieldError errors={[errors.contactEmail]} />
                  </Field>
                  <Field data-invalid={!!errors.contactPhone}>
                    <FieldLabel htmlFor="company-phone">Contact phone (optional)</FieldLabel>
                    <Input id="company-phone" type="tel" maxLength={60} aria-invalid={!!errors.contactPhone} {...form.register("contactPhone")} />
                    <FieldError errors={[errors.contactPhone]} />
                  </Field>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  {isDirty && (
                    <Button type="button" variant="ghost" disabled={update.isPending} onClick={() => form.reset()}>
                      Undo changes
                    </Button>
                  )}
                  <Button type="submit" disabled={update.isPending || !isDirty}>
                    {update.isPending && <Spinner data-icon="inline-start" />}
                    Save details
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>

      <BrandPreview
        name={watched.name?.trim() || profile.name}
        tagline={watched.tagline?.trim() || null}
        address={watched.address?.trim() || null}
        email={watched.contactEmail?.trim() || null}
        phone={watched.contactPhone?.trim() || null}
        logo={pendingLogo ? pendingLogo.dataUrl : undefined}
      />
    </div>
  )
}

function LogoCard({
  profile,
  pendingLogo,
  onPendingLogo,
}: {
  profile: CompanyProfile
  pendingLogo: PreparedLogo | null
  onPendingLogo: (logo: PreparedLogo | null) => void
}) {
  const setLogo = useSetCompanyLogo()
  const removeLogo = useRemoveCompanyLogo()
  const [preparing, setPreparing] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chooseButtonRef = useRef<HTMLButtonElement>(null)
  // Counts the files chosen, so a slow picture that is still being shrunk can't replace one chosen after it.
  const requestRef = useRef(0)
  const busy = preparing || setLogo.isPending || removeLogo.isPending
  const preview = pendingLogo?.dataUrl ?? profile.logoUrl

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared so choosing the same file again still counts as a choice.
    e.target.value = ""
    if (!file) return
    const request = ++requestRef.current
    setLogoError(null)
    setPreparing(true)
    try {
      const logo = await prepareLogo(file)
      if (request === requestRef.current) onPendingLogo(logo)
    } catch (error) {
      if (request === requestRef.current) setLogoError(error instanceof NotAPictureError ? error.message : errorMessage(error))
    } finally {
      if (request === requestRef.current) setPreparing(false)
    }
  }

  const save = async () => {
    if (!pendingLogo) return
    try {
      await setLogo.mutateAsync({ mimeType: pendingLogo.mimeType, data: pendingLogo.data })
      onPendingLogo(null)
      toast.success("Logo saved.")
    } catch (error) {
      setLogoError(errorMessage(error))
    }
  }

  const cancel = () => {
    requestRef.current++
    setPreparing(false)
    setLogoError(null)
    onPendingLogo(null)
    chooseButtonRef.current?.focus()
  }

  const remove = async () => {
    try {
      await removeLogo.mutateAsync()
      setConfirmRemove(false)
      toast.success("Logo removed.")
      chooseButtonRef.current?.focus()
    } catch (error) {
      setConfirmRemove(false)
      setLogoError(errorMessage(error))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>PNG, JPG, WebP or SVG. A square logo with a see-through background looks best.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {preview ? (
            <div className="flex shrink-0 items-center gap-3">
              {/* Light and dark backgrounds, to check that the logo reads on both. */}
              <div className="flex size-28 items-center justify-center rounded-xl border bg-white p-3">
                <BrandMark size="lg" src={preview} className="size-full rounded-lg" />
              </div>
              <div className="flex size-28 items-center justify-center rounded-xl border bg-neutral-900 p-3">
                <BrandMark size="lg" src={preview} className="size-full rounded-lg" decorative />
              </div>
            </div>
          ) : (
            <div className="flex size-28 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 text-xs text-muted-foreground">
              <BrandMark size="md" src={null} decorative />
              No logo yet
            </div>
          )}
          <div className="flex flex-col gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              hidden
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void onFileChosen(e)}
            />
            {pendingLogo ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy} onClick={() => void save()}>
                  {setLogo.isPending && <Spinner data-icon="inline-start" />}
                  Save logo
                </Button>
                <Button type="button" variant="ghost" disabled={setLogo.isPending} onClick={cancel}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={chooseButtonRef}
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-describedby={logoError ? "logo-error" : undefined}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {profile.logoUrl ? <ImageUpIcon data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
                  {profile.logoUrl ? "Change logo" : "Upload logo"}
                </Button>
                {profile.logoUrl && (
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>
                    <Trash2Icon data-icon="inline-start" />
                    Remove
                  </Button>
                )}
              </div>
            )}
            <div aria-live="polite" className="text-sm">
              {preparing && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-4" aria-hidden role={undefined} />
                  Getting the picture ready…
                </p>
              )}
              {pendingLogo && !preparing && <p className="text-muted-foreground">Preview only — save to use this logo.</p>}
              {logoError && (
                <p id="logo-error" role="alert" className="text-destructive">
                  {logoError}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the logo?"
        description="The library icon is shown instead until you upload a new logo."
        confirmLabel="Remove logo"
        destructive
        pending={removeLogo.isPending}
        onConfirm={() => void remove()}
      />
    </Card>
  )
}

/** How the brand looks on the sign-in page and the public pages, with the unsaved changes. */
function BrandPreview({
  name,
  tagline,
  address,
  email,
  phone,
  logo,
}: {
  name: string
  tagline: string | null
  address: string | null
  email: string | null
  phone: string | null
  /** A new logo not saved yet (undefined: the saved one). */
  logo?: string
}) {
  const contacts = companyContacts({ address, contactPhone: phone, contactEmail: email })

  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardDescription>Sign-in page and public pages.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative overflow-hidden rounded-xl bg-primary p-4 text-primary-foreground">
          <div aria-hidden className="pointer-events-none absolute -top-12 -right-10 size-40 rounded-full bg-primary-foreground/10 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="shrink-0 rounded-xl bg-background p-1 shadow-sm">
              <BrandMark size="md" src={logo} decorative />
            </div>
            <div className="min-w-0">
              <p className="font-heading font-semibold break-words">{name}</p>
              {tagline && <p className="text-xs break-words text-primary-foreground/80">{tagline}</p>}
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2 border-b bg-background px-3 py-2">
            <BrandMark size="sm" src={logo} decorative className="size-6" />
            <span className="truncate text-sm font-semibold">{name}</span>
          </div>
          <div className="flex flex-col gap-1 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{name}</span>
            {contacts.length > 0 ? (
              contacts.map((c) => (
                <span key={c.key} className="flex items-start gap-1.5 break-words [&_svg]:mt-0.5 [&_svg]:size-3 [&_svg]:shrink-0">
                  {c.icon}
                  {c.text}
                </span>
              ))
            ) : (
              <span>No contact details yet.</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
