import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api, ApiError } from "@/lib/api"
import type { Me } from "@/types/api"

export const authKeys = { me: ["auth", "me"] as const }

/**
 * Current user with their role's permissions, or null when not logged in. Permissions are checked by the API on
 * every request, so this is refetched after any 403 (see lib/query-client.ts) and after role changes.
 */
export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async (): Promise<Me | null> => {
      try {
        const res = await api.get<{ user: Me }>("/auth/me")
        return res.user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<{ user: Me }>("/auth/login", body),
    meta: { skipErrorToast: true },
    onSuccess: ({ user }) => {
      // Drop anything cached for a previous session (company profile and public pages stay), then store the new user.
      qc.removeQueries({
        predicate: (q) => q.queryKey[0] !== "auth" && q.queryKey[0] !== "public" && q.queryKey[0] !== "company",
      })
      qc.setQueryData<Me | null>(authKeys.me, user)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSettled: () => {
      qc.clear()
      qc.setQueryData<Me | null>(authKeys.me, null)
    },
  })
}

/**
 * Own password change. The API clears `mustChangePassword`, so the cached user is updated right away and
 * <RequireAuth> stops holding them on the Profile settings page.
 */
export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.patch<void>("/auth/password", body),
    meta: { skipErrorToast: true },
    onSuccess: () => {
      qc.setQueryData<Me | null>(authKeys.me, (me) => (me ? { ...me, mustChangePassword: false } : me))
    },
  })
}
