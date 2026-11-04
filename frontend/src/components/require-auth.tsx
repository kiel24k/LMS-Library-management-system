import type { ReactNode } from "react"
import { Link, Navigate, Outlet, useLocation } from "react-router"
import { ShieldAlertIcon } from "lucide-react"

import { EmptyState, ErrorState, FullScreenSpinner } from "@/components/states"
import { Button } from "@/components/ui/button"
import { useAuth, usePermissionGate, type PermissionGate } from "@/features/auth/use-auth"

/** Where an account still on the default password is held until it changes it (Profile settings, password card). */
export const CHANGE_PASSWORD_PATH = "/account?change-password=1"

/**
 * Signed-in routes: redirects anonymous visitors to /login?next=…. An account still on the default password
 * (`mustChangePassword`, e.g. made when a borrower's request was accepted) can only open /account until it changes it.
 */
export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === "loading") return <FullScreenSpinner />
  if (auth.status === "error") {
    return (
      <div className="mx-auto flex min-h-svh max-w-md items-center p-4">
        <ErrorState error={auth.error} onRetry={auth.refetch} title="Can't connect right now" />
      </div>
    )
  }
  if (auth.status === "anonymous") {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (auth.user.mustChangePassword && location.pathname !== "/account") {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />
  }
  return <Outlet />
}

/** Shown in place of a page the signed-in user has no permission for. */
export function NoAccess() {
  const { can } = useAuth()
  return (
    <EmptyState
      icon={<ShieldAlertIcon />}
      title="You don't have access to this page"
      description="Your role doesn't include this. Ask someone who manages accounts if you need it."
      action={
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/" />}>
          {can("dashboard.view") ? "Go to dashboard" : "Go to home"}
        </Button>
      }
    />
  )
}

/**
 * Route element (inside the staff layout) that renders its child routes only with the permission(s):
 *   { element: <RequirePermission perm="books.view" />, children: [...] }
 *   { element: <RequirePermission any={["users.view", "roles.view"]} />, children: [...] }
 * Without them it shows `fallback` (default: "You don't have access to this page").
 */
export function RequirePermission({ fallback, ...gate }: PermissionGate & { fallback?: ReactNode }) {
  const allowed = usePermissionGate(gate as PermissionGate)
  if (!allowed) return fallback ?? <NoAccess />
  return <Outlet />
}
