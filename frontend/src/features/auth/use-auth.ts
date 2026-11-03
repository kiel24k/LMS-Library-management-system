import { useMe } from "@/features/auth/api"
import type { User } from "@/types/api"

export type AuthState =
  | { status: "loading"; user: null; error: null }
  | { status: "error"; user: null; error: Error }
  | { status: "anonymous"; user: null; error: null }
  | { status: "authenticated"; user: User; error: null }

export function useAuth(): AuthState & { isAdmin: boolean; refetch: () => void } {
  const me = useMe()
  const refetch = () => void me.refetch()
  if (me.isPending) return { status: "loading", user: null, error: null, isAdmin: false, refetch }
  if (me.isError && me.data === undefined) return { status: "error", user: null, error: me.error, isAdmin: false, refetch }
  const user = me.data ?? null
  if (!user) return { status: "anonymous", user: null, error: null, isAdmin: false, refetch }
  return { status: "authenticated", user, error: null, isAdmin: user.role === "ADMIN", refetch }
}
