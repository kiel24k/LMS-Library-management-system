import type { ReactNode } from "react"
import { Link, Navigate } from "react-router"
import { ChevronRightIcon, SettingsIcon, ShieldQuestionIcon } from "lucide-react"

import { NAV_ITEMS } from "@/components/nav-items"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/states"
import { Card, CardContent } from "@/components/ui/card"
import { allows, useAuth } from "@/features/auth/use-auth"

/**
 * Home (/) for accounts whose role can't see the dashboard: My Books when the role has it (e.g. the default role an
 * accepted borrower gets), else the welcome page.
 */
export function HomeFallback() {
  const { can } = useAuth()
  if (can("my_books.view")) return <Navigate to="/my-books" replace />
  return <WelcomePage />
}

/** Home page for accounts whose role can't see the dashboard or My Books: lists the pages they can open instead. */
export function WelcomePage() {
  const auth = useAuth()
  const pages = NAV_ITEMS.filter((item) => item.to !== "/" && allows(auth, item.gate))
  const firstName = auth.user?.name.trim().split(/\s+/)[0]

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description={auth.user ? `You're signed in with the ${auth.user.role.name} role.` : undefined}
      />
      {pages.length === 0 ? (
        <EmptyState
          icon={<ShieldQuestionIcon />}
          title="Nothing to open yet"
          description="Your role doesn't include any pages. Ask someone who manages accounts to give your role the permissions you need."
        />
      ) : (
        <section aria-labelledby="welcome-pages" className="flex flex-col gap-3">
          <h2 id="welcome-pages" className="text-sm font-medium text-muted-foreground">
            Pages you can open
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pages.map((item) => (
              <PageLink key={item.to} to={item.to} icon={<item.icon className="size-5" />} label={item.label} description={item.description} />
            ))}
            <PageLink
              to="/account"
              icon={<SettingsIcon className="size-5" />}
              label="Profile settings"
              description="Your password, colors and what your role allows."
            />
          </div>
        </section>
      )}
    </>
  )
}

function PageLink({ to, icon, label, description }: { to: string; icon: ReactNode; label: string; description: string }) {
  return (
    <Link to={to} className="group rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      <Card className="h-full transition-colors group-hover:bg-muted/40">
        <CardContent className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-base font-medium">{label}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </CardContent>
      </Card>
    </Link>
  )
}
