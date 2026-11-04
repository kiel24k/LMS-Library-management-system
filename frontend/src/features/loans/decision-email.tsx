import { useState } from "react"
import { AlertCircleIcon, CheckCircle2Icon, MailIcon, MailXIcon, SendIcon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useNotifyLoan } from "@/features/loans/api"
import { canSendDecisionEmail } from "@/features/loans/loan-utils"
import { ApiError, errorMessage } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import type { LoanDetail } from "@/types/api"

function StatusLine({ icon, tone, children }: { icon: React.ReactNode; tone?: string; children: React.ReactNode }) {
  return (
    <div className={`flex gap-2 text-sm ${tone ?? ""}`}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

/**
 * Public requests: the accept/reject email sent to the borrower, what happened to it, and "Resend email"
 * (shown with loans.approve once the request was decided).
 */
export function DecisionEmailCard({ loan, canResend }: { loan: LoanDetail; canResend: boolean }) {
  const notify = useNotifyLoan(loan.id)
  const [confirming, setConfirming] = useState(false)
  if (loan.source !== "PUBLIC_FORM") return null

  const email = loan.borrower.email
  const sendable = canResend && canSendDecisionEmail(loan)
  const n = loan.notification
  const label = n?.sentAt || n?.error ? "Resend email" : "Send email"

  let status: React.ReactNode
  if (!email) {
    status = (
      <StatusLine icon={<MailXIcon />} tone="text-muted-foreground">
        No email address on this borrower, so no email is sent. Add one on the borrower's page.
      </StatusLine>
    )
  } else if (n?.error) {
    status = (
      <StatusLine icon={<AlertCircleIcon />} tone="text-destructive">
        <p className="font-medium">Couldn't send the email{n.sentAt ? " again" : ""}.</p>
        <p className="text-xs">{n.error}</p>
        {n.sentAt && <p className="text-xs text-muted-foreground">Last sent {formatDateTime(n.sentAt)}.</p>}
      </StatusLine>
    )
  } else if (n?.sentAt) {
    status = (
      <StatusLine icon={<CheckCircle2Icon />} tone="text-emerald-700 dark:text-emerald-400">
        Sent {formatDateTime(n.sentAt)}
      </StatusLine>
    )
  } else if (loan.status === "PENDING") {
    status = (
      <StatusLine icon={<MailIcon />} tone="text-muted-foreground">
        Sent when you accept or reject this request.
      </StatusLine>
    )
  } else {
    status = (
      <StatusLine icon={<MailIcon />} tone="text-muted-foreground">
        Not sent.
      </StatusLine>
    )
  }

  const send = () =>
    notify.mutate(undefined, {
      onSuccess: (l) => {
        setConfirming(false)
        if (l.notification?.error) toast.error(`Couldn't send the email to ${email}.`, { description: l.notification.error })
        else toast.success(`Email sent to ${email}.`)
      },
      onError: (e) => {
        setConfirming(false)
        if (e instanceof ApiError && e.code === "NO_EMAIL") toast.error("This borrower has no email address.")
        else toast.error(errorMessage(e))
      },
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email to borrower</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {email && (
          <a href={`mailto:${email}`} className="w-fit text-sm font-medium break-all hover:underline">
            {email}
          </a>
        )}
        {status}
        {sendable && (
          <Button variant="outline" className="w-fit" disabled={notify.isPending} onClick={() => setConfirming(true)}>
            <SendIcon data-icon="inline-start" />
            {label}
          </Button>
        )}
      </CardContent>
      {sendable && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`${label} to ${email}?`}
          description={
            loan.status === "REJECTED"
              ? "They'll get the email saying the request was not accepted, with your reason."
              : "They'll get the acceptance email again, with the books and the due date."
          }
          confirmLabel={label}
          pending={notify.isPending}
          onConfirm={send}
        />
      )}
    </Card>
  )
}
