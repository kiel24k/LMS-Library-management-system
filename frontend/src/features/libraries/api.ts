import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { Library, LibraryInput, ListResponse } from "@/types/api"

export const libraryKeys = {
  all: ["libraries"] as const,
  list: () => ["libraries", "list"] as const,
  detail: (id: string) => ["libraries", "detail", id] as const,
}

export function useLibraries() {
  return useQuery({
    queryKey: libraryKeys.list(),
    queryFn: ({ signal }) => api.get<ListResponse<Library>>("/libraries", undefined, signal).then((r) => r.data),
  })
}

export function useLibrary(id: string | undefined) {
  return useQuery({
    queryKey: libraryKeys.detail(id ?? ""),
    queryFn: ({ signal }) => api.get<Library>(`/libraries/${encodeURIComponent(id!)}`, undefined, signal),
    enabled: !!id,
  })
}

export function useCreateLibrary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LibraryInput) => api.post<Library>("/libraries", body),
    meta: { skipErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.all }),
  })
}

export function useUpdateLibrary(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<LibraryInput>) => api.patch<Library>(`/libraries/${encodeURIComponent(id)}`, body),
    meta: { skipErrorToast: true },
    onSuccess: (lib) => {
      qc.setQueryData(libraryKeys.detail(id), lib)
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
    },
  })
}

export function useDeleteLibrary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/libraries/${encodeURIComponent(id)}`),
    meta: { skipErrorToast: true },
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: libraryKeys.detail(id) })
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      void qc.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })
}
