/**
 * Permission catalog — the single source of truth for role-based access control (docs/SPEC.md "Roles and
 * permissions"). Every staff endpoint is gated by one of these keys; roles hold a set of them and every user has
 * exactly one role. Nobody bypasses the check: the "Administrator" role is simply a role that holds them all.
 *
 * Order here = display order (GET /permissions, the permission tree) = the order stored in `Role.permissions`.
 * `requires` lists permissions that are always granted together with it (normalizePermissions adds them).
 */

type PermissionDef = { key: string; label: string; description?: string; requires: readonly string[] };
type ModuleDef = { key: string; label: string; permissions: readonly PermissionDef[] };

export const PERMISSION_MODULES = [
  {
    key: "dashboard",
    label: "Dashboard",
    permissions: [
      { key: "dashboard.view", label: "View dashboard", description: "See the dashboard numbers and the pending-requests badge", requires: [] },
    ],
  },
  {
    key: "libraries",
    label: "Libraries",
    permissions: [
      { key: "libraries.view", label: "View libraries", description: "Open the Libraries page and library details", requires: [] },
      { key: "libraries.create", label: "Add libraries", requires: ["libraries.view"] },
      {
        key: "libraries.update",
        label: "Edit libraries",
        description: "Edit details, loan days and turn the public borrow form on/off",
        requires: ["libraries.view"],
      },
      { key: "libraries.delete", label: "Delete libraries", requires: ["libraries.view"] },
    ],
  },
  {
    key: "categories",
    label: "Groupings",
    permissions: [
      { key: "categories.create", label: "Add groupings", requires: ["libraries.view"] },
      { key: "categories.update", label: "Edit groupings", requires: ["libraries.view"] },
      { key: "categories.delete", label: "Delete groupings", requires: ["libraries.view"] },
    ],
  },
  {
    key: "books",
    label: "Books",
    permissions: [
      { key: "books.view", label: "View books", description: "Book list, details and pictures", requires: [] },
      { key: "books.create", label: "Add books", description: 'Includes "Add many"', requires: ["books.view"] },
      { key: "books.update", label: "Edit books", description: "Details, copies and pictures", requires: ["books.view"] },
      { key: "books.delete", label: "Delete / archive books", requires: ["books.view"] },
    ],
  },
  {
    key: "borrowers",
    label: "Borrowers",
    permissions: [
      { key: "borrowers.view", label: "View borrowers", requires: [] },
      { key: "borrowers.create", label: "Add borrowers", requires: ["borrowers.view"] },
      { key: "borrowers.update", label: "Edit borrowers", requires: ["borrowers.view"] },
      { key: "borrowers.delete", label: "Delete borrowers", requires: ["borrowers.view"] },
    ],
  },
  {
    key: "loans",
    label: "Borrow Records",
    permissions: [
      { key: "loans.view", label: "View borrow records", requires: [] },
      {
        key: "loans.create",
        label: "Borrow books",
        description: 'Staff "Borrow Books" form',
        requires: ["loans.view", "books.view", "borrowers.view"],
      },
      { key: "loans.update", label: "Edit borrow records", description: "Items, notes, due date", requires: ["loans.view", "books.view"] },
      { key: "loans.approve", label: "Approve / reject requests", description: "Public-form requests", requires: ["loans.view"] },
      { key: "loans.cancel", label: "Cancel borrow records", requires: ["loans.view"] },
      { key: "loans.return", label: "Record returns", description: "Return check", requires: ["loans.view"] },
    ],
  },
  {
    key: "users",
    label: "Users",
    permissions: [
      { key: "users.view", label: "View accounts", requires: [] },
      { key: "users.create", label: "Add accounts", requires: ["users.view", "roles.view"] },
      { key: "users.update", label: "Edit accounts", description: "Name and role", requires: ["users.view", "roles.view"] },
      { key: "users.deactivate", label: "Activate / deactivate accounts", requires: ["users.view"] },
      { key: "users.reset_password", label: "Reset passwords", requires: ["users.view"] },
    ],
  },
  {
    key: "roles",
    label: "Roles & Permissions",
    permissions: [
      { key: "roles.view", label: "View roles", requires: [] },
      { key: "roles.create", label: "Add roles", requires: ["roles.view"] },
      { key: "roles.update", label: "Edit roles and their permissions", requires: ["roles.view"] },
      { key: "roles.delete", label: "Delete roles", description: "Only roles with no accounts", requires: ["roles.view"] },
    ],
  },
  {
    key: "company",
    label: "Company Profile",
    permissions: [
      {
        key: "company.update",
        label: "Edit company profile",
        description: "Name, logo and contact details shown on every page and in emails",
        requires: [],
      },
    ],
  },
  {
    key: "my_books",
    label: "My Books",
    permissions: [
      {
        key: "my_books.view",
        label: "See my borrowed books",
        description: "The My Books page: the borrow records of the borrower linked to the signed-in account",
        requires: [],
      },
    ],
  },
] as const satisfies readonly ModuleDef[];

/** Every permission key (string-literal union). Keep identical to frontend/src/lib/permissions.ts. */
export type Permission = (typeof PERMISSION_MODULES)[number]["permissions"][number]["key"];

/** All permission keys in catalog order. */
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => p.key));

const ORDER = new Map<string, number>(ALL_PERMISSIONS.map((p, i) => [p, i]));
const REQUIRES = new Map<string, readonly Permission[]>(
  PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => [p.key, p.requires as readonly Permission[]] as const)),
);

export const isPermission = (v: unknown): v is Permission => typeof v === "string" && ORDER.has(v);

/**
 * Dedupes, adds every `requires` (transitively) and sorts in catalog order. Unknown keys are dropped
 * (request bodies are validated with `isPermission` first, so this only matters for stale rows in the database).
 */
export function normalizePermissions(list: Iterable<string>): Permission[] {
  const out = new Set<Permission>();
  const add = (p: string) => {
    if (!isPermission(p) || out.has(p)) return;
    out.add(p);
    for (const r of REQUIRES.get(p) ?? []) add(r);
  };
  for (const p of list) add(p);
  return [...out].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
}

/**
 * Lock-out guard: at least one active account must always hold all of these, so someone can still manage
 * accounts and roles (409 ACCESS_LOCKOUT otherwise).
 */
export const ACCESS_ADMIN_PERMISSIONS: readonly Permission[] = ["users.view", "users.update", "roles.view", "roles.update"];

/**
 * What `npm run db:seed` always (re-)grants to the Administrator role: every users.* and roles.* permission, and
 * company.update (so the company name and logo can always be fixed).
 */
export const SEED_ADMIN_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (p) => p.startsWith("users.") || p.startsWith("roles.") || p === "company.update",
);

/**
 * The default "Staff" role: everything the old STAFF role could do (no library admin, users or roles), plus My Books
 * (accepted borrowers get the default role and see their own records there).
 */
export const DEFAULT_STAFF_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (p) =>
    !["libraries.create", "libraries.update", "libraries.delete"].includes(p) &&
    !p.startsWith("users.") &&
    !p.startsWith("roles.") &&
    !p.startsWith("company."),
);

/** True when `held` contains every permission in `needed`. */
export function hasAllPermissions(held: readonly string[], needed: readonly string[]): boolean {
  const set = new Set(held);
  return needed.every((p) => set.has(p));
}

/** GET /permissions payload (`PermissionModule[]`, description always present). */
export function permissionCatalog() {
  return PERMISSION_MODULES.map((m) => ({
    key: m.key,
    label: m.label,
    permissions: m.permissions.map((p: PermissionDef) => ({
      key: p.key,
      label: p.label,
      description: p.description ?? null,
      requires: [...p.requires],
    })),
  }));
}
