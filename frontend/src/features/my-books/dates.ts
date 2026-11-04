import { todayInManila } from "@/lib/format"

const DAY_MS = 86_400_000

/** "2026-11-10" → a UTC midnight timestamp; the calendar day never shifts with the viewer's time zone. */
function dayValue(date: string): number {
  const [y, m, d] = date.split("-").map(Number)
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1)
}

const friendlyFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
})

/** A `YYYY-MM-DD` due date as "Tue, Nov 10, 2026" (returned as-is when it isn't a date). */
export function formatFriendlyDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  return friendlyFmt.format(new Date(dayValue(date)))
}

/** Whole days from today (Asia/Manila) until `date`: 0 = today, negative = past. */
export function daysUntil(date: string): number {
  return Math.round((dayValue(date) - dayValue(todayInManila())) / DAY_MS)
}

/** "Due today", "Due tomorrow", "Due in 5 days" (null once it is past due — the overdue badge says that). */
export function dueInText(date: string): string | null {
  const days = daysUntil(date)
  if (days < 0) return null
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  return `Due in ${days} days`
}
