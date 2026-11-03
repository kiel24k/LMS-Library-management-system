import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  isFetching,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  isFetching?: boolean
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0 || (totalPages <= 1 && page <= totalPages)) return null

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-end gap-2 pt-2 text-sm">
      {page > totalPages && <p className="mr-auto text-muted-foreground">No more pages</p>}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || isFetching}
          onClick={() => onPageChange(Math.min(page - 1, totalPages))}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          Previous
        </Button>
        <span className="px-2 text-muted-foreground tabular-nums">
          Page {Math.min(page, totalPages)} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || isFetching}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </nav>
  )
}
