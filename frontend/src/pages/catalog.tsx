import { Link, Navigate, useSearchParams } from "react-router"
import { ArrowRightIcon, CalendarDaysIcon, LibraryIcon, MapPinIcon } from "lucide-react"

import { PublicShell } from "@/components/public-shell"
import { EmptyState, ErrorState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useCompany } from "@/features/company/api"
import { PublicHeaderActions } from "@/features/public/header-actions"
import { usePublicLibraries } from "@/features/public/api"
import { plural } from "@/lib/format"
import type { PublicLibrarySummary } from "@/types/api"

type Purpose = "borrow" | "status"

const COPY: Record<Purpose, { title: string; heading: string; intro: string; action: string }> = {
  borrow: {
    title: "Available books",
    heading: "Choose a library",
    intro: "Pick a library to see its books and ask to borrow them.",
    action: "See books",
  },
  status: {
    title: "Check a request",
    heading: "Which library did you send it to?",
    intro: "Pick the library, then enter your request number (e.g. BR-000123).",
    action: "Check a request",
  },
}

/** /catalog: the public book catalog. One library goes straight to its books; several are listed to choose from. */
export function CatalogPage() {
  return <LibraryChooser purpose="borrow" />
}

/** /catalog/status: "Check a request" from the sign-in page, which doesn't know the library yet. */
export function CheckRequestPage() {
  return <LibraryChooser purpose="status" />
}

function libraryPath(purpose: Purpose, slug: string, search: string) {
  const base = `/borrow/${encodeURIComponent(slug)}`
  return purpose === "status" ? `${base}/status${search}` : base
}

function LibraryChooser({ purpose }: { purpose: Purpose }) {
  const libraries = usePublicLibraries()
  const company = useCompany()
  // A request number in the link (?ref=BR-000123) is passed on to the status page.
  const [searchParams] = useSearchParams()
  const search = searchParams.toString() ? `?${searchParams.toString()}` : ""
  const copy = COPY[purpose]
  const list = libraries.data?.data

  if (list?.length === 1) return <Navigate to={libraryPath(purpose, list[0]!.slug, search)} replace />

  return (
    <PublicShell title={copy.title} actions={<PublicHeaderActions />}>
      {libraries.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : libraries.isError ? (
        <ErrorState
          className="bg-background"
          title={`Can't reach ${company.name}`}
          error={libraries.error}
          onRetry={() => void libraries.refetch()}
        />
      ) : list!.length === 0 ? (
        <EmptyState
          className="bg-background py-12"
          icon={<LibraryIcon />}
          title="No books to borrow online right now"
          description="The library isn't taking requests online at the moment. Please ask the library staff."
          action={
            <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/login" />}>
              Back to sign in
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{copy.heading}</h1>
            <p className="text-sm text-muted-foreground">{copy.intro}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {list!.map((library) => (
              <li key={library.slug}>
                <LibraryCard library={library} to={libraryPath(purpose, library.slug, search)} action={copy.action} />
              </li>
            ))}
          </ul>
        </>
      )}
    </PublicShell>
  )
}

function LibraryCard({ library, to, action }: { library: PublicLibrarySummary; to: string; action: string }) {
  return (
    <Link
      to={to}
      className="group flex h-full flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <LibraryIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base font-semibold break-words">{library.name}</p>
          {library.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{library.description}</p>}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {library.location && (
          <span className="flex items-center gap-1">
            <MapPinIcon className="size-3.5" />
            {library.location}
          </span>
        )}
        <span className="flex items-center gap-1">
          <CalendarDaysIcon className="size-3.5" />
          Borrow for {plural(library.defaultLoanDays, "day")}
        </span>
        <span className="ml-auto flex items-center gap-1 font-medium text-primary">
          {action}
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}
