import { useState } from "react"
import { SearchIcon, UserIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { useBorrowers } from "@/features/borrowers/api"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { errorMessage } from "@/lib/api"
import { plural } from "@/lib/format"
import type { Borrower } from "@/types/api"

/** Search existing borrowers by name / ID number / contact and pick one. */
export function BorrowerPicker({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: Borrower | null
  onChange: (borrower: Borrower | null) => void
  invalid?: boolean
  disabled?: boolean
}) {
  const [search, setSearch] = useState("")
  const q = useDebouncedValue(search, 250)
  const borrowers = useBorrowers({ q, pageSize: 6, page: 1 }, { enabled: !value && q.trim().length > 0 })

  if (value) {
    return (
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background">
          <UserIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{value.name}</p>
          {(value.idNumber || value.affiliation || value.contact) && (
            <p className="text-muted-foreground">
              {[value.idNumber && `ID ${value.idNumber}`, value.affiliation, value.contact].filter(Boolean).join(" · ")}
            </p>
          )}
          {value.outstandingCopies > 0 && (
            <p className="mt-1 text-amber-700 dark:text-amber-300">{plural(value.outstandingCopies, "book")} not returned</p>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
          <XIcon data-icon="inline-start" />
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="Name, ID number or contact"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-invalid={invalid}
          aria-label="Search borrowers"
          disabled={disabled}
        />
      </InputGroup>
      {q.trim().length > 0 && (
        <div className={cn("max-h-64 overflow-y-auto rounded-lg border", invalid && "border-destructive")}>
          {borrowers.isPending ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : borrowers.isError ? (
            <p className="p-3 text-sm text-destructive">{errorMessage(borrowers.error)}</p>
          ) : borrowers.data.data.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Not found. Use the <span className="font-medium">New borrower</span> tab.
            </p>
          ) : (
            <ul className="divide-y">
              {borrowers.data.data.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => onChange(b)}
                  >
                    <span className="font-medium">{b.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[b.idNumber && `ID ${b.idNumber}`, b.affiliation, b.contact].filter(Boolean).join(" · ") || "—"}
                      {b.outstandingCopies > 0 && ` · ${b.outstandingCopies} not returned`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
