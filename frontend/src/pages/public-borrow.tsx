import { useState } from "react"
import { Link, useParams } from "react-router"
import { BookXIcon, CheckCircle2Icon, MapPinIcon, SearchIcon } from "lucide-react"

import { CopyButton } from "@/components/copy-button"
import { PublicShell } from "@/components/public-shell"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { BorrowForm } from "@/features/loans/borrow-form"
import { usePublicLibrary } from "@/features/public/api"
import { ApiError } from "@/lib/api"
import type { PublicRequestResult } from "@/types/api"

export function NotAvailable({ what = "This borrow form" }: { what?: string }) {
  return (
    <PublicShell>
      <EmptyState
        className="bg-background py-12"
        icon={<BookXIcon />}
        title={`${what} isn't available`}
        description="Please ask the library staff."
      />
    </PublicShell>
  )
}

function SuccessScreen({ result, slug, onAnother }: { result: PublicRequestResult; slug: string; onAnother: () => void }) {
  return (
    <Card>
      <CardHeader className="text-center">
        <CheckCircle2Icon className="mx-auto size-10 text-emerald-600" />
        <CardTitle className="text-lg">Request sent</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 text-center">
        <div>
          <p className="text-sm text-muted-foreground">Your request number</p>
          <p className="font-mono text-3xl font-bold tracking-wider" aria-live="polite">
            {result.loanNumber}
          </p>
        </div>
        <CopyButton text={result.loanNumber} label="Copy number" />
        <p className="max-w-md text-sm font-semibold">Show this number at the library.</p>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to={`/borrow/${encodeURIComponent(slug)}/status?ref=${encodeURIComponent(result.loanNumber)}`} />}
        >
          <SearchIcon data-icon="inline-start" />
          Check request status
        </Button>
        <Button variant="ghost" onClick={onAnother}>
          Make another request
        </Button>
      </CardFooter>
    </Card>
  )
}

export function PublicBorrowPage() {
  const { slug = "" } = useParams()
  const info = usePublicLibrary(slug)
  const [result, setResult] = useState<PublicRequestResult | null>(null)
  const [formKey, setFormKey] = useState(0)

  if (info.isPending)
    return (
      <PublicShell>
        <PageSkeleton />
      </PublicShell>
    )
  if (info.isError) {
    if (info.error instanceof ApiError && info.error.status === 404) return <NotAvailable />
    return (
      <PublicShell>
        <ErrorState error={info.error} onRetry={() => void info.refetch()} />
      </PublicShell>
    )
  }

  const { library, categories } = info.data
  return (
    <PublicShell title={library.name}>
      {result ? (
        <SuccessScreen
          result={result}
          slug={slug}
          onAnother={() => {
            setResult(null)
            setFormKey((k) => k + 1)
            window.scrollTo({ top: 0 })
          }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold">Borrow books</h1>
            {library.description && <p className="text-sm text-muted-foreground">{library.description}</p>}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {library.location && (
                <span className="flex items-center gap-1">
                  <MapPinIcon className="size-3.5" />
                  {library.location}
                </span>
              )}
              <span>Borrow for {library.defaultLoanDays} days</span>
              <Link to={`/borrow/${encodeURIComponent(slug)}/status`} className="underline underline-offset-4 hover:text-foreground">
                Check request status
              </Link>
            </p>
          </div>
          <BorrowForm
            key={formKey}
            mode="public"
            slug={slug}
            categories={categories}
            onSubmitted={(r) => {
              setResult(r)
              window.scrollTo({ top: 0 })
            }}
          />
        </>
      )}
    </PublicShell>
  )
}
