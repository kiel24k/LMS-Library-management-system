import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type {
  Paginated,
  PublicBook,
  PublicLibraryInfo,
  PublicRequestInput,
  PublicRequestResult,
  PublicRequestStatus,
} from "@/types/api"

export type PublicBookParams = { q?: string; categoryId?: string | null; page?: number; pageSize?: number }

export const publicKeys = {
  library: (slug: string) => ["public", "library", slug] as const,
  books: (slug: string, p: PublicBookParams) => ["public", "books", slug, p] as const,
  status: (slug: string, loan: string) => ["public", "status", slug, loan] as const,
}

const slugPath = (slug: string) => `/public/libraries/${encodeURIComponent(slug)}`

export function usePublicLibrary(slug: string) {
  return useQuery({
    queryKey: publicKeys.library(slug),
    queryFn: ({ signal }) => api.get<PublicLibraryInfo>(slugPath(slug), undefined, signal),
    staleTime: 5 * 60_000,
  })
}

export function usePublicBooks(slug: string, params: PublicBookParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: publicKeys.books(slug, params),
    queryFn: ({ signal }) =>
      api.get<Paginated<PublicBook>>(
        `${slugPath(slug)}/books`,
        { q: params.q?.trim(), categoryId: params.categoryId, page: params.page, pageSize: params.pageSize },
        signal,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
}

export function useSubmitPublicRequest(slug: string) {
  return useMutation({
    mutationFn: (body: PublicRequestInput) => api.post<PublicRequestResult>(`${slugPath(slug)}/requests`, body),
    meta: { skipErrorToast: true },
  })
}

export function usePublicRequestStatus(slug: string, loanNumber: string | null) {
  return useQuery({
    queryKey: publicKeys.status(slug, loanNumber ?? ""),
    queryFn: ({ signal }) =>
      api.get<PublicRequestStatus>(`/public/requests/${encodeURIComponent(loanNumber!)}`, { slug }, signal),
    enabled: !!loanNumber,
    staleTime: 0,
  })
}
