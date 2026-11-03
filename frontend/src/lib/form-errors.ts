import type { FieldValues, Path, UseFormSetError } from "react-hook-form"

import { ApiError } from "@/lib/api"

/**
 * Maps a VALIDATION_ERROR's `details.issues` onto react-hook-form fields.
 * `fieldMap` translates API field names to form field names when they differ.
 * Returns true when at least one issue was mapped onto a known field.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
  fieldMap: Record<string, string> = {},
): boolean {
  if (!(error instanceof ApiError)) return false
  let mapped = false
  for (const issue of error.issues) {
    const apiPath = issue.path.map(String).join(".")
    const name = fieldMap[apiPath] ?? apiPath
    if (knownFields.includes(name)) {
      setError(name as Path<T>, { type: "server", message: issue.message })
      mapped = true
    }
  }
  return mapped
}
