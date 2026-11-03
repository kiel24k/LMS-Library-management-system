import type { RequestHandler } from "express";
import type { z } from "zod";
import { parseOrThrow } from "../lib/validation.js";

/** Validates and normalizes `req.body` (replaced by the parsed value). */
export function validateBody<S extends z.ZodType>(schema: S): RequestHandler {
  return (req, _res, next) => {
    req.body = parseOrThrow(schema, req.body ?? {});
    next();
  };
}

/**
 * Validates `req.query` and stores the parsed value in `res.locals.query`
 * (Express 5's `req.query` is read-only). Read it with `getQuery<typeof schema>(res)`.
 */
export function validateQuery<S extends z.ZodType>(schema: S): RequestHandler {
  return (req, res, next) => {
    res.locals.query = parseOrThrow(schema, req.query);
    next();
  };
}

export function getQuery<S extends z.ZodType>(res: { locals: Record<string, unknown> }): z.output<S> {
  return res.locals.query as z.output<S>;
}
