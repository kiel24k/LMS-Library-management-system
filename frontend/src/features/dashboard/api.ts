import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { Dashboard } from "@/types/api"

export const dashboardKeys = {
  all: ["dashboard"] as const,
  scoped: (libraryId: string | null) => ["dashboard", libraryId ?? "all"] as const,
}

export function useDashboard(libraryId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dashboardKeys.scoped(libraryId),
    queryFn: ({ signal }) => api.get<Dashboard>("/dashboard", { libraryId }, signal),
    refetchInterval: 60_000,
    enabled: options.enabled ?? true,
  })
}
