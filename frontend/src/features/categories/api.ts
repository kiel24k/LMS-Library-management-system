import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { Category, CategoryInput, ListResponse } from "@/types/api"

export const categoryKeys = {
  all: ["categories"] as const,
  list: (libraryId: string) => ["categories", libraryId] as const,
}

export function useCategories(libraryId: string | null | undefined) {
  return useQuery({
    queryKey: categoryKeys.list(libraryId ?? ""),
    queryFn: ({ signal }) =>
      api
        .get<ListResponse<Category>>(`/libraries/${encodeURIComponent(libraryId!)}/categories`, undefined, signal)
        .then((r) => r.data),
    enabled: !!libraryId,
  })
}

function useInvalidateCategories() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: categoryKeys.all })
    void qc.invalidateQueries({ queryKey: ["libraries"] })
    void qc.invalidateQueries({ queryKey: ["books"] })
  }
}

export function useCreateCategory(libraryId: string) {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: (body: CategoryInput) =>
      api.post<Category>(`/libraries/${encodeURIComponent(libraryId)}/categories`, body),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}

export function useUpdateCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CategoryInput> & { id: string }) =>
      api.patch<Category>(`/categories/${encodeURIComponent(id)}`, body),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}

export function useDeleteCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/categories/${encodeURIComponent(id)}`),
    meta: { skipErrorToast: true },
    onSuccess: invalidate,
  })
}
