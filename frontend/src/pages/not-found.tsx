import { isRouteErrorResponse, Link, useRouteError } from "react-router"
import { CompassIcon, TriangleAlertIcon } from "lucide-react"

import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60svh] items-center justify-center p-4">
      <EmptyState
        icon={<CompassIcon />}
        title="Page not found"
        action={
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/" />}>
            Go home
          </Button>
        }
      />
    </div>
  )
}

/** Router error boundary: unexpected render errors. */
export function RouteErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  const message = error instanceof Error ? error.message : "Unexpected error."
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <EmptyState
        icon={<TriangleAlertIcon />}
        title="Something went wrong"
        description={message}
        action={
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        }
      />
    </div>
  )
}
