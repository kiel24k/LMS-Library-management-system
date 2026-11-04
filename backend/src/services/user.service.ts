import bcrypt from "bcryptjs";
import { prisma, TX_OPTIONS, type Db } from "../lib/prisma.js";
import { HttpError, notFound, validationError } from "../lib/http-error.js";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/prisma-errors.js";
import { normalizePermissions, type Permission } from "../lib/permissions.js";
import { forbidden, userSelect } from "../middleware/auth.js";
import { serializeUser } from "./serializers.js";
import {
  assertAccessRetained,
  assertCanGrant,
  lockAccessChanges,
  findDefaultRole,
  permissionEscalation,
  type Actor,
} from "./role.service.js";

export const BCRYPT_COST = 10;
export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

const roleNotFound = () => validationError([{ path: ["roleId"], message: "Role not found." }]);
const noDefaultRole = () => validationError([{ path: ["roleId"], message: "Choose a role (no default role is set)." }]);
const defaultRoleEscalation = () =>
  permissionEscalation("The default role has permissions you don't have. Choose a role for this account.");
const cannotManageAccount = () =>
  permissionEscalation("You can't change an account that has permissions you don't have.");
const emailTaken = () => new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists.");

/**
 * The role an account is about to get: 400 VALIDATION_ERROR on `roleId` when it does not exist, 403
 * PERMISSION_ESCALATION when it holds a permission the actor does not have.
 */
async function assignableRole(db: Db, roleId: string, actor: Actor) {
  const role = await db.role.findUnique({ where: { id: roleId }, select: { permissions: true } });
  if (!role) throw roleNotFound();
  assertCanGrant(actor, normalizePermissions(role.permissions));
}

export async function listUsers() {
  const rows = await prisma.user.findMany({ select: userSelect, orderBy: [{ name: "asc" }, { email: "asc" }] });
  return { data: rows.map(serializeUser) };
}

/**
 * `roleId` missing → the default role (400 VALIDATION_ERROR on `roleId` when none is set). Either way the actor
 * must hold every permission of the role the account gets (403 PERMISSION_ESCALATION).
 */
export async function createUser(input: { email: string; name: string; password: string; roleId?: string }, actor: Actor) {
  let roleId = input.roleId;
  if (roleId !== undefined) {
    await assignableRole(prisma, roleId, actor);
  } else {
    const role = await findDefaultRole();
    if (!role) throw noDefaultRole();
    assertCanGrant(actor, normalizePermissions(role.permissions), defaultRoleEscalation);
    roleId = role.id;
  }
  try {
    const u = await prisma.user.create({
      data: { email: input.email, name: input.name, roleId, passwordHash: await hashPassword(input.password) },
      select: userSelect,
    });
    return serializeUser(u);
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTaken();
    if (isForeignKeyViolation(err)) throw roleNotFound(); // the role was deleted meanwhile
    throw err;
  }
}

export type UserPatch = { name?: string; roleId?: string; active?: boolean; password?: string };

/** The permission each PATCH /users/:id field needs. */
const FIELD_PERMISSIONS: { [K in keyof Required<UserPatch>]: Permission } = {
  name: "users.update",
  roleId: "users.update",
  active: "users.deactivate",
  password: "users.reset_password",
};

export async function updateUser(id: string, input: UserPatch, actor: Actor & { roleId: string }) {
  // Every field sent needs its own permission; one missing rejects the whole request (nothing changes).
  for (const [field, perm] of Object.entries(FIELD_PERMISSIONS) as [keyof UserPatch, Permission][]) {
    if (input[field] !== undefined && !actor.permissions.includes(perm)) throw forbidden();
  }
  if (id === actor.id && (input.active === false || (input.roleId !== undefined && input.roleId !== actor.roleId))) {
    throw new HttpError(409, "SELF_MODIFICATION", "You cannot deactivate your own account or change your own role.");
  }
  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;
  try {
    const u = await prisma.$transaction(async (tx) => {
      // A role change or deactivation can leave nobody able to manage users and roles: serialize those changes
      // (two admins deactivating each other at once) and check afterwards.
      const mayReduceAccess = input.roleId !== undefined || input.active === false;
      if (mayReduceAccess) await lockAccessChanges(tx);
      const target = await tx.user.findUnique({
        where: { id },
        select: { roleId: true, role: { select: { permissions: true } } },
      });
      if (!target) throw notFound("User");
      // Resetting the password, (de)activating or changing the role of an account that can do more than the
      // actor would let them take it over (or lock its owner out): the target must hold nothing the actor lacks.
      const roleChanges = input.roleId !== undefined && input.roleId !== target.roleId;
      if (id !== actor.id && (input.password !== undefined || input.active !== undefined || roleChanges)) {
        assertCanGrant(actor, normalizePermissions(target.role.permissions), cannotManageAccount);
      }
      // Re-sending the current role is not a grant; only a change must stay within the actor's permissions.
      if (roleChanges) await assignableRole(tx, input.roleId!, actor);
      // A password reset or deactivation signs the user out everywhere (invalidates all their tokens).
      const revokeSessions = passwordHash !== undefined || input.active === false;
      const updated = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          roleId: input.roleId,
          active: input.active,
          passwordHash,
          ...(revokeSessions ? { tokenVersion: { increment: 1 } } : {}),
        },
        select: { ...userSelect, tokenVersion: true },
      });
      if (mayReduceAccess) await assertAccessRetained(tx);
      return updated;
    }, TX_OPTIONS);
    return { user: serializeUser(u), tokenVersion: u.tokenVersion };
  } catch (err) {
    if (isForeignKeyViolation(err)) throw roleNotFound(); // the role was deleted meanwhile
    throw err;
  }
}
