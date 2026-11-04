import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { authKeys } from "@/features/auth/api"
import { api } from "@/lib/api"
import type { ListResponse, Me, User, UserCreateInput, UserPatchInput } from "@/types/api"

export const userKeys = { all: ["users"] as const }

// Role list keys live in features/roles/api.ts (which imports this file); repeated here to avoid a cycle.
const ROLES_KEY = ["roles"] as const

/** All accounts. Needs users.view — pass `enabled: can("users.view")`. */
export function useUsers(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: ({ signal }) => api.get<ListResponse<User>>("/users", undefined, signal).then((r) => r.data),
    enabled: options.enabled ?? true,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserCreateInput) => api.post<User>("/users", body),
    meta: { skipErrorToast: true },
    // Role list shows "N accounts" per role.
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: userKeys.all }), qc.invalidateQueries({ queryKey: ROLES_KEY })]),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UserPatchInput & { id: string }) =>
      api.patch<User>(`/users/${encodeURIComponent(id)}`, body),
    meta: { skipErrorToast: true },
    onSuccess: (updated) => {
      // Editing your own account: keep the signed-in user (top-bar profile menu, greeting, Profile settings page) in
      // sync right away, then reload it so the permissions follow a role change too.
      const me = qc.getQueryData<Me | null>(authKeys.me)
      const self = me?.id === updated.id
      if (self) qc.setQueryData<Me>(authKeys.me, { ...me, ...updated })
      return Promise.all([
        qc.invalidateQueries({ queryKey: userKeys.all }),
        qc.invalidateQueries({ queryKey: ROLES_KEY }),
        // Borrower pages show the linked account's role and status.
        updated.borrower ? qc.invalidateQueries({ queryKey: ["borrowers"] }) : undefined,
        self ? qc.invalidateQueries({ queryKey: authKeys.me }) : undefined,
      ])
    },
  })
}
