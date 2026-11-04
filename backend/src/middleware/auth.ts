import type { CookieOptions, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/http-error.js";
import { hasAllPermissions, normalizePermissions, type Permission } from "../lib/permissions.js";

export const AUTH_COOKIE = "lms_token";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: { id: string; name: string };
  active: boolean;
  mustChangePassword: boolean;
  /** The borrower this account is linked to (its "My Books"), if any. */
  borrower: { id: string; name: string } | null;
  createdAt: Date;
  /** The permissions of the user's role (normalized), re-read on every request. */
  permissions: Permission[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: env.isProduction,
  path: "/",
});

/**
 * Issues the session cookie. The token carries the user's `tokenVersion`; bumping that column (password change or
 * reset, deactivation, logout) invalidates every token issued before.
 */
export function setAuthCookie(res: Response, user: { id: string; tokenVersion: number }) {
  const token = jwt.sign({ sub: user.id, ver: user.tokenVersion }, env.jwtSecret, {
    expiresIn: TOKEN_TTL_SECONDS,
    algorithm: "HS256",
  });
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions(), maxAge: TOKEN_TTL_SECONDS * 1000 });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE, cookieOptions());
}

const unauthenticated = () => new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue.");

/** The columns of a `User` response (role and linked borrower as `{ id, name }`). */
export const userSelect = {
  id: true,
  email: true,
  name: true,
  role: { select: { id: true, name: true } },
  active: true,
  mustChangePassword: true,
  borrower: { select: { id: true, name: true } },
  createdAt: true,
} as const;

/** `userSelect` plus the role's permissions (for `Me` and `req.user`). */
export const meSelect = {
  ...userSelect,
  role: { select: { id: true, name: true, permissions: true } },
} as const;

/** Splits a row loaded with `meSelect` into the `User` part and its normalized permissions. */
export function withPermissions<T extends { role: { id: string; name: string; permissions: string[] } }>(row: T) {
  const { role, ...rest } = row;
  return { ...rest, role: { id: role.id, name: role.name }, permissions: normalizePermissions(role.permissions) };
}

export type TokenClaims = { id: string; version: number };

/** The claims of a validly signed, unexpired token from the request cookie, or null. */
export function readAuthToken(req: Request): TokenClaims | null {
  const token: unknown = req.cookies?.[AUTH_COOKIE];
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || typeof payload.sub !== "string" || !Number.isInteger(payload.ver)) return null;
    // Tokens with a `kind` were issued by the former borrower portal (kind "borrower", subject = a borrower id):
    // never accepted. Those borrowers now sign in again with their account (same email and password).
    if (payload.kind !== undefined) return null;
    return { id: payload.sub, version: payload.ver as number };
  } catch {
    return null;
  }
}

/** The active user of a token whose tokenVersion still matches, with their role's permissions. */
export async function authenticateUser(claims: TokenClaims | null): Promise<AuthUser> {
  if (!claims) throw unauthenticated();
  const user = await prisma.user.findUnique({ where: { id: claims.id }, select: { ...meSelect, tokenVersion: true } });
  if (!user || !user.active || user.tokenVersion !== claims.version) throw unauthenticated();
  const { tokenVersion: _v, ...authUser } = user;
  return withPermissions(authUser);
}

/**
 * Requires a valid token for an active user whose tokenVersion still matches, like `requireAuth`, but also lets
 * in an account that must still change its given password. Only for what that account needs to change it
 * (PATCH /auth/password) and for harmless, non-data reads (the permission catalog).
 */
export const requireAuthAllowingPasswordChange: RequestHandler = async (req, _res, next) => {
  req.user = await authenticateUser(readAuthToken(req));
  next();
};

/**
 * Requires a valid token for an active user whose tokenVersion still matches. The user and their role's
 * permissions are re-loaded on every request, so a role or permission change applies at once (no re-login).
 * An account that must still change its password (`mustChangePassword`: the default password from an acceptance
 * email, known to every accepted borrower) gets 403 PASSWORD_CHANGE_REQUIRED here: the forced change is enforced
 * by the API, not only by the app's redirect, so knowing the default password never opens anyone's data.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const user = await authenticateUser(readAuthToken(req));
  if (user.mustChangePassword) {
    throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED", "Change your password before you continue.");
  }
  req.user = user;
  next();
};

export const forbidden = () => new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");

/** The user must hold ALL of `perms` (403 FORBIDDEN otherwise). Nobody bypasses this, whatever their role. */
export function requirePermission(...perms: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw unauthenticated();
    if (!hasAllPermissions(req.user.permissions, perms)) throw forbidden();
    next();
  };
}

/** The user must hold at least one of `perms` (403 FORBIDDEN otherwise). */
export function requireAnyPermission(...perms: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw unauthenticated();
    if (!perms.some((p) => req.user!.permissions.includes(p))) throw forbidden();
    next();
  };
}

/** The authenticated user (only valid behind `requireAuth`). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
