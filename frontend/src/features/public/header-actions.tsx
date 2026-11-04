import { Link } from "react-router"
import { BookMarkedIcon, HomeIcon, LayoutDashboardIcon, LogInIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/use-auth"

/**
 * Right side of the public pages' header: "Sign in" for visitors, or a way back into the app for whoever is already
 * signed in (named after the page their home shows: Dashboard, My Books or the welcome page).
 */
export function PublicHeaderActions() {
  const auth = useAuth()
  if (auth.status === "loading") return null
  if (auth.status === "authenticated") {
    const [to, label, Icon] = auth.can("dashboard.view")
      ? ["/", "Dashboard", LayoutDashboardIcon]
      : auth.can("my_books.view")
        ? ["/my-books", "My Books", BookMarkedIcon]
        : ["/", "Home", HomeIcon]
    return (
      <Button variant="outline" size="sm" nativeButton={false} render={<Link to={to} />}>
        <Icon data-icon="inline-start" />
        {label}
      </Button>
    )
  }
  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/login" />}>
      <LogInIcon data-icon="inline-start" />
      Sign in
    </Button>
  )
}
