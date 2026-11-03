import { createContext, useContext } from "react"

import type { Library } from "@/types/api"

export const LIBRARY_STORAGE_KEY = "lms.libraryId"

export type LibraryScope = {
  /** The switcher's library, or null for "All libraries". */
  libraryId: string | null
  library: Library | null
  libraries: Library[]
  isLoading: boolean
  setLibraryId: (id: string | null) => void
}

export const LibraryScopeContext = createContext<LibraryScope | null>(null)

export function useLibraryScope(): LibraryScope {
  const ctx = useContext(LibraryScopeContext)
  if (!ctx) throw new Error("useLibraryScope must be used inside <LibraryScopeProvider>")
  return ctx
}
