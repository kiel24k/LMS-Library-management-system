import { prisma } from "../lib/prisma.js";
import { currentMonthRange, todayDateOnly } from "../lib/dates.js";
import { formatLoanNumber } from "../lib/loan-number.js";
import { OPEN_STATUSES, loanInclude, serializeLoan } from "./serializers.js";
import { overdueWhere } from "./loan.service.js";

type ActivityType = "REQUESTED" | "BORROWED" | "RETURNED" | "REJECTED" | "CANCELLED";
type Activity = {
  type: ActivityType;
  loanId: string;
  loanNumber: string;
  borrowerName: string;
  libraryName: string;
  at: string;
  byName: string | null;
};

const ACTIVITY_LIMIT = 15;
const LIST_LIMIT = 10;

export async function getDashboard(libraryId?: string) {
  const now = new Date();
  const today = todayDateOnly(now);
  const month = currentMonthRange(now);
  const lib = libraryId ? { libraryId } : {};

  const loanSummary = {
    select: {
      id: true,
      number: true,
      borrower: { select: { name: true } },
      library: { select: { name: true } },
    },
  } as const;

  const [
    bookAgg,
    outstandingAgg,
    pending,
    active,
    overdue,
    returnedThisMonth,
    overdueLoans,
    pendingLoans,
    requested,
    borrowed,
    returns,
    closed,
  ] = await Promise.all([
    prisma.book.aggregate({
      where: { ...lib, archived: false },
      _count: { _all: true },
      _sum: { totalCopies: true, availableCopies: true },
    }),
    prisma.loanItem.aggregate({
      where: { loan: { ...lib, status: { in: OPEN_STATUSES } } },
      _sum: { quantity: true, returnedGood: true, returnedDamaged: true, lost: true },
    }),
    prisma.loan.count({ where: { ...lib, status: "PENDING" } }),
    prisma.loan.count({ where: { ...lib, status: { in: OPEN_STATUSES } } }),
    prisma.loan.count({ where: { ...lib, ...overdueWhere(today) } }),
    prisma.loan.count({ where: { ...lib, status: "RETURNED", closedAt: { gte: month.start, lt: month.end } } }),
    prisma.loan.findMany({
      where: { ...lib, ...overdueWhere(today) },
      include: loanInclude,
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
      take: LIST_LIMIT,
    }),
    prisma.loan.findMany({
      where: { ...lib, status: "PENDING" },
      include: loanInclude,
      orderBy: [{ requestedAt: "asc" }, { number: "asc" }],
      take: LIST_LIMIT,
    }),
    prisma.loan.findMany({
      where: { ...lib, source: "PUBLIC_FORM" },
      orderBy: [{ requestedAt: "desc" }, { number: "desc" }],
      take: ACTIVITY_LIMIT,
      select: { ...loanSummary.select, requestedAt: true },
    }),
    prisma.loan.findMany({
      where: { ...lib, borrowedAt: { not: null } },
      orderBy: [{ borrowedAt: "desc" }, { number: "desc" }],
      take: ACTIVITY_LIMIT,
      select: { ...loanSummary.select, borrowedAt: true, approvedBy: { select: { name: true } } },
    }),
    prisma.returnRecord.findMany({
      where: libraryId ? { loan: { libraryId } } : {},
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIMIT,
      select: { receivedAt: true, receivedBy: { select: { name: true } }, loan: loanSummary },
    }),
    prisma.loan.findMany({
      where: { ...lib, status: { in: ["REJECTED", "CANCELLED"] }, closedAt: { not: null } },
      orderBy: [{ closedAt: "desc" }, { number: "desc" }],
      take: ACTIVITY_LIMIT,
      select: { ...loanSummary.select, status: true, closedAt: true, closedBy: { select: { name: true } } },
    }),
  ]);

  const base = (l: { id: string; number: number; borrower: { name: string }; library: { name: string } }) => ({
    loanId: l.id,
    loanNumber: formatLoanNumber(l.number),
    borrowerName: l.borrower.name,
    libraryName: l.library.name,
  });
  const activity: Activity[] = [
    ...requested.map((l) => ({ type: "REQUESTED" as const, ...base(l), at: l.requestedAt.toISOString(), byName: null })),
    ...borrowed.map((l) => ({
      type: "BORROWED" as const,
      ...base(l),
      at: l.borrowedAt!.toISOString(),
      byName: l.approvedBy?.name ?? null,
    })),
    ...returns.map((r) => ({
      type: "RETURNED" as const,
      ...base(r.loan),
      at: r.receivedAt.toISOString(),
      byName: r.receivedBy.name,
    })),
    ...closed.map((l) => ({
      type: l.status as "REJECTED" | "CANCELLED",
      ...base(l),
      at: l.closedAt!.toISOString(),
      byName: l.closedBy?.name ?? null,
    })),
  ];
  activity.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const s = outstandingAgg._sum;
  return {
    totals: {
      books: bookAgg._count._all,
      copies: bookAgg._sum.totalCopies ?? 0,
      available: bookAgg._sum.availableCopies ?? 0,
      borrowedOut: (s.quantity ?? 0) - (s.returnedGood ?? 0) - (s.returnedDamaged ?? 0) - (s.lost ?? 0),
    },
    loans: { pending, active, overdue, returnedThisMonth },
    overdueLoans: overdueLoans.map((l) => serializeLoan(l, today)),
    pendingLoans: pendingLoans.map((l) => serializeLoan(l, today)),
    recentActivity: activity.slice(0, ACTIVITY_LIMIT),
  };
}
