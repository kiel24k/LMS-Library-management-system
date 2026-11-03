import { Badge } from "@/components/ui/badge"
import type { Book } from "@/types/api"

export function AvailabilityBadge({ book }: { book: Pick<Book, "availableCopies" | "totalCopies"> }) {
  const none = book.availableCopies === 0
  return (
    <Badge
      variant="outline"
      className={
        none
          ? "border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300"
          : "border-emerald-300 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300"
      }
    >
      {book.availableCopies}/{book.totalCopies} available
    </Badge>
  )
}
