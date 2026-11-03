import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { HttpError } from "../lib/http-error.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export type LimiterOptions = {
  windowMs?: number;
  /**
   * Only count requests that fail (status >= 400). Used for login and public borrow requests: staff and
   * borrowers often share one public IP (school / parish network), so successful requests must not lock
   * everyone out.
   */
  countFailedOnly?: boolean;
};

/** Creates an IP rate limiter (fresh in-memory store per call) or a no-op when disabled. */
export function createLimiter(limit: number, enabled: boolean, options: LimiterOptions = {}): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: options.windowMs ?? FIFTEEN_MINUTES,
    limit,
    skipSuccessfulRequests: options.countFailedOnly ?? false,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new HttpError(429, "RATE_LIMITED", "Too many requests. Please wait a few minutes and try again."));
    },
  });
}
