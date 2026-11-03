import { Link, Navigate, Outlet, useLocation } from "react-router"
import { ShieldAlertIcon } from "lucide-react"

import { EmptyState, ErrorState, FullScreenSpinner } from "@/components/states"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/use-auth"

/** Staff-only routes: redirects anonymous visitors to /login?next=… */
export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === "loading") return <FullScreenSpinner />
  if (auth.status === "error") {
    return (
      <div className="mx-auto flex min-h-svh max-w-md items-center p-4">
        <ErrorState error={auth.error} onRetry={auth.refetch} title="Can't reach the library system" />
      </div>
    )
  }
  if (auth.status === "anonymous") {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

/** Admin-only routes (rendered inside the staff layout). */
export function RequireAdmin() {
  const auth = useAuth()
  if (!auth.isAdmin) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon />}
        title="Admins only"
        action={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/" />}>
            Go to dashboard
          </Button>
        }
      />
    )
  }
  return <Outlet />
}
