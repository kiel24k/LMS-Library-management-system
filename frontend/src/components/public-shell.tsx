import type { ReactNode } from "react"
import { Link } from "react-router"
import { cn } from "cn"

import { BrandMark } from "@/components/brand"
import { useCompany } from "@/features/company/api"
import { companyContacts } from "@/features/company/contacts"
import { useDocumentTitle } from "@/features/company/use-document-title"

const WIDTHS = {
  /** Forms and short pages. */
  narrow: "max-w-3xl",
  /** The book catalog. */
  wide: "max-w-6xl",
}

/**
 * Page frame for the pages used without an account (catalog, borrow form, request status):
 * company logo and name in the header, with an optional page or library `title` under the name, `actions` at the
 * right of the header (e.g. "Sign in"), and the company's contact details in the footer.
 */
export function PublicShell({
  title,
  actions,
  width = "narrow",
  children,
}: {
  /** Page or library name; a plain string also goes in the browser tab title. */
  title?: ReactNode
  actions?: ReactNode
  width?: keyof typeof WIDTHS
  children: ReactNode
}) {
  const company = useCompany()
  useDocumentTitle(typeof title === "string" ? title : null)
  const contacts = companyContacts(company)

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className={cn("mx-auto flex items-center gap-3 px-4 py-2.5", WIDTHS[width])}>
          <Link
            to="/catalog"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <BrandMark size="sm" decorative />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-semibold">{company.name}</span>
              {title && <span className="block truncate text-xs text-muted-foreground">{title}</span>}
            </span>
          </Link>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
      <main className={cn("mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6", WIDTHS[width])}>{children}</main>
      <footer className="border-t bg-background">
        <div
          className={cn(
            "mx-auto flex flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
            WIDTHS[width],
          )}
        >
          <p className="font-medium text-foreground/80">{company.name}</p>
          {contacts.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {contacts.map((c) => (
                <li key={c.key} className="flex min-w-0 items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
                  {c.icon}
                  {c.href ? (
                    <a href={c.href} className="break-all underline-offset-4 hover:text-foreground hover:underline">
                      {c.text}
                    </a>
                  ) : (
                    <span className="break-words">{c.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </footer>
    </div>
  )
}
