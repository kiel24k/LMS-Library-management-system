import { CheckIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ApproveDialog, RejectDialog } from "@/features/loans/loan-actions"
import { decisionVerbs } from "@/features/loans/loan-utils"
import { useLibraryScope } from "@/lib/library-scope"
import type { Loan } from "@/types/api"

/** A pending request picked from a list, with what to do with it. */
export type QuickDecision = { loan: Loan; kind: "approve" | "reject" }

/** Small Accept / Reject buttons for a pending request in a list (show only with loans.approve). */
export function QuickDecisionButtons({ loan, onPick }: { loan: Loan; onPick: (decision: QuickDecision) => void }) {
  const verbs = decisionVerbs(loan)
  return (
    <span className="inline-flex gap-1.5">
      <Button
        size="sm"
        onClick={() => onPick({ loan, kind: "approve" })}
        aria-label={`${verbs.approve} ${loan.loanNumber} from ${loan.borrower.name}`}
      >
        <CheckIcon data-icon="inline-start" />
        {verbs.approve}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => onPick({ loan, kind: "reject" })}
        aria-label={`${verbs.reject} ${loan.loanNumber} from ${loan.borrower.name}`}
      >
        <XIcon data-icon="inline-start" />
        {verbs.reject}
      </Button>
    </span>
  )
}

/** The accept / reject dialog for a {@link QuickDecision} (the same dialogs as on the borrow record page). */
export function QuickDecisionDialogs({ decision, onClose }: { decision: QuickDecision | null; onClose: () => void }) {
  const { libraries } = useLibraryScope()
  if (!decision) return null
  const onOpenChange = (open: boolean) => {
    if (!open) onClose()
  }
  // Keyed by record so a new pick never reuses the previous one's mutation state.
  return decision.kind === "approve" ? (
    <ApproveDialog
      key={decision.loan.id}
      loan={decision.loan}
      open
      onOpenChange={onOpenChange}
      defaultLoanDays={libraries.find((l) => l.id === decision.loan.libraryId)?.defaultLoanDays}
    />
  ) : (
    <RejectDialog key={decision.loan.id} loan={decision.loan} open onOpenChange={onOpenChange} />
  )
}
