import { MutationCache, QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

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

export const queryClient = new QueryClient({
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
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // 401s redirect to the login page instead of toasting.
      if (error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED") return
      if (mutation.meta?.skipErrorToast) return
      toast.error(errorMessage(error))
    },
  }),
})
