import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { requireAuth, requireAuthAllowingPasswordChange } from "./middleware/auth.js";
import { requireJsonForMutations } from "./middleware/json-only.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createLimiter } from "./middleware/rate-limit.js";
import { authRouter } from "./routes/auth.routes.js";
import { publicRouter } from "./routes/public.routes.js";
import { categoryRouter, libraryRouter } from "./routes/library.routes.js";
import { bookRouter } from "./routes/book.routes.js";
import { borrowerRouter } from "./routes/borrower.routes.js";
import { loanRouter } from "./routes/loan.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { permissionRouter, roleRouter } from "./routes/role.routes.js";
import { companyRouter, publicCompanyRouter } from "./routes/company.routes.js";
import { meRouter } from "./routes/me.routes.js";

export type AppOptions = {
  /** Enable IP rate limits (login, public form). Default true; tests usually turn it off. */
  rateLimit?: boolean;
  /** Allowed CORS origins (default: CORS_ORIGIN from env). */
  corsOrigins?: string[];
};

export function createApp(options: AppOptions = {}) {
  const rateLimitEnabled = options.rateLimit ?? true;
  const corsOrigins = options.corsOrigins ?? env.corsOrigins;

  const app = express();
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin ? false : corsOrigins.includes(origin) ? origin : false),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );
  if (env.trustProxy !== undefined) app.set("trust proxy", env.trustProxy);
  // JSON bodies are limited to 100kb, except bulk book imports (up to 500 rows of metadata), book pictures (a 1 MB
  // picture is ~1.4 MB as base64) and the company logo (512 KB is ~700 KB as base64). Larger bodies become 413
  // PAYLOAD_TOO_LARGE in the error handler.
  app.use("/api/books/bulk", express.json({ limit: "1mb" }));
  app.put("/api/books/:id/cover", express.json({ limit: "2mb" }));
  app.put("/api/company/logo", express.json({ limit: "1mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const api = express.Router();
  api.use(requireJsonForMutations);

  // Public
  // Login (every account, staff and borrowers alike): 10 failed attempts / 15 min / IP (successful sign-ins are not counted).
  api.use("/auth", authRouter(createLimiter(10, rateLimitEnabled, { countFailedOnly: true })));
  // Public borrow requests: 10 failed submissions and 60 submissions in total / 15 min / IP. Successful
  // requests only count toward the larger limit, because borrowers at one school or parish (and everyone
  // behind the dev/preview proxy) share an IP; the honeypot field is the main spam control.
  // Company name, logo and contact details for every page (no rate limit: every page load reads it).
  api.use("/public/company", publicCompanyRouter());
  api.use(
    "/public",
    publicRouter({
      request: [
        createLimiter(60, rateLimitEnabled),
        createLimiter(10, rateLimitEnabled, { countFailedOnly: true }),
      ],
      status: createLimiter(30, rateLimitEnabled),
    }),
  );

  // Signed-in accounts (login required; every endpoint checks its permission inside the routers — see
  // src/lib/permissions.ts)
  api.use("/libraries", requireAuth, libraryRouter());
  api.use("/categories", requireAuth, categoryRouter());
  api.use("/books", requireAuth, bookRouter());
  api.use("/borrowers", requireAuth, borrowerRouter());
  api.use("/loans", requireAuth, loanRouter());
  api.use("/dashboard", requireAuth, dashboardRouter());
  api.use("/users", requireAuth, userRouter());
  api.use("/roles", requireAuth, roleRouter());
  // The static permission catalog: also readable while a password change is still required (Profile settings).
  api.use("/permissions", requireAuthAllowingPasswordChange, permissionRouter());
  api.use("/company", requireAuth, companyRouter());
  // The signed-in account's own records ("My Books": the borrower linked to the account)
  // My Books. Requests sent while signed in: 60 / 15 min / IP, like the public borrow form.
  api.use("/me", requireAuth, meRouter({ request: createLimiter(60, rateLimitEnabled) }));

  api.use(notFoundHandler);
  app.use("/api", api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
