import { Router, type RequestHandler } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/http-error.js";
import { validateBody } from "../middleware/validate.js";
import { clearAuthCookie, currentUser, readAuthToken, requireAuth, setAuthCookie, userSelect } from "../middleware/auth.js";
import { newPassword as newPasswordField } from "../lib/validation.js";
import { serializeUser } from "../services/serializers.js";
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

  r.post("/login", loginLimiter, validateBody(loginSchema), async (req, res) => {
    const { email, password } = req.body as z.output<typeof loginSchema>;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { ...userSelect, passwordHash: true, tokenVersion: true },
    });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
    }
    setAuthCookie(res, user);
    res.json({ user: serializeUser(user) });
  });

  // Ends the session server-side too: bumping tokenVersion invalidates this token and any copy of it
  // (and the user's sessions on other devices), not just the browser's cookie.
  r.post("/logout", async (req, res) => {
    const claims = readAuthToken(req);
    if (claims) {
      await prisma.user.updateMany({
        where: { id: claims.userId, tokenVersion: claims.version },
        data: { tokenVersion: { increment: 1 } },
      });
    }
    clearAuthCookie(res);
    res.status(204).end();
  });

  r.get("/me", requireAuth, (req, res) => {
    res.json({ user: serializeUser(currentUser(req)) });
  });

  r.patch("/password", requireAuth, validateBody(passwordSchema), async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.output<typeof passwordSchema>;
    const me = currentUser(req);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(currentPassword, row.passwordHash))) {
      throw new HttpError(400, "WRONG_PASSWORD", "Your current password is incorrect.");
    }
    // Invalidate every existing session (e.g. a copied cookie), then keep this one signed in.
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
      select: { id: true, tokenVersion: true },
    });
    setAuthCookie(res, updated);
    res.status(204).end();
  });

  return r;
}
