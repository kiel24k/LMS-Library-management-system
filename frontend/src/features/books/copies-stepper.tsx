import { MinusIcon, PlusIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BIG_INPUT, BIG_LABEL, FOCUS } from "@/features/books/big-controls"
import { MAX_COPIES } from "@/features/books/paste-books"

const STEP_BUTTON = cn("size-12 text-xl [&_svg:not([class*='size-'])]:size-5", FOCUS)

/** Number of copies with big − / + buttons (min to max, 1 to MAX_COPIES by default); the arrow keys also step it. */
export function CopiesStepper({
  id,
  inputRef,
  bookNumber,
  value,
  count,
  min = 1,
  max = MAX_COPIES,
  invalid,
  describedBy,
  disabled,
  onChange,
  onCapped,
}: {
  id: string
  inputRef?: (el: HTMLInputElement | null) => void
  /** The row number on "Add many books" (read out by screen readers); leave out for a single book. */
  bookNumber?: number
  value: string
  count: number
  min?: number
  max?: number
  invalid: boolean
  describedBy: string | undefined
  disabled: boolean
  onChange: (value: string) => void
  /** Called when a typed number above the limit is turned into the limit. */
  onCapped?: () => void
}) {
  const step = (by: number) => onChange(String(Math.min(Math.max(count + by, min), max)))
  const ofBook = bookNumber === undefined ? "" : ` of book ${bookNumber}`
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className={BIG_LABEL}>
        Copies{ofBook && <span className="sr-only">{ofBook}</span>}
      </Label>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          className={STEP_BUTTON}
          onClick={() => step(-1)}
          disabled={disabled || count <= min}
          aria-label={`Fewer copies${ofBook}`}
        >
          <MinusIcon />
        </Button>
        <Input
          id={id}
          ref={inputRef}
          inputMode="numeric"
          className={cn(BIG_INPUT, "w-20 text-center tabular-nums")}
          value={value}
          // Keep what is typed (even above the limit) until the box is left, then say if it was lowered.
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 5))}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
            e.preventDefault()
            step(e.key === "ArrowUp" ? 1 : -1)
          }}
          onBlur={() => {
            if (value === String(count)) return
            onChange(String(count))
            if (Number.parseInt(value, 10) > max) onCapped?.()
          }}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          disabled={disabled}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="outline"
          className={STEP_BUTTON}
          onClick={() => step(1)}
          disabled={disabled || count >= max}
          aria-label={`More copies${ofBook}`}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}
