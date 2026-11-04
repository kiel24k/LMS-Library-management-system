import type { Permission } from "@/lib/permissions"
import type { PermissionModule, RoleDetail } from "@/types/api"

export type CatalogPermission = PermissionModule["permissions"][number]

/**
 * Lookup tables over the permission catalog (GET /permissions) for the role editor: display order, which
 * module a permission is in, and the "requires" graph in both directions (closed transitively).
 */
export type CatalogIndex = {
  modules: PermissionModule[]
  all: Permission[] // catalog order
  get: (p: Permission) => { permission: CatalogPermission; module: PermissionModule } | undefined
  /** Everything `p` needs, transitively (without `p`). */
  requiresOf: (p: Permission) => Permission[]
  /** Everything that needs `p`, transitively (without `p`). */
  dependentsOf: (p: Permission) => Permission[]
  /** Dedupe + catalog order (unknown keys dropped). */
  sort: (list: Iterable<Permission>) => Permission[]
}

function closure(start: Permission, edges: Map<Permission, Permission[]>): Set<Permission> {
  const out = new Set<Permission>()
  const visit = (p: Permission) => {
    for (const next of edges.get(p) ?? []) {
      if (next === start || out.has(next)) continue
      out.add(next)
      visit(next)
    }
  }
  visit(start)
  return out
}

export function buildCatalogIndex(modules: PermissionModule[]): CatalogIndex {
  const byKey = new Map<Permission, { permission: CatalogPermission; module: PermissionModule }>()
  const requires = new Map<Permission, Permission[]>()
  const requiredBy = new Map<Permission, Permission[]>()
  for (const module of modules) {
    for (const permission of module.permissions) {
      byKey.set(permission.key, { permission, module })
      requires.set(permission.key, permission.requires)
      for (const r of permission.requires) requiredBy.set(r, [...(requiredBy.get(r) ?? []), permission.key])
    }
  }
  const all = [...byKey.keys()]
  const order = new Map(all.map((p, i) => [p, i]))
  const sort = (list: Iterable<Permission>) =>
    [...new Set(list)].filter((p) => order.has(p)).sort((a, b) => order.get(a)! - order.get(b)!)
  const requiresCache = new Map<Permission, Permission[]>()
  const dependentsCache = new Map<Permission, Permission[]>()

  return {
    modules,
    all,
    get: (p) => byKey.get(p),
    requiresOf: (p) => {
      let hit = requiresCache.get(p)
      if (!hit) requiresCache.set(p, (hit = sort(closure(p, requires))))
      return hit
    },
    dependentsOf: (p) => {
      let hit = dependentsCache.get(p)
      if (!hit) dependentsCache.set(p, (hit = sort(closure(p, requiredBy))))
      return hit
    },
    sort,
  }
}

/** Result of a checkbox change: the new selection plus what was changed automatically besides the clicked item(s). */
export type PermissionChange = {
  next: Permission[]
  autoAdded: Permission[]
  autoRemoved: Permission[]
}

/**
 * Turns permissions on or off the way the API normalizes them: turning one on also turns on everything it
 * requires; turning one off also turns off everything that requires it.
 * `targets` are the clicked permission(s) (one row, or every row of a module).
 */
export function applyPermissionChange(
  index: CatalogIndex,
  selected: readonly Permission[],
  targets: readonly Permission[],
  on: boolean,
): PermissionChange {
  const current = new Set(selected)
  const next = new Set(selected)
  const touched = new Set(targets)
  if (on) {
    for (const p of targets) {
      next.add(p)
      for (const r of index.requiresOf(p)) next.add(r)
    }
  } else {
    for (const p of targets) {
      next.delete(p)
      for (const d of index.dependentsOf(p)) next.delete(d)
    }
  }
  const sorted = index.sort(next)
  return {
    next: sorted,
    autoAdded: sorted.filter((p) => !current.has(p) && !touched.has(p)),
    autoRemoved: index.sort(selected).filter((p) => !next.has(p) && !touched.has(p)),
  }
}

/** True when both lists hold the same permissions (order ignored). */
export function samePermissions(a: readonly Permission[], b: readonly Permission[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((p) => set.has(p))
}

/**
 * Whether the signed-in user holds every permission of the role — needed to give it to an account or to make it
 * the default (the API answers PERMISSION_ESCALATION otherwise).
 */
export function canGrantRole(role: RoleDetail, can: (p: Permission) => boolean) {
  return role.permissions.every((p) => can(p))
}
