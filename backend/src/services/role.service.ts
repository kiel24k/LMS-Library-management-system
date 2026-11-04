import { prisma, TX_OPTIONS, type Db, type Tx } from "../lib/prisma.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { forbidden } from "../middleware/auth.js";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/prisma-errors.js";
import { ACCESS_ADMIN_PERMISSIONS, normalizePermissions, type Permission } from "../lib/permissions.js";
import { serializeRole } from "./serializers.js";

/** `isDefault` can only be set (true): a role stops being the default when another one becomes it. */
export type RoleInput = { name: string; description?: string | null; permissions: Permission[]; isDefault?: true };

/** Who is making the change (escalation checks compare against their permissions). */
export type Actor = { id: string; permissions: readonly Permission[] };

const roleInclude = { _count: { select: { users: true } } } as const;

const roleNameTaken = () => new HttpError(409, "ROLE_NAME_TAKEN", "A role with this name already exists.");
const roleInUse = () =>
  new HttpError(409, "ROLE_IN_USE", "This role is still given to one or more accounts. Give them another role first.");
export const permissionEscalation = (message = "You can't grant permissions you don't have.") =>
  new HttpError(403, "PERMISSION_ESCALATION", message);
const defaultEscalation = () =>
  permissionEscalation("You can't make a role the default if it has permissions you don't have.");
const roleIsDefault = () =>
  new HttpError(409, "ROLE_IS_DEFAULT", "This is the default role for new accounts. Make another role the default first.");
const defaultChanged = () =>
  new HttpError(409, "CONFLICT", "The default role changed while your request was being processed. Please refresh and try again.");

/** The partial unique index "Role_single_default_key" (migration 20261104130000_default_role): two defaults. */
const isDefaultConflict = (err: unknown) => isUniqueViolation(err, "Role_single_default_key");

/**
 * Runs `fn`, retrying a few times when it lost a race on the single default role. Every writer of `isDefault`
 * here takes `lockAccessChanges` first, so this only matters for writers outside this service (e.g. the seed);
 * it keeps such a race from ever surfacing as a 500 (after the retries: 409 CONFLICT).
 */
async function retryOnDefaultConflict<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDefaultConflict(err) || attempt >= 3) throw err;
    }
  }
}

// ---------------------------------------------------------------- lock-out guard

/** Arbitrary constant: the advisory-lock key that serializes every change which can reduce access. */
const ACCESS_LOCK_KEY = 482_001;

/**
 * Serializes changes that can take away the ability to manage users and roles (role permission edits, role
 * changes, deactivations) for the rest of the transaction, so two concurrent changes cannot both pass
 * `assertAccessRetained` (e.g. two admins demoting each other).
 */
export async function lockAccessChanges(tx: Tx) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${ACCESS_LOCK_KEY})`);
}

/**
 * 409 ACCESS_LOCKOUT unless at least one active account still holds every ACCESS_ADMIN_PERMISSIONS. Run it
 * inside the transaction, after the change and after `lockAccessChanges`.
 */
export async function assertAccessRetained(tx: Tx) {
  const n = await tx.user.count({
    where: { active: true, role: { permissions: { hasEvery: [...ACCESS_ADMIN_PERMISSIONS] } } },
  });
  if (n === 0) {
    throw new HttpError(409, "ACCESS_LOCKOUT", "At least one active account must be able to manage users and roles.");
  }
}

/** 403 PERMISSION_ESCALATION (or `error()`) unless the actor holds every permission in `granted`. */
export function assertCanGrant(actor: Actor, granted: readonly string[], error = () => permissionEscalation()) {
  const held = new Set<string>(actor.permissions);
  if (granted.some((p) => !held.has(p))) throw error();
}

// ---------------------------------------------------------------- default role

/**
 * Makes `id` the only default role. Call inside the transaction, after `lockAccessChanges` (which serializes
 * every change of the default, so concurrent calls end with exactly one default).
 */
async function makeDefault(tx: Tx, id: string) {
  await tx.role.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
  await tx.role.update({ where: { id }, data: { isDefault: true } });
}

/** The role new accounts get when no role is chosen, or null when none is set. */
export function findDefaultRole(db: Db = prisma) {
  return db.role.findFirst({ where: { isDefault: true }, select: { id: true, permissions: true } });
}

// ---------------------------------------------------------------- CRUD

/** Case-insensitive lookup of a role name. */
function findRoleByName(db: Db, name: string, excludeId?: string) {
  return db.role.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

export async function listRoles() {
  const rows = await prisma.role.findMany({ include: roleInclude });
  return { data: rows.sort(byName).map(serializeRole) };
}

export async function getRole(id: string, db: Db = prisma) {
  const r = await db.role.findUnique({ where: { id }, include: roleInclude });
  if (!r) throw notFound("Role");
  return serializeRole(r);
}

export async function createRole(input: RoleInput, actor: Actor) {
  // Changing the default role is what roles.update gates (as on PATCH), even when it happens on create.
  if (input.isDefault && !actor.permissions.includes("roles.update")) throw forbidden();
  const permissions = normalizePermissions(input.permissions);
  // Also covers isDefault: the actor holds every permission of the new role.
  assertCanGrant(actor, permissions);
  if (await findRoleByName(prisma, input.name)) throw roleNameTaken();
  const data = { name: input.name, description: input.description ?? null, permissions };
  try {
    if (!input.isDefault) return serializeRole(await prisma.role.create({ data, include: roleInclude }));
    return await retryOnDefaultConflict(() =>
      prisma.$transaction(async (tx) => {
        await lockAccessChanges(tx);
        const { id } = await tx.role.create({ data, select: { id: true } });
        await makeDefault(tx, id);
        return getRole(id, tx);
      }, TX_OPTIONS),
    );
  } catch (err) {
    if (isDefaultConflict(err)) throw defaultChanged();
    if (isUniqueViolation(err)) throw roleNameTaken();
    throw err;
  }
}

export async function updateRole(id: string, input: Partial<RoleInput>, actor: Actor) {
  try {
    return await retryOnDefaultConflict(() => prisma.$transaction(async (tx) => {
      // Taking permissions away can lock everyone out: serialize with the other access-reducing changes. Changing
      // the default role is serialized the same way (exactly one default, even with concurrent requests).
      if (input.permissions !== undefined || input.isDefault) await lockAccessChanges(tx);
      const role = await tx.role.findUnique({ where: { id }, select: { permissions: true, isDefault: true } });
      if (!role) throw notFound("Role");

      let permissions: Permission[] | undefined;
      let removesAny = false;
      if (input.permissions !== undefined) {
        permissions = normalizePermissions(input.permissions);
        const old = new Set(normalizePermissions(role.permissions));
        // Only newly added permissions must be held by the actor; keeping what the role already has is fine.
        assertCanGrant(actor, permissions.filter((p) => !old.has(p)));
        const next = new Set<string>(permissions);
        removesAny = [...old].some((p) => !next.has(p));
      }
      // New accounts would get this role without anyone choosing it: the actor must hold all of it (as it is
      // after this change). Re-sending isDefault for the current default changes nothing.
      const makesDefault = input.isDefault === true && !role.isDefault;
      if (makesDefault) assertCanGrant(actor, permissions ?? normalizePermissions(role.permissions), defaultEscalation);
      if (input.name !== undefined && (await findRoleByName(tx, input.name, id))) throw roleNameTaken();

      await tx.role.update({
        where: { id },
        data: { name: input.name, description: input.description, permissions },
      });
      if (makesDefault) await makeDefault(tx, id);
      if (removesAny) await assertAccessRetained(tx);
      return getRole(id, tx);
    }, TX_OPTIONS));
  } catch (err) {
    if (isDefaultConflict(err)) throw defaultChanged();
    if (isUniqueViolation(err)) throw roleNameTaken();
    throw err;
  }
}

export async function deleteRole(id: string) {
  try {
    await prisma.$transaction(async (tx) => {
      // Serialized with "make default", so a role cannot become the default while it is being deleted.
      await lockAccessChanges(tx);
      const r = await tx.role.findUnique({ where: { id }, include: roleInclude });
      if (!r) throw notFound("Role");
      if (r.isDefault) throw roleIsDefault();
      // Any account counts, active or not: every account must keep a role.
      if (r._count.users > 0) throw roleInUse();
      await tx.role.delete({ where: { id } });
    }, TX_OPTIONS);
  } catch (err) {
    // An account was given this role meanwhile (onDelete: Restrict).
    if (isForeignKeyViolation(err)) throw roleInUse();
    throw err;
  }
}
