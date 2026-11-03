import { z } from "zod";
import { validationError, type Issue } from "./http-error.js";
import { isValidDateOnly } from "./dates.js";

/** Converts zod issues to the API's `details.issues` shape. */
export function toIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p === "string" || typeof p === "number"),
    message: i.message,
  }));
}

/** Parses `input` with `schema`, throwing 400 VALIDATION_ERROR on failure. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(toIssues(result.error));
  return result.data;
}

const trimIfString = (v: unknown) => (typeof v === "string" ? v.trim() : v);
const emptyToNull = (v: unknown) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
};

/** Required string: trimmed, length min..max. */
export const reqStr = (min: number, max: number) =>
  z.preprocess(
    trimIfString,
    z
      .string({ error: "Required." })
      .min(min, min <= 1 ? "Required." : `Must be at least ${min} characters.`)
      .max(max, `Must be at most ${max} characters.`),
  );

/**
 * Optional, nullable string: trimmed; "" → null. `undefined` stays undefined (PATCH: unchanged;
 * create: stored as null by the caller).
 */
export const optStr = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max, `Must be at most ${max} characters.`).nullable().optional());

/** Optional integer that also accepts null (to clear) — e.g. publicationYear. */
export const optInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .number({ error: "Must be a number." })
      .int("Must be a whole number.")
      .min(min, `Must be at least ${min}.`)
      .max(max, `Must be at most ${max}.`)
      .nullable()
      .optional(),
  );

/**
 * A new password: 8+ characters and at most 72 bytes in UTF-8, because bcrypt ignores everything after
 * byte 72 (accented letters take 2 bytes, most emoji 4, so the character limit alone is not enough).
 */
export const newPassword = () =>
  z
    .string({ error: "Required." })
    .min(8, "Must be at least 8 characters.")
    .refine(
      (p) => Buffer.byteLength(p, "utf8") <= 72,
      "Must be at most 72 characters (accented letters and emoji count as 2–4).",
    );

export const intIn = (min: number, max: number) =>
  z
    .number({ error: "Must be a number." })
    .int("Must be a whole number.")
    .min(min, `Must be at least ${min}.`)
    .max(max, `Must be at most ${max}.`);

export const id = () => z.preprocess(trimIfString, z.string({ error: "Required." }).min(1, "Required.").max(64));

/** YYYY-MM-DD calendar date string. */
export const dateOnly = () =>
  z.preprocess(
    trimIfString,
    z.string({ error: "Required." }).refine(isValidDateOnly, "Must be a valid date (YYYY-MM-DD)."),
  );

/** Query boolean: the strings "true"/"false"; omitted → undefined. */
export const queryBool = () =>
  z
    .enum(["true", "false"], { error: 'Must be "true" or "false".' })
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"));

/** Optional query string (trimmed; "" → undefined). */
export const queryStr = (max = 200) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v),
    z.string().max(max).optional(),
  );

export const pagination = (maxPageSize = 100) => ({
  page: z.coerce.number({ error: "Must be a number." }).int().min(1, "Must be at least 1.").default(1),
  pageSize: z.coerce
    .number({ error: "Must be a number." })
    .int()
    .min(1, "Must be at least 1.")
    .max(maxPageSize, `Must be at most ${maxPageSize}.`)
    .default(20),
});

export type Page = { page: number; pageSize: number };
export const skipTake = ({ page, pageSize }: Page) => ({ skip: (page - 1) * pageSize, take: pageSize });

/** Turns undefined into null (for create payloads where optional fields are stored as null). */
export const nn = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

/** A route parameter as a plain string (Express 5 types allow string[] for wildcard params). */
export function param(req: { params: Record<string, string | string[] | undefined> }, name = "id"): string {
  const v = req.params[name];
  return Array.isArray(v) ? v.join("/") : (v ?? "");
}
