import { ApiError } from "@/lib/api"
import type { InsufficientCopiesDetails, InvalidBooksDetails } from "@/types/api"

/**
 * Maps INVALID_BOOKS / INSUFFICIENT_COPIES / item-level VALIDATION_ERROR issues
 * onto the affected lines (keyed by bookId). Returns null when nothing maps.
 */
export function lineIssuesFromError(
  error: unknown,
  lines: { bookId: string }[],
): Record<string, string> | null {
  if (!(error instanceof ApiError)) return null
  const issues: Record<string, string> = {}

  if (error.code === "INVALID_BOOKS") {
    const ids = (error.details as InvalidBooksDetails | undefined)?.bookIds ?? []
    for (const id of ids) {
      issues[id] = "Can't be borrowed. Remove it."
    }
  } else if (error.code === "INSUFFICIENT_COPIES") {
    const books = (error.details as InsufficientCopiesDetails | undefined)?.books ?? []
    for (const b of books) {
      issues[b.bookId] =
        b.available > 0
          ? `Only ${b.available} available. Lower the copies.`
          : "No copies available."
    }
  } else if (error.code === "VALIDATION_ERROR") {
    for (const issue of error.issues) {
      if (issue.path[0] === "items" && typeof issue.path[1] === "number") {
        const line = lines[issue.path[1]]
        if (line) issues[line.bookId] = issue.message
      }
    }
  }

  return Object.keys(issues).length > 0 ? issues : null
}
