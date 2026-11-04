import { Router, type RequestHandler } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { HttpError, validationError } from "../lib/http-error.js";
import { validateBody } from "../middleware/validate.js";
import {
  authenticateUser,
  clearAuthCookie,
  currentUser,
  meSelect,
  readAuthToken,
  requireAuthAllowingPasswordChange,
  setAuthCookie,
  withPermissions,
} from "../middleware/auth.js";
import { newPassword as newPasswordField } from "../lib/validation.js";
import { serializeMe } from "../services/serializers.js";
import { hashPassword } from "../services/user.service.js";

const loginSchema = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string({ error: "Required." }).min(1, "Required.").max(254)),
  password: z.string({ error: "Required." }).min(1, "Required.").max(200),
});

const passwordSchema = z.object({
  currentPassword: z.string({ error: "Required." }).min(1, "Required.").max(200),
  newPassword: newPasswordField(),
});

// A real bcrypt hash used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

export function authRouter(loginLimiter: RequestHandler) {
  const r = Router();

  // One kind of account for everyone (staff, and borrowers whose request was accepted); what each can open is
  // decided by their role's permissions.
  r.post("/login", loginLimiter, validateBody(loginSchema), async (req, res) => {
    const { email, password } = req.body as z.output<typeof loginSchema>;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { ...meSelect, passwordHash: true, tokenVersion: true },
    });
    // Always run bcrypt once, so the response time does not reveal whether the email exists.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) throw new HttpError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
    setAuthCookie(res, user);
    // A role without any permissions can still sign in; the app then simply shows nothing to open.
    const { passwordHash: _h, tokenVersion: _v, ...row } = user;
    res.json({ user: serializeMe(withPermissions(row)) });
  });

  // Ends the session server-side too: bumping tokenVersion invalidates this token and any copy of it (and the
  // user's sessions on other devices), not just the browser's cookie.
  r.post("/logout", async (req, res) => {
    const claims = readAuthToken(req);
    if (claims) {
      await prisma.user.updateMany({
        where: { id: claims.id, tokenVersion: claims.version },
        data: { tokenVersion: { increment: 1 } },
      });
    }
    clearAuthCookie(res);
    res.status(204).end();
  });

  r.get("/me", async (req, res) => {
    res.json({ user: serializeMe(await authenticateUser(readAuthToken(req))) });
  });

  // The one call an account held on its given password may make (requireAuth would refuse it).
  r.patch("/password", requireAuthAllowingPasswordChange, validateBody(passwordSchema), async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.output<typeof passwordSchema>;
    const me = currentUser(req);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: me.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    // The default password is in every acceptance email, so a forced change can never go back to it.
    if (row.mustChangePassword && newPassword === env.borrowerDefaultPassword) {
      throw validationError([{ path: ["newPassword"], message: "Choose a password other than the default one." }]);
    }
    if (!(await bcrypt.compare(currentPassword, row.passwordHash))) {
      throw new HttpError(400, "WRONG_PASSWORD", "Your current password is incorrect.");
    }
    // Invalidate every existing session (e.g. a copied cookie), then keep this one signed in.
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, tokenVersion: { increment: 1 } },
      select: { id: true, tokenVersion: true },
    });
    setAuthCookie(res, updated);
    res.status(204).end();
  });

  return r;
}
