export const APP_TIMEZONE = "Asia/Manila"

/** 123 → "BR-000123" (numbers above 999999 are not truncated). */
export function formatLoanNumber(n: number): string {
  return `BR-${String(n).padStart(6, "0")}`
}

/**
 * Reads a typed reference number: "BR-000123", "br-123", "BR000123", the older "LN-000123" / "ln-123",
 * or just "123". Returns the number, or null when the text is not a reference number.
 */
export function parseRefNumber(input: string): number | null {
  const m = /^\s*(?:(?:BR|LN)\s*-?\s*)?0*(\d{1,9})\s*$/i.exec(input)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

/** Canonical "BR-000123" form of a typed reference number; other text is returned trimmed. */
export function normalizeRefNumber(input: string): string {
  const n = parseRefNumber(input)
  return n === null ? input.trim() : formatLoanNumber(n)
}

const dateTimeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

const dateFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
})

/** ISO timestamp → "Nov 3, 2026, 10:15 AM" in Asia/Manila. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d)
}

/** ISO timestamp → "Nov 3, 2026" in Asia/Manila. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d)
}

/**
 * A `YYYY-MM-DD` due date is shown as-is: it is never parsed through `new Date()`,
 * which could shift the day.
 */
export function formatDueDate(date: string | null | undefined): string {
  return date ?? "—"
}

/** Today's date in Asia/Manila as `YYYY-MM-DD` (used for date-input `min`). */
export function todayInManila(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** "5 minutes ago" style text for an ISO timestamp. */
export function formatRelative(iso: string): string {
  const d = new Date(iso)
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(diffSec, "second")
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour")
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day")
  return formatDate(iso)
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

/** Normalizes a person's name for comparison (case, extra spaces). */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

/** Only accept relative, same-origin paths as a post-login redirect. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/"
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/"
  return next
}
