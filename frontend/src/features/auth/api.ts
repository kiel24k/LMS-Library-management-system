import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api, ApiError } from "@/lib/api"
import type { User } from "@/types/api"

export const authKeys = { me: ["auth", "me"] as const }

/** Current user, or null when not logged in. */
export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async (): Promise<User | null> => {
      try {
        const res = await api.get<{ user: User }>("/auth/me")
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
    mutationFn: (body: { email: string; password: string }) => api.post<{ user: User }>("/auth/login", body),
    meta: { skipErrorToast: true },
    onSuccess: ({ user }) => {
      // Drop anything cached for a previous session, then store the new user.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" && q.queryKey[0] !== "public" })
      qc.setQueryData(authKeys.me, user)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSettled: () => {
      qc.clear()
      qc.setQueryData(authKeys.me, null)
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.patch<void>("/auth/password", body),
    meta: { skipErrorToast: true },
  })
}
