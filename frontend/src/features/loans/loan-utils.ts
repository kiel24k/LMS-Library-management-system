import { normalizeName } from "@/lib/format"
import type { Loan, LoanDetail } from "@/types/api"

/** PUBLIC_FORM loans: true when the typed name differs from the linked borrower's name. */
export function submittedNameDiffers(loan: Pick<LoanDetail, "source" | "submittedName" | "borrower">): boolean {
  return (
    loan.source === "PUBLIC_FORM" &&
    !!loan.submittedName &&
    normalizeName(loan.submittedName) !== normalizeName(loan.borrower.name)
  )
}

/** Public requests are "accepted"; anything else keeps the older "approved" wording. */
export function decisionVerbs(loan: Pick<Loan, "source">) {
  return loan.source === "PUBLIC_FORM"
    ? { approve: "Accept", approved: "Accepted", reject: "Reject", rejected: "Rejected" }
    : { approve: "Approve", approved: "Approved", reject: "Reject", rejected: "Rejected" }
}

/**
 * Whether the accept/reject email can be (re)sent: a public request with a borrower email that was accepted
 * (released, whatever happened after) or rejected. Mirrors the checks of POST /loans/:id/notify.
 */
export function canSendDecisionEmail(loan: Pick<Loan, "source" | "status" | "borrowedAt" | "borrower">): boolean {
  if (loan.source !== "PUBLIC_FORM" || !loan.borrower.email) return false
  if (loan.status === "REJECTED") return true
  const accepted = loan.status === "BORROWED" || loan.status === "PARTIALLY_RETURNED" || loan.status === "RETURNED"
  return accepted && !!loan.borrowedAt
}
