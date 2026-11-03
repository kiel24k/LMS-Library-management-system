import type { RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * State-changing requests must declare `Content-Type: application/json` (CSRF mitigation together
 * with SameSite=Lax cookies: plain HTML forms cannot send that content type cross-site).
 */
export const requireJsonForMutations: RequestHandler = (req, _res, next) => {
  if (STATE_CHANGING.has(req.method) && !req.is("application/json")) {
    return next(
      new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Requests that change data must be sent as JSON (Content-Type: application/json)."),
    );
  }
  next();
};
