import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { authKeys } from "@/features/auth/api"
import { api } from "@/lib/api"
import type { ListResponse, User, UserCreateInput, UserPatchInput } from "@/types/api"

export const userKeys = { all: ["users"] as const }

export function useUsers() {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: ({ signal }) => api.get<ListResponse<User>>("/users", undefined, signal).then((r) => r.data),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserCreateInput) => api.post<User>("/users", body),
    meta: { skipErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UserPatchInput & { id: string }) =>
      api.patch<User>(`/users/${encodeURIComponent(id)}`, body),
    meta: { skipErrorToast: true },
    onSuccess: (updated) => {
      // Editing your own account: keep the signed-in user (top-bar profile menu, greeting, Profile settings page) in sync.
      if (qc.getQueryData<User | null>(authKeys.me)?.id === updated.id) qc.setQueryData(authKeys.me, updated)
      return qc.invalidateQueries({ queryKey: userKeys.all })
    },
  })
}
