import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { authKeys } from "@/features/auth/api"
import { ApiError, errorMessage } from "@/lib/api"

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: Error
    mutationMeta: {
      /** Set to true when the caller shows the error itself (e.g. inline form errors). */
      skipErrorToast?: boolean
    }
  }
}

/**
 * A 403 means the signed-in user's permissions no longer match what the UI thinks (someone changed their role
 * meanwhile): refetch /auth/me so buttons, menus and routes re-gate right away.
 */
function refreshPermissionsOn403(error: unknown) {
  if (error instanceof ApiError && error.status === 403) void queryClient.invalidateQueries({ queryKey: authKeys.me })
}

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Never retry client errors (4xx); retry network/server errors once.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 1
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.queryKey[0] !== authKeys.me[0]) refreshPermissionsOn403(error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      refreshPermissionsOn403(error)
      // 401s redirect to the login page instead of toasting.
      if (error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED") return
      if (mutation.meta?.skipErrorToast) return
      toast.error(errorMessage(error))
    },
  }),
})
