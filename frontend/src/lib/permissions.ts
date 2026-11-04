// Mirror of the permission keys in backend/src/lib/permissions.ts (keep both lists identical, same order).
// Labels, descriptions and "requires" for the permission editor come from GET /api/permissions.

export const PERMISSIONS = [
  "dashboard.view",
  "libraries.view",
  "libraries.create",
  "libraries.update",
  "libraries.delete",
  "categories.create",
  "categories.update",
  "categories.delete",
  "books.view",
  "books.create",
  "books.update",
  "books.delete",
  "borrowers.view",
  "borrowers.create",
  "borrowers.update",
  "borrowers.delete",
  "loans.view",
  "loans.create",
  "loans.update",
  "loans.approve",
  "loans.cancel",
  "loans.return",
  "users.view",
  "users.create",
  "users.update",
  "users.deactivate",
  "users.reset_password",
  "roles.view",
  "roles.create",
  "roles.update",
  "roles.delete",
  "company.update",
  "my_books.view",
] as const

export type Permission = (typeof PERMISSIONS)[number]

const KNOWN = new Set<string>(PERMISSIONS)

export function isPermission(value: string): value is Permission {
  return KNOWN.has(value)
}
