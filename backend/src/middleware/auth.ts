import type { CookieOptions, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/http-error.js";
import type { Role } from "../generated/prisma/enums.js";

export const AUTH_COOKIE = "lms_token";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: Date;
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
 * Issues the session cookie. The token carries the user's `tokenVersion`; bumping that column (password
 * change or reset, deactivation, logout) invalidates every token issued before.
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

export const userSelect = { id: true, email: true, name: true, role: true, active: true, createdAt: true } as const;

/** The claims of a validly signed, unexpired token from the request cookie, or null. */
export function readAuthToken(req: Request): { userId: string; version: number } | null {
  const token: unknown = req.cookies?.[AUTH_COOKIE];
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || typeof payload.sub !== "string" || !Number.isInteger(payload.ver)) return null;
    return { userId: payload.sub, version: payload.ver as number };
  } catch {
    return null;
  }
}

/**
 * Requires a valid token for an active user whose tokenVersion still matches; the user is re-loaded on
 * every request.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const claims = readAuthToken(req);
  if (!claims) throw unauthenticated();
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, select: { ...userSelect, tokenVersion: true } });
  if (!user || !user.active || user.tokenVersion !== claims.version) throw unauthenticated();
  const { tokenVersion: _v, ...authUser } = user;
  req.user = authUser;
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw unauthenticated();
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");
    }
    next();
  };
}

export const requireAdmin = requireRole("ADMIN");

/** The authenticated user (only valid behind `requireAuth`). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
