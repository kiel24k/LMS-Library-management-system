import { BanIcon, CheckCircle2Icon, FileInputIcon, HandHelpingIcon, PackageCheckIcon, XCircleIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "cn"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { submittedNameDiffers } from "@/features/loans/loan-utils"
import { formatDateTime } from "@/lib/format"
import type { LoanDetail, ReturnRecord } from "@/types/api"

type Event = { key: string; icon: ReactNode; title: string; at: string; detail?: ReactNode; tone?: string }

function countsText(r: ReturnRecord): string {
  const g = r.items.reduce((s, i) => s + i.good, 0)
  const d = r.items.reduce((s, i) => s + i.damaged, 0)
  const l = r.items.reduce((s, i) => s + i.lost, 0)
  return [g && `${g} good`, d && `${d} damaged`, l && `${l} lost`].filter(Boolean).join(", ") || "nothing"
}

/** Status timeline built from requestedAt, borrowedAt/approvedBy, each return record and closedAt/closedBy. */
export function LoanTimeline({ loan }: { loan: LoanDetail }) {
  const events: Event[] = []

  events.push({
    key: "requested",
    icon: <FileInputIcon />,
    title: loan.source === "PUBLIC_FORM" ? "Requested via public form" : "Created by staff",
    at: loan.requestedAt,
    detail:
      loan.source === "PUBLIC_FORM"
        ? submittedNameDiffers(loan)
          ? `Submitted as “${loan.submittedName}”`
          : undefined
        : loan.createdBy
          ? `by ${loan.createdBy.name}`
          : undefined,
  })

  if (loan.borrowedAt) {
    events.push({
      key: "borrowed",
      icon: <HandHelpingIcon />,
      title: "Books released",
      at: loan.borrowedAt,
      detail: [loan.approvedBy && `by ${loan.approvedBy.name}`, loan.dueDate && `due ${loan.dueDate}`].filter(Boolean).join(" · "),
      tone: "text-sky-600 dark:text-sky-300",
    })
  }

  for (const r of loan.returns) {
    events.push({
      key: r.id,
      icon: <PackageCheckIcon />,
      title: "Return checked",
      at: r.receivedAt,
      detail: (
        <>
          {countsText(r)} · by {r.receivedBy.name}
          {r.returnedByName && ` · brought by ${r.returnedByName}`}
        </>
      ),
      tone: "text-violet-600 dark:text-violet-300",
    })
  }

  if (loan.closedAt) {
    const by = loan.closedBy ? `by ${loan.closedBy.name}` : undefined
    if (loan.status === "RETURNED") {
      events.push({ key: "closed", icon: <CheckCircle2Icon />, title: "All books returned", at: loan.closedAt, detail: by, tone: "text-emerald-600 dark:text-emerald-300" })
    } else if (loan.status === "REJECTED") {
      events.push({
        key: "closed",
        icon: <XCircleIcon />,
        title: "Request rejected",
        at: loan.closedAt,
        detail: [by, loan.staffNotes && `“${loan.staffNotes}”`].filter(Boolean).join(" · "),
        tone: "text-rose-600 dark:text-rose-300",
      })
    } else if (loan.status === "CANCELLED") {
      events.push({
        key: "closed",
        icon: <BanIcon />,
        title: "Request cancelled",
        at: loan.closedAt,
        detail: [by, loan.staffNotes && `“${loan.staffNotes}”`].filter(Boolean).join(" · "),
      })
    }
  }

  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {events.map((e) => (
        <li key={e.key} className="relative">
          <span
            className={cn(
              "absolute top-0.5 -left-[1.95rem] flex size-6 items-center justify-center rounded-full border bg-background [&_svg]:size-3.5",
              e.tone ?? "text-muted-foreground",
            )}
          >
            {e.icon}
          </span>
          <p className="text-sm font-medium">{e.title}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(e.at)}</p>
          {e.detail && <p className="mt-0.5 text-xs text-muted-foreground">{e.detail}</p>}
        </li>
      ))}
    </ol>
  )
}

/** Table of past return checks: when, who checked, who brought them, counts per book. */
export function ReturnHistory({ returns }: { returns: ReturnRecord[] }) {
  if (returns.length === 0) {
    return <p className="text-sm text-muted-foreground">No returns yet.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Checked by</TableHead>
          <TableHead>Returned by</TableHead>
          <TableHead>Books</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {returns.map((r) => (
          <TableRow key={r.id} className="align-top">
            <TableCell className="align-top">{formatDateTime(r.receivedAt)}</TableCell>
            <TableCell className="align-top">{r.receivedBy.name}</TableCell>
            <TableCell className="align-top">{r.returnedByName ?? <span className="text-muted-foreground">Borrower</span>}</TableCell>
            <TableCell className="align-top">
              <ul className="flex flex-col gap-0.5">
                {r.items.map((i) => (
                  <li key={i.id} className="whitespace-normal">
                    <span className="font-medium">{i.bookTitle}</span>
                    <span className="text-muted-foreground">
                      {" — "}
                      {[i.good && `${i.good} good`, i.damaged && `${i.damaged} damaged`, i.lost && `${i.lost} lost`]
                        .filter(Boolean)
                        .join(", ") || "0"}
                    </span>
                  </li>
                ))}
              </ul>
            </TableCell>
            <TableCell className="max-w-64 align-top whitespace-normal text-muted-foreground">{r.notes ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
