import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { MyLoansResponse, MyRequestInput, MyRequestResult } from "@/types/api"

export const myBooksKeys = { loans: ["me", "loans"] as const }

/**
 * Borrow records of the borrower linked to the signed-in account, newest first (all statuses). Needs my_books.view;
 * `borrower` is null (and `data` empty) when the account isn't linked to a borrower.
 */
export function useMyLoans() {
  return useQuery({
    queryKey: myBooksKeys.loans,
    queryFn: ({ signal }) => api.get<MyLoansResponse>("/me/loans", undefined, signal),
  })
}

/**
 * "Borrow more books" while signed in: sends the request for the linked borrower (POST /me/requests) — no details
 * form. Errors are shown by the caller (book problems are marked on the request list).
 */
export function useSubmitMyRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: MyRequestInput) => api.post<MyRequestResult>("/me/requests", body),
    meta: { skipErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: myBooksKeys.loans }),
  })
}
