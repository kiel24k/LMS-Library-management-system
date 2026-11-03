import type { ReactNode } from "react"
import { LibraryIcon } from "lucide-react"

/** Minimal page frame for the public (no-login) pages. */
export function PublicShell({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LibraryIcon className="size-4" />
          </div>
          <p className="min-w-0 truncate font-semibold">{title ?? "Library"}</p>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">{children}</main>
    </div>
  )
}
