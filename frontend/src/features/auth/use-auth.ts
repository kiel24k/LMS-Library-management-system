import { useCallback, useMemo } from "react"

import { useMe } from "@/features/auth/api"
import type { Permission } from "@/lib/permissions"
import type { Me } from "@/types/api"

/** Who is signed in. Every account is the same kind; what it can see comes from its role's permissions. */
export type AuthState =
  | { status: "loading"; user: null; error: null }
  | { status: "error"; user: null; error: Error }
  | { status: "anonymous"; user: null; error: null }
  | { status: "authenticated"; user: Me; error: null }

export type PermissionChecks = {
  /** The signed-in user's permissions (empty while loading / logged out). */
  permissions: readonly Permission[]
  /** True when the signed-in user holds `permission`. Nobody bypasses this — not even the Administrator role. */
  can: (permission: Permission) => boolean
  /** True when the signed-in user holds at least one of `permissions`. */
  canAny: (...permissions: Permission[]) => boolean
  /** True when the signed-in user holds every one of `permissions`. */
  canAll: (...permissions: Permission[]) => boolean
}

const NONE: readonly Permission[] = []

export function useAuth(): AuthState & PermissionChecks & { refetch: () => void } {
  const me = useMe()
  const permissions = me.data?.permissions ?? NONE
  const held = useMemo(() => new Set<string>(permissions), [permissions])
  const can = useCallback((p: Permission) => held.has(p), [held])
  const canAny = useCallback((...ps: Permission[]) => ps.some((p) => held.has(p)), [held])
  const canAll = useCallback((...ps: Permission[]) => ps.every((p) => held.has(p)), [held])
  const checks: PermissionChecks = { permissions, can, canAny, canAll }

  const refetch = () => void me.refetch()
  if (me.isPending) return { status: "loading", user: null, error: null, ...checks, refetch }
  if (me.isError && me.data === undefined) return { status: "error", user: null, error: me.error, ...checks, refetch }
  const user = me.data ?? null
  if (user) return { status: "authenticated", user, error: null, ...checks, refetch }
  return { status: "anonymous", user: null, error: null, ...checks, refetch }
}

export type PermissionGate =
  /** Needs this one permission. */
  | { perm: Permission; any?: never; all?: never }
  /** Needs at least one of these. */
  | { perm?: never; any: readonly Permission[]; all?: never }
  /** Needs every one of these. */
  | { perm?: never; any?: never; all: readonly Permission[] }

/** Evaluates a {@link PermissionGate} with the checks from `useAuth()` (for lists, e.g. menu items). */
export function allows(checks: PermissionChecks, gate: PermissionGate): boolean {
  if (gate.perm) return checks.can(gate.perm)
  if (gate.any) return checks.canAny(...gate.any)
  return checks.canAll(...gate.all)
}

/** Evaluates a {@link PermissionGate} against the signed-in user's permissions. */
export function usePermissionGate(gate: PermissionGate): boolean {
  return allows(useAuth(), gate)
}
