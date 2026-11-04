import type { ReactNode } from "react"

import { usePermissionGate, type PermissionGate } from "@/features/auth/use-auth"

/**
 * Renders its children only when the signed-in user has the permission(s); otherwise `fallback` (nothing by default).
 *   <Can perm="books.create"><Button>Add book</Button></Can>
 *   <Can any={["users.view", "roles.view"]}>…</Can>
 */
export function Can({ children, fallback = null, ...gate }: PermissionGate & { children: ReactNode; fallback?: ReactNode }) {
  return usePermissionGate(gate as PermissionGate) ? children : fallback
}
