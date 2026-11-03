import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import { isForeignKeyViolation, isRecordNotFound, isTransactionConflict } from "../lib/prisma-errors.js";

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", "The requested endpoint does not exist."));
};

type BodyParserError = Error & { type?: string; status?: number };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let httpErr: HttpError;
  if (err instanceof HttpError) {
    httpErr = err;
  } else if ((err as BodyParserError)?.type === "entity.parse.failed") {
    httpErr = new HttpError(400, "VALIDATION_ERROR", "The request body is not valid JSON.", { issues: [] });
  } else if ((err as BodyParserError)?.type === "entity.too.large") {
    httpErr = new HttpError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  } else if ((err as BodyParserError)?.type === "encoding.unsupported" || (err as BodyParserError)?.type === "charset.unsupported") {
    httpErr = new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported request encoding.");
  } else if (isRecordNotFound(err)) {
    httpErr = new HttpError(404, "NOT_FOUND", "Resource not found.");
  } else if (isForeignKeyViolation(err) || isTransactionConflict(err)) {
    // Safety net for races the services do not map to a specific code (they lock or map the known ones).
    console.warn("[conflict]", (err as Error).message);
    httpErr = new HttpError(409, "CONFLICT", "The data changed while your request was being processed. Please refresh and try again.");
  } else {
    console.error("[error]", err);
    httpErr = new HttpError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }

  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code: httpErr.code, message: httpErr.message },
  };
  if (httpErr.details !== undefined) body.error.details = httpErr.details;
  if (res.headersSent) return;
  res.status(httpErr.status).json(body);
};
