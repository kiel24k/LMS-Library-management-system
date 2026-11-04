import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookMarkedIcon,
  BookXIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  MailCheckIcon,
  MapPinIcon,
  SearchIcon,
  SendIcon,
  ShoppingBasketIcon,
  TicketIcon,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { CopyButton } from "@/components/copy-button"
import { PublicShell } from "@/components/public-shell"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/features/auth/use-auth"
import { lineIssuesFromError } from "@/features/loans/loan-errors"
import { useSubmitMyRequest } from "@/features/my-books/api"
import { BookCatalog } from "@/features/public/book-catalog"
import { usePublicLibrary } from "@/features/public/api"
import { PublicHeaderActions } from "@/features/public/header-actions"
import { RequestForm } from "@/features/public/request-form"
import { RequestList } from "@/features/public/request-list"
import { lineFromBook, REQUEST_LIMITS, totalCopies, type RequestLine } from "@/features/public/request-lines"
import { ApiError, errorMessage } from "@/lib/api"
import { plural } from "@/lib/format"
import type { PublicBook, PublicLibraryInfo, PublicRequestResult } from "@/types/api"

export function NotAvailable({ what = "This borrow form" }: { what?: string }) {
  return (
    <PublicShell actions={<PublicHeaderActions />}>
      <EmptyState
        className="bg-background py-12"
        icon={<BookXIcon />}
        title={`${what} isn't available`}
        description="Please ask the library staff."
        action={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/catalog" />}>
            See available books
          </Button>
        }
      />
    </PublicShell>
  )
}

const statusPath = (slug: string, ref?: string) =>
  `/borrow/${encodeURIComponent(slug)}/status${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`

function SuccessScreen({
  result,
  email,
  slug,
  onAnother,
  signedIn,
}: {
  result: PublicRequestResult
  /** Where the answer is emailed; null when the borrower has no email (then only My Books shows it). */
  email: string | null
  slug: string
  onAnother: () => void
  /** Sent from a signed-in account: lead back to My Books, where the request now shows. */
  signedIn?: boolean
}) {
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader className="items-center text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
          <CheckCircle2Icon className="size-8" />
        </span>
        <CardTitle className="mt-2 text-xl font-semibold">Request sent</CardTitle>
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
        <div className="flex max-w-md items-start gap-3 rounded-lg bg-muted/60 p-3 text-left text-sm">
          <MailCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          {email ? (
            <p>
              We'll email <span className="font-medium break-all">{email}</span> when the library accepts or declines your
              request.
            </p>
          ) : (
            <p>Check My Books for the library's answer.</p>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {signedIn ? (
          <Button nativeButton={false} render={<Link to="/my-books" />}>
            <BookMarkedIcon data-icon="inline-start" />
            Go to My Books
          </Button>
        ) : (
          <Button variant="outline" nativeButton={false} render={<Link to={statusPath(slug, result.loanNumber)} />}>
            <SearchIcon data-icon="inline-start" />
            Check request status
          </Button>
        )}
        <Button variant="ghost" onClick={onAnother}>
          Borrow more books
        </Button>
      </CardFooter>
    </Card>
  )
}

// The request list survives a reload of the page (but not closing the tab).
const draftKey = (slug: string) => `lms-request:${slug}`

function readDraft(slug: string): RequestLine[] {
  try {
    const raw = window.sessionStorage.getItem(draftKey(slug))
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(v) ? (v as RequestLine[]).filter((l) => typeof l?.bookId === "string" && typeof l.title === "string") : []
  } catch {
    return []
  }
}

function writeDraft(slug: string, lines: RequestLine[]) {
  try {
    if (lines.length === 0) window.sessionStorage.removeItem(draftKey(slug))
    else window.sessionStorage.setItem(draftKey(slug), JSON.stringify(lines))
  } catch {
    // Storage blocked: the list just isn't kept over a reload.
  }
}

export function PublicBorrowPage() {
  const { slug = "" } = useParams()
  const info = usePublicLibrary(slug)

  if (info.isPending)
    return (
      <PublicShell width="wide" actions={<PublicHeaderActions />}>
        <PageSkeleton />
      </PublicShell>
    )
  if (info.isError) {
    if (info.error instanceof ApiError && info.error.status === 404) return <NotAvailable />
    return (
      <PublicShell actions={<PublicHeaderActions />}>
        <ErrorState className="bg-background" error={info.error} onRetry={() => void info.refetch()} />
      </PublicShell>
    )
  }
  return <BorrowFlow key={slug} slug={slug} info={info.data} />
}

/** Choose books in the catalog → "Your details" → sent. The details step is in the URL (?step=details) so Back works. */
function BorrowFlow({ slug, info }: { slug: string; info: PublicLibraryInfo }) {
  const { library, categories } = info
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [lines, setLines] = useState<RequestLine[]>(() => readDraft(slug))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [sent, setSent] = useState<{ result: PublicRequestResult; email: string | null } | null>(null)
  // True when "Continue" added the history entry, so "Back to books" can simply go back to it.
  const pushedDetails = useRef(false)
  // Signed in and linked to a borrower: the library already knows who they are, so there is no "Your details" step —
  // the request is sent straight from the book list (POST /me/requests). An account that still has to change its
  // default password can't use the API yet, so it gets the normal public form.
  const auth = useAuth()
  const me =
    auth.status === "authenticated" && auth.can("my_books.view") && auth.user.borrower && !auth.user.mustChangePassword
      ? auth.user
      : null
  const sendMine = useSubmitMyRequest()
  const [sendError, setSendError] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const step = !me && searchParams.get("step") === "details" && lines.length > 0 ? "details" : "browse"

  useEffect(() => writeDraft(slug, lines), [slug, lines])

  const updateLines = (next: RequestLine[]) => {
    setLines(next)
    setSendError(null)
    // A problem the server reported stays on its book until that book is changed or removed.
    setIssues((prev) => {
      const kept: Record<string, string> = {}
      for (const [bookId, message] of Object.entries(prev)) {
        const before = lines.find((l) => l.bookId === bookId)
        const after = next.find((l) => l.bookId === bookId)
        if (before && after && before.quantity === after.quantity) kept[bookId] = message
      }
      return kept
    })
  }

  const selected = new Set(lines.map((l) => l.bookId))
  const full = lines.length >= REQUEST_LIMITS.maxBooks
  const toggleBook = (book: PublicBook) => {
    // While a signed-in request is being sent the list is frozen (it is cleared once the request is saved).
    if (sendMine.isPending) return
    if (selected.has(book.id)) updateLines(lines.filter((l) => l.bookId !== book.id))
    else if (!full) updateLines([...lines, lineFromBook(book)])
  }

  const sendNow = () => {
    if (!me || lines.length === 0 || sendMine.isPending) return
    setSendError(null)
    setIssues({})
    sendMine.mutate(
      { slug, items: lines.map((l) => ({ bookId: l.bookId, quantity: l.quantity })), notes: notes.trim() || undefined },
      {
        onSuccess: (result) => {
          toast.dismiss()
          // The answer goes to the borrower's email; without one there is no email to promise.
          setSent({ result, email: result.email })
          setLines([])
          setNotes("")
          if (searchParams.has("step")) setSearchParams({}, { replace: true })
          window.scrollTo({ top: 0 })
        },
        onError: (error) => {
          const lineIssues = lineIssuesFromError(error, lines)
          if (lineIssues) setIssues(lineIssues)
          let message = errorMessage(error)
          if (error instanceof ApiError) {
            if (error.code === "INSUFFICIENT_COPIES") message = "Not enough copies of some books. See the marked books."
            if (error.code === "INVALID_BOOKS") message = "Some books can't be borrowed. Remove the marked books."
            if (error.status === 404) message = "This borrow form is closed. Please ask the library staff."
          }
          setSendError(message)
          toast.error(message)
        },
      },
    )
  }

  const goToDetails = () => {
    pushedDetails.current = true
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set("step", "details")
        return next
      },
      { replace: false },
    )
    window.scrollTo({ top: 0 })
  }
  const backToBooks = () => {
    if (pushedDetails.current) {
      pushedDetails.current = false
      void navigate(-1)
    } else {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete("step")
          return next
        },
        { replace: true },
      )
    }
  }

  if (sent) {
    return (
      <PublicShell title={library.name} actions={<PublicHeaderActions />}>
        <SuccessScreen
          result={sent.result}
          email={sent.email}
          slug={slug}
          signedIn={!!me}
          onAnother={() => {
            setSent(null)
            window.scrollTo({ top: 0 })
          }}
        />
      </PublicShell>
    )
  }

  const copies = totalCopies(lines)
  const summary = `${plural(lines.length, "book")} · ${plural(copies, "copy", "copies")}`

  if (step === "details") {
    return (
      <PublicShell title={library.name} width="wide" actions={<PublicHeaderActions />}>
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={backToBooks}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back to books
          </Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Almost done</h1>
          <p className="text-sm text-muted-foreground">
            Tell us who you are. The library will look at your request and email you the answer.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <RequestForm
            slug={slug}
            lines={lines}
            onLineIssues={setIssues}
            onSubmitted={(result, email) => {
              setSent({ result, email })
              setLines([])
              setIssues({})
              pushedDetails.current = false
              setSearchParams({}, { replace: true })
              window.scrollTo({ top: 0 })
            }}
          />
          <Card className="gap-0 py-0 lg:sticky lg:top-20">
            <CardHeader className="border-b py-3">
              <CardTitle className="flex items-center justify-between gap-2">
                Your request
                <span className="text-xs font-normal text-muted-foreground">{summary}</span>
              </CardTitle>
            </CardHeader>
            <RequestList lines={lines} onChange={updateLines} issues={issues} />
            <CardFooter className="justify-center">
              <Button variant="link" size="sm" onClick={backToBooks}>
                Add more books
              </Button>
            </CardFooter>
          </Card>
        </div>
      </PublicShell>
    )
  }

  return (
    <PublicShell title={library.name} width="wide" actions={<PublicHeaderActions />}>
      <div className="flex flex-col gap-6">
        <LibraryIntro library={library} slug={slug} signedInAs={me?.borrower?.name} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <BookCatalog slug={slug} categories={categories} selected={selected} full={full} onToggle={toggleBook} />

          {/* Request list beside the books on large screens. */}
          <aside aria-labelledby="request-heading" className="hidden lg:sticky lg:top-20 lg:block">
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-3">
                <CardTitle id="request-heading" className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <ShoppingBasketIcon className="size-4" aria-hidden />
                    Your request
                  </span>
                  {lines.length > 0 && <span className="text-xs font-normal text-muted-foreground">{summary}</span>}
                </CardTitle>
              </CardHeader>
              <RequestList
                lines={lines}
                onChange={updateLines}
                issues={issues}
                disabled={sendMine.isPending}
                className="max-h-[50svh] overflow-y-auto"
              />
              <CardFooter className="flex-col items-stretch gap-2">
                {me && lines.length > 0 && (
                  <NoteField id="my-request-note" value={notes} onChange={setNotes} disabled={sendMine.isPending} />
                )}
                <PrimaryAction
                  signedIn={!!me}
                  pending={sendMine.isPending}
                  disabled={lines.length === 0}
                  onClick={me ? sendNow : goToDetails}
                  className="w-full"
                />
                {me && <SendError message={sendError} />}
                <p className="text-center text-xs text-muted-foreground">
                  Up to {REQUEST_LIMITS.maxBooks} books, {REQUEST_LIMITS.maxQuantity} copies each.
                </p>
              </CardFooter>
            </Card>
          </aside>
        </div>

        {/* Signed in, small screens: there is no next step, so the list (copies, marked books, note) is reviewed here,
            under the books; the bar below scrolls to it. */}
        {me && lines.length > 0 && (
          <Card id="my-request" className="scroll-mt-4 gap-0 py-0 lg:hidden">
            <CardHeader className="border-b py-3">
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <ShoppingBasketIcon className="size-4" aria-hidden />
                  Your request
                </span>
                <span className="text-xs font-normal text-muted-foreground">{summary}</span>
              </CardTitle>
            </CardHeader>
            <RequestList lines={lines} onChange={updateLines} issues={issues} disabled={sendMine.isPending} />
            <CardFooter className="flex-col items-stretch gap-2">
              <NoteField id="my-request-note-mobile" value={notes} onChange={setNotes} disabled={sendMine.isPending} />
              <SendError message={sendError} />
            </CardFooter>
          </Card>
        )}
      </div>

      {/* Small screens: this bar stays at the bottom while the books scroll by. Visitors review the list on the next
          step; signed-in borrowers review it in the "Your request" card above (tap the summary to jump there). */}
      {lines.length > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur supports-backdrop-filter:bg-background/90 lg:hidden">
          <div className="flex items-center gap-3">
            {me ? (
              <button
                type="button"
                className="min-w-0 flex-1 rounded-md text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => document.getElementById("my-request")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                aria-live="polite"
              >
                <p className={cn("text-sm font-medium", sendError && "text-destructive")}>
                  {sendError ? "Check your request" : "Your request"}
                </p>
                <p className="truncate text-xs text-muted-foreground underline underline-offset-2">{summary} · review</p>
              </button>
            ) : (
              <div className="min-w-0 flex-1" aria-live="polite">
                <p className="text-sm font-medium">Your request</p>
                <p className="truncate text-xs text-muted-foreground">{summary}</p>
              </div>
            )}
            <PrimaryAction signedIn={!!me} pending={sendMine.isPending} onClick={me ? sendNow : goToDetails} className="px-4" />
          </div>
        </div>
      )}
    </PublicShell>
  )
}

/** Optional note to the library, sent with a signed-in request (same 500-character limit as the public form). */
function NoteField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Note to the library (optional)
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        rows={2}
        disabled={disabled}
        className="min-h-14 text-sm"
      />
    </div>
  )
}

function SendError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-center text-xs font-medium text-destructive">
      {message}
    </p>
  )
}

/** "Continue" to the details step, or — signed in — "Send request" right away. */
function PrimaryAction({
  signedIn,
  pending,
  disabled,
  onClick,
  className,
}: {
  signedIn: boolean
  pending: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <Button size="lg" className={cn("h-10", className)} disabled={disabled || pending} onClick={onClick}>
      {signedIn ? (
        <>
          {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          Send request
        </>
      ) : (
        <>
          Continue
          <ArrowRightIcon data-icon="inline-end" />
        </>
      )}
    </Button>
  )
}

function LibraryIntro({
  library,
  slug,
  signedInAs,
}: {
  library: PublicLibraryInfo["library"]
  slug: string
  /** The linked borrower's name when signed in (the request is sent without a details form). */
  signedInAs?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-primary px-5 py-6 text-primary-foreground sm:px-8 sm:py-8">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-primary-foreground/10 blur-3xl" />
      <div className="relative flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-primary-foreground/70 uppercase">Borrow books</p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight break-words sm:text-3xl">{library.name}</h1>
          {library.description && <p className="max-w-2xl text-sm text-primary-foreground/85">{library.description}</p>}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-primary-foreground/85">
          {library.location && (
            <span className="flex items-center gap-1.5">
              <MapPinIcon className="size-4" aria-hidden />
              {library.location}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <CalendarDaysIcon className="size-4" aria-hidden />
            Borrow for {plural(library.defaultLoanDays, "day")}
          </span>
          <Link
            to={statusPath(slug)}
            className="flex items-center gap-1.5 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-primary-foreground/40 focus-visible:outline-none"
          >
            <TicketIcon className="size-4" aria-hidden />
            Check a request
          </Link>
        </p>
        <p className="text-sm text-primary-foreground/85">
          {signedInAs ? (
            <>
              Signed in as <span className="font-medium text-primary-foreground">{signedInAs}</span>. Add the books you want
              and press “Send request” — no form to fill in.
            </>
          ) : (
            "Add the books you want, then send your request. No account needed."
          )}
        </p>
      </div>
    </div>
  )
}
