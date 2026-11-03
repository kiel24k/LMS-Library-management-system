import { normalizeName } from "@/lib/format"
import type { LoanDetail } from "@/types/api"

/** PUBLIC_FORM loans: true when the typed name differs from the linked borrower's name. */
export function submittedNameDiffers(loan: Pick<LoanDetail, "source" | "submittedName" | "borrower">): boolean {
  return (
    loan.source === "PUBLIC_FORM" &&
    !!loan.submittedName &&
    normalizeName(loan.submittedName) !== normalizeName(loan.borrower.name)
  )
}
