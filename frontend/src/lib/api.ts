import type { ValidationIssue } from "@/types/api"

/** Error thrown for every non-2xx API response (and network failures, status 0). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }

  /** `details.issues` of a VALIDATION_ERROR, or an empty list. */
  get issues(): ValidationIssue[] {
    if (this.code !== "VALIDATION_ERROR") return []
    const d = this.details as { issues?: unknown } | null | undefined
    return Array.isArray(d?.issues) ? (d.issues as ValidationIssue[]) : []
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code)
}

/** A user-facing message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "Something went wrong. Please try again."
}

type UnauthenticatedHandler = () => void
let onUnauthenticated: UnauthenticatedHandler | null = null

/** Registered once at startup: called whenever the API answers 401 UNAUTHENTICATED. */
export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | null) {
  onUnauthenticated = handler
}

type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

/** Builds `?a=1&b=2`, skipping undefined / null / empty-string values. */
export function toQueryString(params?: QueryParams): string {
  if (!params) return ""
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ""
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  const init: RequestInit = { method, credentials: "include", headers, signal }
  if (method !== "GET") {
    // The API requires Content-Type: application/json on every state-changing request.
    headers["Content-Type"] = "application/json"
    init.body = JSON.stringify(body ?? {})
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Check your connection and try again.")
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    const apiError = new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? defaultMessage(res.status),
      err?.details,
    )
    if (res.status === 401 && apiError.code === "UNAUTHENTICATED") onUnauthenticated?.()
    throw apiError
  }

  return data as T
}

function defaultMessage(status: number): string {
  if (status === 404) return "Not found."
  if (status === 429) return "Too many requests. Please wait a moment and try again."
  if (status >= 500) return "The server had a problem. Please try again."
  return `Request failed (${status}).`
}

export const api = {
  get: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    request<T>("GET", path + toQueryString(params), undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
}
