export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_BOOKS"
  | "INVALID_CATEGORY"
  | "RETURN_EXCEEDS_OUTSTANDING"
  | "INVALID_IMAGE"
  | "WRONG_PASSWORD"
  | "NO_EMAIL"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PASSWORD_CHANGE_REQUIRED"
  | "NOT_FOUND"
  | "INSUFFICIENT_COPIES"
  | "INVALID_STATUS"
  | "SLUG_TAKEN"
  | "CATEGORY_EXISTS"
  | "EMAIL_TAKEN"
  | "ID_NUMBER_TAKEN"
  | "EMAIL_MISMATCH"
  | "NOT_LINKED"
  | "LIBRARY_NOT_EMPTY"
  | "BOOK_HAS_LOANS"
  | "BORROWER_HAS_LOANS"
  | "COPIES_IN_USE"
  | "ROLE_NAME_TAKEN"
  | "ROLE_IN_USE"
  | "ROLE_IS_DEFAULT"
  | "ACCESS_LOCKOUT"
  | "SELF_MODIFICATION"
  | "PERMISSION_ESCALATION"
  | "CONFLICT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "IMAGE_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type Issue = { path: (string | number)[]; message: string };

export const validationError = (issues: Issue[], message = "Some fields are invalid.") =>
  new HttpError(400, "VALIDATION_ERROR", message, { issues });

export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found.`);

export const invalidStatus = (status: string, message?: string) =>
  new HttpError(409, "INVALID_STATUS", message ?? `This action is not allowed while the borrow record is ${status}.`, { status });
