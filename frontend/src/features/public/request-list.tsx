import { MinusIcon, PlusIcon, ShoppingBasketIcon, Trash2Icon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { BookCover } from "@/features/books/book-cover"
import { REQUEST_LIMITS, type RequestLine } from "@/features/public/request-lines"

/** The books picked so far, with copies (1 to 5) and remove. `issues` marks lines the server refused, by bookId. */
export function RequestList({
  lines,
  onChange,
  issues,
  disabled,
  className,
}: {
  lines: RequestLine[]
  onChange: (lines: RequestLine[]) => void
  issues?: Record<string, string>
  disabled?: boolean
  className?: string
}) {
  const setQuantity = (bookId: string, quantity: number) =>
    onChange(
      lines.map((l) =>
        l.bookId === bookId ? { ...l, quantity: Math.min(REQUEST_LIMITS.maxQuantity, Math.max(1, quantity)) } : l,
      ),
    )
  const remove = (bookId: string) => onChange(lines.filter((l) => l.bookId !== bookId))

  if (lines.length === 0) {
    return (
      <div className={cn("flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground", className)}>
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <ShoppingBasketIcon className="size-5" aria-hidden />
        </span>
        <p>No books yet. Choose “Add” on the books you want.</p>
      </div>
    )
  }

  return (
    <ul className={cn("divide-y", className)}>
      {lines.map((line) => {
        const issue = issues?.[line.bookId]
        return (
          <li key={line.bookId} className={cn("flex gap-3 px-4 py-3", issue && "bg-destructive/5")} data-invalid={!!issue || undefined}>
            <BookCover src={line.coverUrl} className="w-10 rounded-sm [&_svg]:size-4" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{line.title}</p>
                {line.author && <p className="truncate text-xs text-muted-foreground">{line.author}</p>}
                {!line.available && <p className="text-xs text-amber-700 dark:text-amber-300">Out right now — you can still ask</p>}
                {issue && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {issue}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={disabled || line.quantity <= 1}
                  onClick={() => setQuantity(line.bookId, line.quantity - 1)}
                  aria-label={`Fewer copies of ${line.title}`}
                >
                  <MinusIcon />
                </Button>
                <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
                  {line.quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={disabled || line.quantity >= REQUEST_LIMITS.maxQuantity}
                  onClick={() => setQuantity(line.bookId, line.quantity + 1)}
                  aria-label={`More copies of ${line.title}`}
                >
                  <PlusIcon />
                </Button>
                <span className="ml-1 text-xs text-muted-foreground">{line.quantity === 1 ? "copy" : "copies"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  disabled={disabled}
                  onClick={() => remove(line.bookId)}
                  aria-label={`Remove ${line.title}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
