import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type {
  Book,
  BookCreateInput,
  BookDetail,
  BookPatchInput,
  BulkBooksInput,
  BulkBooksResult,
  Paginated,
} from "@/types/api"

export type BookListParams = {
  libraryId?: string | null
  categoryId?: string | null
  q?: string
  available?: boolean
  includeArchived?: boolean
  page?: number
  pageSize?: number
}

export const bookKeys = {
  all: ["books"] as const,
  list: (p: BookListParams) => ["books", "list", p] as const,
  detail: (id: string) => ["books", "detail", id] as const,
}

export function useBooks(params: BookListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: bookKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<Paginated<Book>>(
        "/books",
        {
          libraryId: params.libraryId,
          categoryId: params.categoryId,
          q: params.q?.trim(),
          available: params.available ? "true" : undefined,
          includeArchived: params.includeArchived ? "true" : undefined,
          page: params.page,
          pageSize: params.pageSize,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
}

export function useBook(id: string | undefined) {
  return useQuery({
    queryKey: bookKeys.detail(id ?? ""),
    queryFn: ({ signal }) => api.get<BookDetail>(`/books/${encodeURIComponent(id!)}`, undefined, signal),
    enabled: !!id,
  })
}

function useInvalidateBooks() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: bookKeys.all })
    void qc.invalidateQueries({ queryKey: ["libraries"] })
    void qc.invalidateQueries({ queryKey: ["categories"] })
    void qc.invalidateQueries({ queryKey: ["dashboard"] })
  }
}

export function useCreateBook() {
  const invalidate = useInvalidateBooks()
  return useMutation({
    mutationFn: (body: BookCreateInput) => api.post<Book>("/books", body),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}

export function useUpdateBook() {
  const invalidate = useInvalidateBooks()
  return useMutation({
    mutationFn: ({ id, ...body }: BookPatchInput & { id: string }) =>
      api.patch<Book>(`/books/${encodeURIComponent(id)}`, body),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}

/** Sets the book's picture; `image` is a `data:image/jpeg;base64,…` URL (see cover-image.ts). */
export function useSetBookCover() {
  const invalidate = useInvalidateBooks()
  return useMutation({
    mutationFn: ({ id, image }: { id: string; image: string }) =>
      api.put<Book>(`/books/${encodeURIComponent(id)}/cover`, { image }),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}

export function useRemoveBookCover() {
  const invalidate = useInvalidateBooks()
  return useMutation({
    mutationFn: (id: string) => api.delete<Book>(`/books/${encodeURIComponent(id)}/cover`),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}

export function useDeleteBook() {
  const invalidate = useInvalidateBooks()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/books/${encodeURIComponent(id)}`),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}

export function useBulkCreateBooks() {
  const invalidate = useInvalidateBooks()
  return useMutation({
    mutationFn: (body: BulkBooksInput) => api.post<BulkBooksResult>("/books/bulk", body),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}
