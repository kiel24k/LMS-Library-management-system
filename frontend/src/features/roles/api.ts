import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { authKeys } from "@/features/auth/api"
import { userKeys } from "@/features/users/api"
import { api } from "@/lib/api"
import type { ListResponse, Me, PermissionModule, RoleDetail, RoleInput, RolePatchInput } from "@/types/api"

export const roleKeys = { all: ["roles"] as const }
export const permissionKeys = { catalog: ["permissions"] as const }

/** The permission catalog (modules → permissions, display order). Any signed-in user may read it. */
export function usePermissionCatalog() {
  return useQuery({
    queryKey: permissionKeys.catalog,
    queryFn: ({ signal }) => api.get<ListResponse<PermissionModule>>("/permissions", undefined, signal).then((r) => r.data),
    staleTime: Infinity, // only changes with a new release
  })
}

/** All roles, sorted by name. Needs roles.view — pass `enabled: can("roles.view")`. */
export function useRoles(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: roleKeys.all,
    queryFn: ({ signal }) => api.get<ListResponse<RoleDetail>>("/roles", undefined, signal).then((r) => r.data),
    enabled: options.enabled ?? true,
  })
}

/** After a role changes: refresh the role list, the accounts table (role names) and — if it is the signed-in user's role — their permissions. */
function afterRoleChange(qc: QueryClient, roleId: string) {
  const me = qc.getQueryData<Me | null>(authKeys.me)
  return Promise.all([
    qc.invalidateQueries({ queryKey: roleKeys.all }),
    qc.invalidateQueries({ queryKey: userKeys.all }),
    me?.role.id === roleId ? qc.invalidateQueries({ queryKey: authKeys.me }) : undefined,
  ])
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: RoleInput) => api.post<RoleDetail>("/roles", body),
    meta: { skipErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: RolePatchInput & { id: string }) =>
      api.patch<RoleDetail>(`/roles/${encodeURIComponent(id)}`, body),
    meta: { skipErrorToast: true },
    onSuccess: (role) => afterRoleChange(qc, role.id),
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${encodeURIComponent(id)}`),
    meta: { skipErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  })
}
