import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { myBooksKeys } from "@/features/my-books/api"
import { userKeys } from "@/features/users/api"
import { api } from "@/lib/api"
import type { Borrower, BorrowerDetail, BorrowerInput, Paginated } from "@/types/api"

export type BorrowerListParams = { q?: string; hasAccount?: boolean; page?: number; pageSize?: number }

export const borrowerKeys = {
  all: ["borrowers"] as const,
  list: (p: BorrowerListParams) => ["borrowers", "list", p] as const,
  detail: (id: string) => ["borrowers", "detail", id] as const,
}

export function useBorrowers(params: BorrowerListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: borrowerKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<Paginated<Borrower>>(
        "/borrowers",
        { q: params.q?.trim(), hasAccount: params.hasAccount, page: params.page, pageSize: params.pageSize },
        signal,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
}

export function useBorrower(id: string | undefined) {
  return useQuery({
    queryKey: borrowerKeys.detail(id ?? ""),
    queryFn: ({ signal }) => api.get<BorrowerDetail>(`/borrowers/${encodeURIComponent(id!)}`, undefined, signal),
    enabled: !!id,
  })
}

export function useCreateBorrower() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BorrowerInput) => api.post<Borrower>("/borrowers", body),
    meta: { skipErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: borrowerKeys.all }),
  })
}

export function useUpdateBorrower() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<BorrowerInput> & { id: string }) =>
      api.patch<Borrower>(`/borrowers/${encodeURIComponent(id)}`, body),
    meta: { skipErrorToast: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: borrowerKeys.all })
      void qc.invalidateQueries({ queryKey: ["loans"] })
      // A linked account shows the borrower's name (Users → Accounts, and that account's own My Books).
      void qc.invalidateQueries({ queryKey: userKeys.all })
      void qc.invalidateQueries({ queryKey: myBooksKeys.loans })
    },
  })
}

export function useDeleteBorrower() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/borrowers/${encodeURIComponent(id)}`),
    meta: { skipErrorToast: true },
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: borrowerKeys.detail(id) })
      void qc.invalidateQueries({ queryKey: borrowerKeys.all })
      // The API unlinks a linked account (User.borrowerId → NULL): Users → Accounts must drop the borrower link.
      void qc.invalidateQueries({ queryKey: userKeys.all })
    },
  })
}
