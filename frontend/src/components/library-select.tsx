import type { Ref } from "react"
import { cn } from "cn"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Library } from "@/types/api"

/** A required "pick one library" select (forms that need a single library). */
export function LibrarySelect({
  id,
  libraries,
  value,
  onChange,
  invalid,
  disabled,
  placeholder = "Choose a library",
  className,
  itemClassName,
  describedBy,
  triggerRef,
}: {
  id?: string
  libraries: Pick<Library, "id" | "name">[]
  value: string | null
  onChange: (id: string) => void
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
  /** Extra classes for the box (e.g. the large controls). */
  className?: string
  itemClassName?: string
  describedBy?: string
  /** Lets a form focus the box (e.g. react-hook-form's field.ref). */
  triggerRef?: Ref<HTMLButtonElement>
}) {
  const items = libraries.map((l) => ({ value: l.id, label: l.name }))
  return (
    <Select
      items={items}
      value={value ?? null}
      onValueChange={(v) => {
        if (typeof v === "string" && v) onChange(v)
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} ref={triggerRef} className={cn("w-full", className)} aria-invalid={invalid} aria-describedby={describedBy}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className={itemClassName}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
