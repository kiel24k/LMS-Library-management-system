import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { api, ApiError } from "@/lib/api"
import type {
  Loan,
  LoanCreateInput,
  LoanDetail,
  LoanPatchInput,
  LoanStatus,
  Paginated,
  ReturnInput,
} from "@/types/api"

export type LoanListParams = {
  libraryId?: string | null
  status?: LoanStatus | LoanStatus[]
  borrowerId?: string
  bookId?: string
  overdue?: boolean
  q?: string
  page?: number
  pageSize?: number
}

export const loanKeys = {
  all: ["loans"] as const,
  list: (p: LoanListParams) => ["loans", "list", p] as const,
  detail: (id: string) => ["loans", "detail", id] as const,
}

export function useLoans(params: LoanListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: loanKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<Paginated<Loan>>(
        "/loans",
        {
          libraryId: params.libraryId,
          status: Array.isArray(params.status) ? params.status.join(",") : params.status,
          borrowerId: params.borrowerId,
          bookId: params.bookId,
          overdue: params.overdue ? "true" : undefined,
          q: params.q?.trim(),
          page: params.page,
          pageSize: params.pageSize,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
}

export function useLoan(id: string | undefined) {
  return useQuery({
    queryKey: loanKeys.detail(id ?? ""),
    queryFn: ({ signal }) => api.get<LoanDetail>(`/loans/${encodeURIComponent(id!)}`, undefined, signal),
    enabled: !!id,
  })
}

/**
 * Loans affect stock, counts, borrower totals and the dashboard; accepting a request can also create or link an
 * account (Users → Accounts, the role's account count) and changes My Books.
 */
export function invalidateAfterLoanChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: loanKeys.all })
  void qc.invalidateQueries({ queryKey: ["dashboard"] })
  void qc.invalidateQueries({ queryKey: ["books"] })
  void qc.invalidateQueries({ queryKey: ["borrowers"] })
  void qc.invalidateQueries({ queryKey: ["libraries"] })
  void qc.invalidateQueries({ queryKey: ["users"] })
  void qc.invalidateQueries({ queryKey: ["roles"] })
  void qc.invalidateQueries({ queryKey: ["me"] })
}

function useLoanMutation<TVars>(fn: (vars: TVars) => Promise<LoanDetail>, skipErrorToast = true) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    meta: { skipErrorToast },
    onSuccess: (loan) => {
      qc.setQueryData(loanKeys.detail(loan.id), loan)
      invalidateAfterLoanChange(qc)
    },
    onError: (error) => {
      // Someone else changed (or deleted) the loan meanwhile: refetch so the page shows its real status and actions.
      if (error instanceof ApiError && (error.code === "INVALID_STATUS" || error.status === 404)) invalidateAfterLoanChange(qc)
    },
  })
}

const loanPath = (id: string, action = "") => `/loans/${encodeURIComponent(id)}${action}`

export function useCreateLoan() {
  return useLoanMutation((body: LoanCreateInput) => api.post<LoanDetail>("/loans", body))
}

export function useUpdateLoan(id: string) {
  return useLoanMutation((body: LoanPatchInput) => api.patch<LoanDetail>(loanPath(id), body))
}

export function useApproveLoan(id: string) {
  return useLoanMutation((body: { dueDate?: string }) => api.post<LoanDetail>(loanPath(id, "/approve"), body))
}

export function useRejectLoan(id: string) {
  return useLoanMutation((body: { reason: string }) => api.post<LoanDetail>(loanPath(id, "/reject"), body))
}

export function useCancelLoan(id: string) {
  return useLoanMutation((body: { reason?: string }) => api.post<LoanDetail>(loanPath(id, "/cancel"), body))
}

export function useRecordReturn(id: string) {
  return useLoanMutation((body: ReturnInput) => api.post<LoanDetail>(loanPath(id, "/returns"), body))
}

/** Sends the accept/reject email of a public request again (loans.approve); the result is stored on the record. */
export function useNotifyLoan(id: string) {
  return useLoanMutation(() => api.post<LoanDetail>(loanPath(id, "/notify")))
}
